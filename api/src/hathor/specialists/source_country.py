"""Specialist: Source-country detector.

Owns the single sub-question: "Which national EPI does this card belong to?"

Inputs: the raw extraction. Outputs: detected country + confidence + a
one-line reasoning string. The main agent uses this to decide which
country-specific rules to apply (and as a check against any country hint
the user provided).

This is a *focused* version of what the bundled enrichment did. The
A/B against the Arabic card showed the bundled version was non-
deterministic (Egypt @ 0.82 one run, Sudan @ 0.72 another) because it
was reasoning about everything at once. A laser-focused prompt with
explicit disambiguation examples should be more reliable.
"""

from __future__ import annotations

import json
import time

from hathor.specialists._base import (
    DEFAULT_MODEL,
    Issue,
    SpecialistVerdict,
    run_structured_call,
)

SOURCE_COUNTRY_SYSTEM_PROMPT = """You identify which national vaccination programme a child's card was issued under, given a structured OCR extraction. You output one verdict object only.

Return raw JSON only — no prose, no markdown fences:

{
  "detected_country": "Nigeria" | "Egypt" | "Sudan" | "Syria" | "South Sudan" | "Eritrea" | "Ethiopia" | "Senegal" | "Unknown",
  "confidence": 0.0,
  "reasoning": "<one sentence: which signals you used and what they ruled in or out>",
  "alternatives_considered": [
    {"country": "<name>", "ruled_out_because": "<one sentence>"}
  ]
}

### Disambiguation rules — apply in order

**1. Language is a strong but not decisive signal:**
- Arabic only → Egypt OR Sudan OR Syria. Look at schedule timing next.
- Tigrinya (ኤርትራ) → Eritrea (very high confidence — language is unique).
- Amharic (ኢትዮጵያ) → Ethiopia (very high confidence — language is unique).
- French → Senegal OR other Francophone Africa (Mali, Côte d'Ivoire — but those aren't seeded).
- English alone → Nigeria OR South Sudan OR many others. Schedule timing decides.

**2. Schedule timing is the second-strongest signal:**
- 2/4/6-month primary series (intervals ~60 days starting at ~8 weeks): **Egypt or Syria**, NOT Sudan / Nigeria / Eritrea / Ethiopia / South Sudan.
- 6/10/14-week primary series (intervals ~28 days starting at ~6 weeks): all the WHO-aligned African countries — Nigeria, Sudan, South Sudan, Eritrea, Ethiopia.
- If you see Pentavalent + OPV at 2 months, 4 months, 6 months → assume 2/4/6 schedule.
- If you see Pentavalent + OPV at 6 weeks, 10 weeks, 14 weeks → assume 6/10/14 schedule.

**3. BCG timing disambiguates within the 2/4/6 group:**
- BCG given at ~1 month of age → Egypt (Egyptian EPI gives BCG at 1 month, not birth).
- BCG given at birth (day 0) → Syria, Sudan, or any other country except Egypt.

**4. HepB-at-birth disambiguates within the 6/10/14 WHO-aligned group:**
- HepB monovalent at birth present → Nigeria, Sudan, OR Egypt-via-Hexavalent-later.
- HepB at birth NOT given (HepB only via Pentavalent at 6/10/14w) → Ethiopia, South Sudan, OR Eritrea (these three explicitly skip HepB-at-birth).

**5. Other regional signals:**
- Yellow Fever at 9 months → narrows to YF-endemic-region card (Nigeria, Sudan/South Sudan/Eritrea/Ethiopia subnationally).
- MenAfriVac at 9 months → meningitis-belt countries (Sudan, South Sudan, Eritrea, Ethiopia subnationally; not Egypt or Syria).
- PCV + Rotavirus in routine schedule → not Egypt or Syria (those don't include them in public EPI).

**6. Confidence calibration:**
- 0.95+ : Tigrinya/Amharic language alone, OR Arabic + 2/4/6 + BCG-at-1mo.
- 0.80–0.94 : Two strong signals agreeing (e.g. Arabic + 2/4/6 series).
- 0.60–0.79 : One strong signal + one weak signal.
- 0.30–0.59 : Mixed signals or only one signal.
- < 0.30 : Insufficient information — return "Unknown" and explain.

### Worked examples

**Example A:** Arabic-only card, Hexavalent at 2/4/6 months, BCG at 31 days, HepB at birth → **Egypt @ 0.92** (rule out Syria because BCG-at-1-month is Egyptian-specific; rule out Sudan because Sudan uses 6/10/14, not 2/4/6).

**Example B:** Arabic-only card, Pentavalent at 6/10/14 weeks, BCG at birth, HepB at birth, Yellow Fever at 9mo subnational → **Sudan @ 0.85** (Arabic narrows to Egypt/Sudan/Syria; 6/10/14 rules out Egypt and Syria; YF at 9mo is consistent with Sudanese subnational endemic).

**Example C:** English-only card, Pentavalent at 6/10/14 weeks, BCG at birth, HepB at birth, Yellow Fever at 9mo, PCV + Rotavirus → **Nigeria @ 0.88** (English + WHO-aligned schedule + YF + routine PCV/Rota points to Nigeria over other Anglophone West/East African candidates).

**Example D:** English card, Pentavalent ×3 at 6/10/14w, no HepB at birth, no PCV/Rota → **Ethiopia or South Sudan @ 0.55** (no-HepB-at-birth narrows to Ethiopia/South Sudan/Eritrea; English rules out Eritrea-Tigrinya; both Ethiopia and South Sudan possible — return whichever is more likely and explain in alternatives_considered).

Be decisive when the signals support it; be honest when they don't. Do NOT default to "Unknown" if you have one good signal — pick the most likely country and assign appropriate confidence.
"""


async def consult(extraction: dict) -> SpecialistVerdict:
    """Run the source-country specialist over a card extraction."""
    t_start = time.perf_counter()
    user_message = (
        "Identify the source country of the following card. Use the disambiguation "
        "rules in your system prompt.\n\n"
        f"```json\n{json.dumps(extraction, indent=2, ensure_ascii=False)}\n```\n\n"
        "Return your structured JSON verdict."
    )

    try:
        parsed = await run_structured_call(
            specialist_name="source_country",
            system_prompt=SOURCE_COUNTRY_SYSTEM_PROMPT,
            user_message=user_message,
        )
    except Exception as exc:
        return SpecialistVerdict(
            specialist="source_country",
            model=DEFAULT_MODEL,
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[],
            summary="",
            error=f"{type(exc).__name__}: {exc}",
        )

    # Source country specialist outputs a single classification, not a list
    # of issues. Repackage as a single info-level issue so the orchestrator
    # iteration in the main agent's prompt is uniform.
    detected = parsed.get("detected_country", "Unknown")
    confidence = float(parsed.get("confidence", 0.0))
    reasoning = parsed.get("reasoning", "")
    alts = parsed.get("alternatives_considered", []) or []
    alts_text = "; ".join(
        f"{a.get('country', '?')} (ruled out: {a.get('ruled_out_because', '')})"
        for a in alts if isinstance(a, dict)
    )

    severity = "info" if confidence >= 0.8 else "warning"
    summary = f"{detected} (confidence {confidence:.2f})"
    detail = f"{reasoning}" + (f" Alternatives considered: {alts_text}." if alts_text else "")

    return SpecialistVerdict(
        specialist="source_country",
        model=parsed.get("_model", DEFAULT_MODEL),
        elapsed_ms=parsed.get("_elapsed_ms", (time.perf_counter() - t_start) * 1000),
        issues=[
            Issue(
                code="SOURCE_COUNTRY_DETECTED",
                severity=severity,
                antigen=None,
                dose_indices=[],
                summary=summary,
                detail=detail,
                suggested_action=(
                    f"Apply {detected} EPI rules to the dose list."
                    if confidence >= 0.7
                    else "Confirm source country with the family before applying country-specific rules."
                ),
            )
        ],
        summary=f"Source country detected as {detected} with confidence {confidence:.2f}.",
        error=None,
    )
