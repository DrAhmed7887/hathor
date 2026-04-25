"""Tool: extract_and_enrich_card — single-shot extraction + enrichment.

Wraps the existing :func:`hathor.tools.card_extraction.extract_card` (vision
OCR, per-field confidence, Phase D shape) with a *second* Claude call on a
smaller model that adds two pieces of structure the main agent currently
infers from its 250-line system prompt:

1. ``detected_source_country`` — language + dose-pattern + schedule-timing
   inference, with confidence and a one-line ``reasoning`` string.
2. ``canonical_doses`` — per-dose antigen normalisation (Hexyon →
   ``["DTaP", "IPV", "Hib", "HepB"]``) applied inline, so the main agent
   does not need to call ``lookup_vaccine_equivalence`` once per dose.

The original ``card_metadata`` / ``extracted_doses`` (with per-field
confidence and ``needs_review``) flows through untouched — Phase D still
operates on the raw vision output. The enrichment is *additive*: a low
quality second-stage call cannot poison the input gate.

A/B posture: this tool sits *alongside* ``extract_vaccinations_from_card``
and does not replace it. The main agent's system prompt is unchanged in
this prototype; the tool is added so we can flip a single eval scenario
to use it and measure (a) main-agent input tokens, (b) total tool-call
count, (c) end-to-end latency. If wins materialise we then prune the
country-detection / antigen-equivalence content from the system prompt
in a follow-up.

Env knobs:
  HATHOR_ENRICH_MODEL        — second-stage model (default sonnet 4.6)
  HATHOR_ENRICH_TIMEOUT      — seconds (default 30)
  HATHOR_ENRICH_MAX_TOKENS   — output cap (default 2048)

Stub mode (``HATHOR_USE_STUB_VISION=1`` or no API key) returns a
deterministic Nigerian-EPI enrichment matching ``build_stub_output``,
keeping CI/offline tests hermetic.
"""

import json
import logging
import os
import re
import time

from anthropic import AsyncAnthropic
from claude_agent_sdk import tool

from hathor.tools.card_extraction import (
    _should_use_stub,
    extract_card,
)

_log = logging.getLogger("hathor.tools.card_extraction_subagent")

ENRICH_MODEL = os.environ.get("HATHOR_ENRICH_MODEL") or "claude-sonnet-4-6"
ENRICH_TIMEOUT_SECONDS = float(os.environ.get("HATHOR_ENRICH_TIMEOUT", "30"))
ENRICH_MAX_TOKENS = int(os.environ.get("HATHOR_ENRICH_MAX_TOKENS", "2048"))

LAST_ENRICH_CALL_MS: float | None = None

# Wall-clock ms for the most recent successful enrichment call. Mirrors
# the ``LAST_VISION_CALL_MS`` pattern in card_extraction so the server's
# timing_summary SSE event can report the breakdown.

ENRICH_PROMPT = """You receive raw OCR output from a child's vaccination card and add two pieces of structure the downstream clinical agent would otherwise have to infer.

Return a single JSON object only — no prose, no markdown fences. The object MUST match this shape exactly:

{
  "detected_source_country": {
    "value": "Nigeria" | "Egypt" | "Sudan" | "Syria" | "South Sudan" | "Eritrea" | "Ethiopia" | "Unknown",
    "confidence": 0.0,
    "reasoning": "<one-line: language + which dose-pattern signals you used>"
  },
  "canonical_doses": [
    {
      "transcribed": "<verbatim from input>",
      "canonical_name": "<e.g. Hexyon, Pentavalent (DPT-HepB-Hib), MMR, BCG, OPV, IPV, Rotarix, ...>",
      "antigens": ["DTP", "HepB", ...],
      "combination_type": "hexavalent" | "pentavalent" | "monovalent" | "MMR" | "MR" | "MMRV" | "PCV" | "OPV" | "IPV" | "BCG" | "unknown",
      "notes": "<one-line if non-obvious; null otherwise>"
    }
  ]
}

### Source-country detection rules
- Language is the strongest signal. Arabic-only cards are typically Egypt or Sudan or Syria. Tigrinya = Eritrea. Amharic = Ethiopia. English alone is ambiguous.
- Schedule timing is the second signal:
  - 6/10/14-week primary series (intervals ~28 days starting at age ~6 weeks) → Nigeria, Sudan, South Sudan, Eritrea, Ethiopia (WHO-aligned).
  - 2/4/6-month primary series (intervals ~60 days starting at ~8 weeks) → Egypt, Syria.
- Vaccine product hints:
  - "Pentavalent" / "DPT-HepB-Hib" without IPV bundled → WHO-aligned African schedule (Nigeria/Sudan/South Sudan/Eritrea/Ethiopia).
  - "Hexavalent" / "Hexyon" / "Hexaxim" → typically Egypt or private/EU.
  - "Pentaxim" → private market, ambiguous.
  - "BCG at birth" → most African schedules. "BCG at 1 month" → Egypt.
  - "HepB at birth" → Nigeria, Sudan, Syria, Egypt. NOT routine in Ethiopia, South Sudan, Eritrea.
- If signals are mixed or insufficient, return "Unknown" with confidence ≤ 0.5 and explain in reasoning.
- Confidence calibration: 0.95+ = unambiguous (single-language Arabic + Egyptian dose pattern). 0.70-0.85 = consistent but one signal could go either way. ≤ 0.5 = guess.

### Canonical-dose rules
- Match each ``transcribed_antigen.value`` from the input to its canonical entry. Common mappings:
  - "Hexyon" / "Hexaxim" / "Infanrix Hexa" / "Vaxelis" → hexavalent, antigens: ["DTaP", "IPV", "Hib", "HepB"]
  - "Pentavalent" / "DPT-HepB-Hib" / "الخماسي" → pentavalent (WHO-aligned, NO IPV), antigens: ["DTP", "HepB", "Hib"]
  - "Pentaxim" → pentavalent (private), antigens: ["DTaP", "IPV", "Hib"] (NO HepB)
  - "MMR" / "Priorix" / "M-M-RvaxPro" → MMR, antigens: ["Measles", "Mumps", "Rubella"]
  - "MR" → MR, antigens: ["Measles", "Rubella"] (NO Mumps)
  - "Measles" / "Measles monovalent" → monovalent, antigens: ["Measles"]
  - "BCG" → monovalent, antigens: ["BCG"]
  - "OPV" / "bOPV" / "tOPV" → monovalent, antigens: ["OPV"]
  - "IPV" / "fIPV" → monovalent, antigens: ["IPV"]
  - "Rotarix" / "RotaTeq" / "Rotavirus" / "Rota" → monovalent, antigens: ["Rotavirus"]
  - "PCV" / "PCV13" / "Prevenar" / "Synflorix" → PCV, antigens: ["PCV"]
  - "Yellow Fever" / "YF" → monovalent, antigens: ["YellowFever"]
  - "MenAfriVac" / "MenA" → monovalent, antigens: ["MenA"]
- Preserve the input dose order. Emit one canonical entry per input dose — even duplicates.
- If you cannot identify the antigen, set ``combination_type: "unknown"`` and ``antigens: []``; do NOT guess.
- ``notes`` is for genuinely non-obvious mappings (e.g. "Pentaxim does NOT include HepB" or "9-month measles does NOT cover Mumps/Rubella"). Otherwise null.

The raw OCR output follows. Return only the enrichment JSON.
"""

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.DOTALL)


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    m = _JSON_FENCE_RE.match(text)
    return m.group(1).strip() if m else text


def _stub_enrichment(extraction_payload: dict) -> dict:
    """Deterministic enrichment matching ``build_stub_output``'s
    Nigerian-EPI flagship card. Used when the upstream extractor is
    in stub mode so CI/offline tests stay hermetic.
    """
    canonical = []
    for dose in extraction_payload.get("extracted_doses", []):
        antigen_value = (
            (dose.get("transcribed_antigen") or {}).get("value", "")
        )
        norm = antigen_value.lower()
        if "bcg" in norm:
            entry = {
                "transcribed": antigen_value,
                "canonical_name": "BCG",
                "antigens": ["BCG"],
                "combination_type": "BCG",
                "notes": None,
            }
        elif "penta" in norm:
            entry = {
                "transcribed": antigen_value,
                "canonical_name": "Pentavalent (DPT-HepB-Hib)",
                "antigens": ["DTP", "HepB", "Hib"],
                "combination_type": "pentavalent",
                "notes": "WHO-aligned pentavalent: NO IPV bundled — IPV is a separate dose at 14 weeks.",
            }
        elif "opv" in norm:
            entry = {
                "transcribed": antigen_value,
                "canonical_name": "OPV",
                "antigens": ["OPV"],
                "combination_type": "OPV",
                "notes": None,
            }
        else:
            entry = {
                "transcribed": antigen_value,
                "canonical_name": antigen_value,
                "antigens": [],
                "combination_type": "unknown",
                "notes": "Stub passthrough — not in deterministic mapping table.",
            }
        canonical.append(entry)

    return {
        "detected_source_country": {
            "value": "Nigeria",
            "confidence": 0.95,
            "reasoning": "STUB — Nigerian NPI flagship card: English + 6/10/14-week Pentavalent + birth-dose BCG.",
        },
        "canonical_doses": canonical,
    }


async def enrich_extraction(extraction_payload: dict) -> dict:
    """Real second-stage enrichment via the Anthropic Messages API.

    Takes a serialised :class:`CardExtractionOutput` and returns the
    enrichment object. Logs ``enrich_call_ms`` and stashes it under
    :data:`LAST_ENRICH_CALL_MS` for the server timing summary.
    """
    global LAST_ENRICH_CALL_MS
    t_start = time.perf_counter()

    payload_text = json.dumps(extraction_payload, indent=2)
    user_text = f"{ENRICH_PROMPT}\n\n```json\n{payload_text}\n```"

    client = AsyncAnthropic()
    message = await client.messages.create(
        model=ENRICH_MODEL,
        max_tokens=ENRICH_MAX_TOKENS,
        timeout=ENRICH_TIMEOUT_SECONDS,
        messages=[{"role": "user", "content": user_text}],
    )

    text = "".join(
        getattr(block, "text", "")
        for block in message.content
        if getattr(block, "type", None) == "text"
    )
    body = _strip_json_fence(text)
    try:
        enrichment = json.loads(body)
    except json.JSONDecodeError as exc:
        _log.error("enrichment returned non-JSON output: %r", text[:500])
        raise ValueError(
            f"Enrichment model returned non-JSON output: {exc}. "
            f"First 200 chars: {text[:200]!r}"
        ) from exc

    total_ms = (time.perf_counter() - t_start) * 1000
    LAST_ENRICH_CALL_MS = total_ms
    _log.info(
        "enrich_call_ms=%.0f doses=%d source=%s conf=%.2f",
        total_ms,
        len(enrichment.get("canonical_doses", [])),
        enrichment.get("detected_source_country", {}).get("value", "?"),
        enrichment.get("detected_source_country", {}).get("confidence", 0.0),
    )
    return enrichment


@tool(
    "extract_and_enrich_card",
    "Extract vaccinations from a card AND enrich the result in one call. "
    "Returns the same per-field-confidence shape as extract_vaccinations_from_card "
    "(so Phase D still works), plus two additive fields: "
    "(1) detected_source_country with confidence and reasoning, and "
    "(2) canonical_doses with antigen equivalence applied inline (so the agent "
    "does not need to call lookup_vaccine_equivalence per dose). Use this in "
    "place of extract_vaccinations_from_card when you want one-shot extraction "
    "with country detection and antigen normalisation pre-computed.",
    {"image_path": str},
)
async def extract_and_enrich_card(args: dict) -> dict:
    image_path = args.get("image_path", "")

    extraction = await extract_card(image_path)
    extraction_payload = extraction.model_dump(mode="json")

    if _should_use_stub():
        enrichment = _stub_enrichment(extraction_payload)
    else:
        try:
            enrichment = await enrich_extraction(extraction_payload)
        except Exception as exc:
            _log.exception("enrichment failed; returning extraction without enrichment")
            enrichment = {
                "detected_source_country": {
                    "value": "Unknown",
                    "confidence": 0.0,
                    "reasoning": f"ENRICHMENT FAILED — {type(exc).__name__}: {exc}",
                },
                "canonical_doses": [],
                "enrichment_error": f"{type(exc).__name__}: {exc}",
            }

    combined = {
        **extraction_payload,
        "image_path_received": image_path,
        "enrichment": enrichment,
    }
    return {"content": [{"type": "text", "text": json.dumps(combined, indent=2)}]}
