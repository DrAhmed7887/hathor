"""Specialist: WHO baseline cross-checker.

Owns the single sub-question: "Does this card's dose pattern match the WHO
IVB/SAGE baseline recommendations, and where does it diverge?"

Used as a fallback when the source country isn't seeded (Somalia, Yemen,
Iraq, etc.) and as a sanity check when it is. The WHO baseline is the
recommendation; actual national programmes diverge — those divergences are
informative, not errors.

Conservative posture: WHO baseline is itself less authoritative than a
country-specific schedule when one exists. This specialist's verdicts
should be treated as informational, not blocking.
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

WHO_BASELINE_SYSTEM_PROMPT = """You compare a child's vaccination card against the WHO IVB/SAGE recommended baseline schedule and report alignment + divergences. You are a fallback / cross-check, not a primary authority — when a country-specific schedule applies, it overrides you.

Return raw JSON only — no prose, no markdown fences:

{
  "issues": [
    {
      "code": "<SHORT_IDENTIFIER>",
      "severity": "info" | "warning" | "critical",
      "antigen": "<antigen or null>",
      "dose_indices": [<int indices into extracted_doses>],
      "summary": "<one-line>",
      "detail": "<≤2 sentences>",
      "suggested_action": "<one sentence or null>"
    }
  ],
  "summary": "<one-paragraph overall alignment statement>"
}

### WHO IVB/SAGE recommended baseline (as of 2024 position papers)

**Birth (week 0):**
- BCG ×1 (TB-endemic settings — most LMICs)
- HepB monovalent ×1 (universal — birth dose)
- OPV0 (countries with high polio risk)

**6 weeks:**
- Pentavalent (DTP-HepB-Hib) dose 1
- OPV dose 1
- PCV (10 or 13) dose 1
- Rotavirus dose 1

**10 weeks:**
- Pentavalent dose 2
- OPV dose 2
- PCV dose 2
- Rotavirus dose 2 (Rotarix only — RotaTeq has a third dose)

**14 weeks:**
- Pentavalent dose 3
- OPV dose 3 (or OPV3 + IPV)
- IPV dose 1 (or fIPV — fractional IPV)
- PCV dose 3 (in 3+0 schedule) OR PCV dose 3 (in 3+1)
- Rotavirus dose 3 (RotaTeq schedule only)

**9 months:**
- Measles-containing dose 1 (MCV1) — monovalent measles, MR, or MMR
- Yellow Fever (in YF-endemic countries / regions)
- MenAfriVac (in meningitis-belt countries / regions)

**12-18 months:**
- MCV2 (measles-containing dose 2)
- DTP booster
- Varicella (in countries that include it)
- HepA (in countries that include it)

### What to flag

1. **WHO_BASELINE_ALIGNED** — info, single emission. If the card matches the WHO baseline reasonably, emit one positive info issue. Don't enumerate every aligned dose.

2. **MISSING_WHO_RECOMMENDED** — warning per missing WHO-recommended antigen. List which doses are missing relative to baseline. *Do NOT escalate to critical* — a country-specific schedule may legitimately omit certain antigens (e.g. Egypt doesn't include Rotavirus in public EPI, that's a country choice not a WHO violation).

3. **TIMING_DIVERGENCE** — info. If the card uses 2/4/6 months instead of 6/10/14 weeks, that's a divergence from WHO baseline but a legitimate country choice (Egypt, Syria, Italy, France, USA all use ~2/4/6). Note it; don't flag as error.

4. **WHO_PRODUCT_VARIATION** — info. If the card uses Hexavalent instead of Pentavalent + separate IPV, that's a product choice consistent with WHO recommendations.

5. **UNUSUAL_TIMING** — warning. If a dose is given outside the WHO recommended age window (e.g. PCV at 18 months instead of 6 weeks) without being a clearly-labelled catch-up, flag it.

6. **NO_MCV2** — warning. If only one measles-containing dose is recorded and the child is past 18 months, flag it — WHO has recommended MCV2 universally since 2017.

### Calibration

- Most cards from LMIC contexts will diverge from WHO baseline in some way (national schedule customisation). Most divergences are *informational*, not errors.
- Use ``critical`` severity sparingly — only when divergence creates a genuine clinical gap (e.g. child with no measles dose past 12 months in a measles-endemic setting).
- Maximum 6 issues; if more, return the 6 most clinically important and note truncation in summary.
- Each detail ≤ 2 sentences.
"""


async def consult(extraction: dict) -> SpecialistVerdict:
    t_start = time.perf_counter()
    user_message = (
        "Compare the following card to the WHO IVB/SAGE baseline. Note alignment "
        "and divergences per the rules in your system prompt.\n\n"
        f"```json\n{json.dumps(extraction, indent=2, ensure_ascii=False)}\n```\n\n"
        "Return your structured JSON verdict."
    )

    try:
        parsed = await run_structured_call(
            specialist_name="who_baseline",
            system_prompt=WHO_BASELINE_SYSTEM_PROMPT,
            user_message=user_message,
        )
    except Exception as exc:
        return SpecialistVerdict(
            specialist="who_baseline",
            model=DEFAULT_MODEL,
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[],
            summary="",
            error=f"{type(exc).__name__}: {exc}",
        )

    issues_raw = parsed.get("issues") or []
    issues: list[Issue] = []
    for raw in issues_raw:
        if not isinstance(raw, dict):
            continue
        sev = raw.get("severity") if raw.get("severity") in ("info", "warning", "critical") else "info"
        issues.append(
            Issue(
                code=str(raw.get("code", "UNKNOWN")),
                severity=sev,
                antigen=raw.get("antigen"),
                dose_indices=list(raw.get("dose_indices", []) or []),
                summary=str(raw.get("summary", "")),
                detail=str(raw.get("detail", "")),
                suggested_action=raw.get("suggested_action"),
            )
        )

    return SpecialistVerdict(
        specialist="who_baseline",
        model=parsed.get("_model", DEFAULT_MODEL),
        elapsed_ms=parsed.get("_elapsed_ms", (time.perf_counter() - t_start) * 1000),
        issues=issues,
        summary=str(parsed.get("summary", "")),
        error=None,
    )
