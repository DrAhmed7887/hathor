"""Tool: extract_vaccinations_from_card — Anthropic vision OCR.

Reads the image at ``image_path``, sends it to Claude with a structured
extraction prompt, and returns a :class:`CardExtractionOutput` whose
per-field ``confidence`` and ``needs_review`` flags are produced by the
model itself. Those values flow into the Phase D safety gate, so
genuinely-ambiguous fields (smudged dates, partial overwrites, illegible
handwriting) are routed to clinician review without any extra plumbing.

Offline / test fallback: ``build_stub_output`` is preserved (Nigerian-EPI
flagship and ``phase_d``/``hitl_demo`` variants) and is used automatically
when ``HATHOR_USE_STUB_VISION=1`` is set or when ``ANTHROPIC_API_KEY`` is
missing — keeping unit tests deterministic and CI-friendly without forcing
a real vision call.
"""

import base64
import json
import logging
import os
import pathlib
import re
import time

from anthropic import AsyncAnthropic
from claude_agent_sdk import tool

from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)


_log = logging.getLogger("hathor.tools.card_extraction")

VISION_MODEL = os.environ.get("HATHOR_VISION_MODEL") or "claude-opus-4-7"
VISION_TIMEOUT_SECONDS = float(os.environ.get("HATHOR_VISION_TIMEOUT", "60"))
VISION_MAX_TOKENS = int(os.environ.get("HATHOR_VISION_MAX_TOKENS", "4096"))

# Wall-clock ms of the most recent successful vision call. The server
# reads this when emitting its `timing_summary` SSE event so a single
# reconciliation reports the vision and agent breakdown side by side.
# None when the last extraction came from the stub fallback.
LAST_VISION_CALL_MS: float | None = None

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

EXTRACTION_PROMPT = """You are a precise medical-document parser reading a child's vaccination card. Cards may be Nigerian (English / NPI), Egyptian (Arabic / EPI), or other African formats.

Extract every dose visible on the card and the card-level metadata, and return a single JSON object that matches the schema below exactly. Return raw JSON only — no prose, no markdown fences.

### Confidence rules
- Use a calibrated, real confidence in [0, 1].
  - 1.0  = perfectly clear, no ambiguity.
  - 0.85–0.95 = clear with normal handwriting variance.
  - 0.50–0.84 = smudged, faded, partially obscured, or genuinely uncertain.
  - < 0.50 = mostly illegible.
- Whenever confidence < 0.85 OR the value is genuinely ambiguous, set `needs_review: true` and put a short, specific reason in `ambiguity_reason` (e.g. "Day digit smudged; could be 15, 16, or 17").
- A field that is genuinely absent on the card (e.g. no lot number recorded) should have its outer object set to `null` rather than a fabricated value.

### Field rules
- `transcribed_antigen.value`: write what is on the card (trade name or antigen abbreviation, in the original script if non-Latin). Do NOT canonicalise.
- `date_administered.value`: ISO 8601 (YYYY-MM-DD). Convert DD/MM/YYYY or DD-MMM-YY. If only month/year is legible, set value=null and explain.
- `dose_number_on_card.value`: the dose number as written ("1", "1st", "أول", "I").
- `card_metadata.patient_dob.value`: ISO date if present, else null.
- `card_metadata.overall_legibility.value`: "High", "Medium", or "Low".
- Order doses chronologically by date_administered when possible.

### Output shape
{
  "card_metadata": {
    "detected_language":  {"value": "...", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null},
    "overall_legibility": {"value": "High|Medium|Low", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null},
    "patient_dob":        {"value": "YYYY-MM-DD" | null, "confidence": 0.0, "needs_review": false, "ambiguity_reason": null}
  },
  "extracted_doses": [
    {
      "transcribed_antigen":  {"value": "...", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null},
      "date_administered":    {"value": "YYYY-MM-DD" | null, "confidence": 0.0, "needs_review": false, "ambiguity_reason": null},
      "dose_number_on_card":  {"value": "...", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null} | null,
      "lot_number":           {"value": "...", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null} | null,
      "provider_signature":   {"value": "Present|Absent|<name>", "confidence": 0.0, "needs_review": false, "ambiguity_reason": null} | null
    }
  ]
}

If the image is not a vaccination card, return an empty `extracted_doses` list and set `overall_legibility.value` to "Low" with an explanation in `ambiguity_reason`.
"""

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.DOTALL)


def _hi(value: str) -> FieldExtraction:
    return FieldExtraction(value=value, confidence=1.0, needs_review=False)


def _lo(value: str, reason: str) -> FieldExtraction:
    return FieldExtraction(
        value=value,
        confidence=0.62,
        needs_review=True,
        ambiguity_reason=reason,
    )


def _is_demo_variant(image_path: str) -> bool:
    p = image_path.lower()
    return "phase_d" in p or "hitl_demo" in p


def build_stub_output(image_path: str) -> CardExtractionOutput:
    """Deterministic Nigerian-EPI extraction. Used by the offline fallback
    and the unit tests. Two variants:

    - **Flagship** (default): DOB 2025-12-09, BCG + Pentavalent×3 + OPV×3
      on Nigerian NPI 6/10/14-week timing, no Rotavirus. All field
      confidences 1.0 — exercises the post-15-week Rotavirus initiation
      gate.
    - **Phase D demo** (``image_path`` contains ``phase_d`` / ``hitl_demo``):
      same dose set, but Pentavalent dose 3's date is emitted with
      confidence 0.62 to demonstrate the per-field HITL flow.
    """
    demo = _is_demo_variant(image_path)
    penta3_date = (
        _lo("2026-03-1?", "Day digit is smudged; could be 15, 16, or 17")
        if demo
        else _hi("2026-03-17")
    )

    return CardExtractionOutput(
        card_metadata=CardMetadata(
            detected_language=_hi("English"),
            overall_legibility=_hi("Medium" if demo else "High"),
            patient_dob=_hi("2025-12-09"),
        ),
        extracted_doses=[
            ExtractedDose(
                transcribed_antigen=_hi("BCG"),
                date_administered=_hi("2025-12-09"),
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=_hi("2026-01-20"),
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-01-20"),
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=_hi("2026-02-17"),
                dose_number_on_card=_hi("2"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-02-17"),
                dose_number_on_card=_hi("2"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=penta3_date,
                dose_number_on_card=_hi("3"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-03-17"),
                dose_number_on_card=_hi("3"),
            ),
        ],
        extraction_method=(
            "STUB — phase_d demo variant (Pentavalent dose 3 date smudged)"
            if demo
            else "STUB — Nigerian EPI flagship (no Rotavirus; child past 15-week cutoff)"
        ),
    )


def _should_use_stub() -> bool:
    flag = os.environ.get("HATHOR_USE_STUB_VISION", "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return True
    return False


def _resolve_image_path(raw: str) -> pathlib.Path:
    """Resolve ``raw`` against the repo root for relative paths. The
    server's allowlist gate (``_validate_image_path`` in
    ``hathor.server``) is the authoritative path validator; this helper
    only normalises so the tool can also be invoked directly with either
    an absolute or a repo-relative path.

    From this file (``api/src/hathor/tools/card_extraction.py``):
    parents[0..4] = tools, hathor (pkg), src, api, hathor (repo root).
    """
    p = pathlib.Path(raw)
    if p.is_absolute():
        return p
    repo_root = pathlib.Path(__file__).resolve().parents[4]
    return (repo_root / p).resolve()


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    m = _JSON_FENCE_RE.match(text)
    return m.group(1).strip() if m else text


async def extract_card_via_vision(image_path: str) -> CardExtractionOutput:
    """Real vision-based extraction via the Anthropic Messages API.

    Logs timing as ``vision_call_ms`` to the module logger and stashes it
    under :data:`LAST_VISION_CALL_MS` for the server to pick up and emit
    in its timing summary.
    """
    global LAST_VISION_CALL_MS
    t_start = time.perf_counter()

    path = _resolve_image_path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Card image not found: {image_path}")

    media_type = _MEDIA_TYPES.get(path.suffix.lower(), "image/jpeg")
    b64 = base64.standard_b64encode(path.read_bytes()).decode("ascii")

    client = AsyncAnthropic()
    t_api_start = time.perf_counter()
    message = await client.messages.create(
        model=VISION_MODEL,
        max_tokens=VISION_MAX_TOKENS,
        timeout=VISION_TIMEOUT_SECONDS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    text = "".join(
        getattr(block, "text", "")
        for block in message.content
        if getattr(block, "type", None) == "text"
    )
    payload_text = _strip_json_fence(text)
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        _log.error("vision returned non-JSON output: %r", text[:500])
        raise ValueError(
            f"Vision model returned non-JSON output: {exc}. "
            f"First 200 chars: {text[:200]!r}"
        ) from exc

    if _is_demo_variant(image_path) and payload.get("extracted_doses"):
        # Demo guarantee: ensure the last dose's date routes to HITL so
        # the front-end review flow is exercisable on demand. Real cards
        # never go through this branch.
        dose = payload["extracted_doses"][-1]
        if isinstance(dose.get("date_administered"), dict):
            dose["date_administered"]["confidence"] = 0.62
            dose["date_administered"]["needs_review"] = True
            dose["date_administered"]["ambiguity_reason"] = (
                "Demo: forced low confidence to exercise HITL flow."
            )

    payload.setdefault("extraction_method", f"claude-vision ({VISION_MODEL})")
    output = CardExtractionOutput.model_validate(payload)

    api_ms = (time.perf_counter() - t_api_start) * 1000
    total_ms = (time.perf_counter() - t_start) * 1000
    LAST_VISION_CALL_MS = total_ms
    _log.info(
        "vision_call_ms=%.0f api_ms=%.0f doses=%d image=%s",
        total_ms, api_ms, len(output.extracted_doses), path.name,
    )
    return output


async def extract_card(image_path: str) -> CardExtractionOutput:
    """Public extractor used by the server and the @tool wrapper.

    Routes to :func:`extract_card_via_vision` by default; falls back to
    :func:`build_stub_output` when ``HATHOR_USE_STUB_VISION=1`` is set
    or when ``ANTHROPIC_API_KEY`` is missing (offline tests, CI).
    On unexpected runtime errors from the vision call, returns a
    clearly-labelled stub so the SSE stream stays alive — the
    ``extraction_method`` field carries the exception class for triage.
    """
    if _should_use_stub():
        return build_stub_output(image_path)
    try:
        return await extract_card_via_vision(image_path)
    except FileNotFoundError:
        raise
    except Exception as exc:
        _log.exception("vision extraction failed; falling back to stub")
        fallback = build_stub_output(image_path)
        fallback.extraction_method = (
            f"FALLBACK STUB — vision call failed: {type(exc).__name__}: {exc}"
        )
        return fallback


@tool(
    "extract_vaccinations_from_card",
    "Extract all vaccination records from a child's vaccination card image. "
    "Performs Anthropic-vision OCR and returns a CardExtractionOutput with "
    "per-field confidence scores, needs_review flags, and ambiguity reasons. "
    "Confidence < 0.85 routes the field to Phase D clinician review. "
    "Falls back to a deterministic Nigerian-EPI stub when "
    "HATHOR_USE_STUB_VISION=1 or ANTHROPIC_API_KEY is unset.",
    {"image_path": str},
)
async def extract_vaccinations_from_card(args: dict) -> dict:
    image_path = args.get("image_path", "")
    output = await extract_card(image_path)
    payload = output.model_dump(mode="json")
    payload["image_path_received"] = image_path
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}
