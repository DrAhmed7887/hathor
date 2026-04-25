"""Specialist: Catch-up planner.

Owns the single sub-question: "Given the doses on this card, the child's
age, and the destination country, what is the optimal catch-up plan?"

Different cognitive shape from the other specialists — this is *forward
planning* (constraint-satisfaction over visit grouping, age windows,
co-administration rules) rather than backward review.

The deterministic ``build_catchup_schedule`` tool produces a basic visit
list. This specialist reasons over that mechanical baseline plus clinical
edge cases the deterministic tool can't reason about (parent-friendly
bundling, school-enrolment urgency, vaccine availability constraints,
interactions with the attending physician's findings).

Inputs: extraction + ``target_country`` + ``child_dob`` (optional). When
DOB is missing, returns an info verdict noting that planning requires DOB.
"""

from __future__ import annotations

import datetime
import json
import time

from hathor.specialists._base import (
    DEFAULT_MODEL,
    Issue,
    SpecialistVerdict,
    run_structured_call,
)

CATCHUP_PLANNER_SYSTEM_PROMPT = """You produce a prioritised catch-up plan for a child given their existing vaccination card, their age, and the destination country whose schedule must be satisfied. You are a forward-looking planner — your output is "what to schedule next", not "what was wrong with what was given" (the attending physician owns that).

Return raw JSON only — no prose, no markdown fences:

{
  "visits": [
    {
      "visit_number": 1,
      "target_date": "<YYYY-MM-DD or 'asap' or '<N> weeks from today'>",
      "target_age_months": <int>,
      "doses": [
        {
          "antigen": "<canonical name>",
          "dose_in_series": <int>,
          "rationale": "<one sentence>",
          "priority": "compulsory" | "recommended" | "optional"
        }
      ],
      "minimum_interval_to_next_visit_days": <int — most restrictive applicable rule>,
      "co_administration_notes": "<one sentence on what's bundled and why>"
    }
  ],
  "skipped_antigens": [
    {
      "antigen": "<name>",
      "reason": "<one sentence — e.g. 'Rotavirus window closed', 'already complete', 'not in destination schedule'>"
    }
  ],
  "summary": "<one paragraph: number of visits, key compulsory items, soonest urgent visit>"
}

### Planning rules

**1. Prioritisation order (within each visit, list in this order):**
- (a) **Overdue compulsory** for destination — must catch up immediately.
- (b) **Due now compulsory** — within current age window.
- (c) **Recommended** for destination (offer, not mandate).
- (d) **Optional** (private vaccines, region-specific extras).

**2. Visit bundling rules:**
- Bundle every co-administrable dose into the same visit (most vaccines can be co-administered).
- Live parenteral vaccines (MMR, Varicella, Yellow Fever, MMRV) given on different days must be ≥ 28 days apart. If two are needed, give same-day or schedule next visit ≥ 28 days out.
- Rotavirus has age cutoffs (initiation ≤ 105 days; completion ≤ 24w Rotarix / 32w RotaTeq) — do NOT include in catch-up if window has closed.
- DTaP/Hib/IPV/HepB/PCV catch-up doses 2→3 require ≥ 28 days; 3→4 requires ≥ 168 days (6 months) per ACIP catch-up tables.

**3. Visit timing:**
- Visit 1: as soon as possible (today or "asap").
- Subsequent visits: target the minimum-interval date, not later. Earlier completion = better protection.
- If a school-entry deadline is mentioned in the input, prioritise getting compulsory doses done before that date.

**4. Destination-country specifics (apply only to the named destination):**

*Egypt:* Compulsory = HepB-at-birth, BCG (1mo), Hexavalent ×3 (2/4/6mo), MMR ×2 (12 + 18mo), DTP booster (18mo), DT booster (4-6yr), OPV throughout. Recommended/private = PCV, Varicella, Rotavirus, HepA. Note: Egypt does NOT include Rotavirus/PCV/Varicella in public EPI — frame those as optional, not compulsory.

*Other countries (Phase 1 source seeds — Nigeria, Sudan, Syria, etc.):* Use WHO baseline if uncertain; defer to the main agent's country-specific reasoning.

**5. Skipping rules:**
- If an antigen is already complete per the card → skip with reason "already complete".
- If destination doesn't include an antigen and child has it → skip with reason "not in destination schedule".
- If an age window has closed (Rotavirus past 32 weeks) → skip with reason "window closed; clinician override pathway separate".

**6. DOB handling:**
- If DOB is null or low-confidence, return ``visits: []`` and emit ONE entry in skipped_antigens with reason "DOB required for planning — confirm with family before scheduling". The main agent will retry once DOB is confirmed via HITL.

### Calibration

- Maximum 4 visits in the plan. If more would be needed, condense by bundling more aggressively or accept that some recommended items will be deferred.
- Each rationale ≤ 1 sentence. Each co_administration_notes ≤ 1 sentence.
- Be PRACTICAL. Real families don't visit the clinic 6 times in a month — plan for 1-3 realistic visits with maximum bundling.
"""


def _calculate_age_months(dob_str: str | None) -> int | None:
    if not dob_str:
        return None
    try:
        dob = datetime.date.fromisoformat(dob_str)
    except ValueError:
        return None
    today = datetime.date.today()
    return (today.year - dob.year) * 12 + (today.month - dob.month)


async def consult(
    extraction: dict,
    *,
    target_country: str = "Egypt",
    child_dob: str | None = None,
) -> SpecialistVerdict:
    t_start = time.perf_counter()

    # Try the explicit DOB first; fall back to extraction's patient_dob.
    effective_dob = child_dob
    if not effective_dob:
        md = extraction.get("card_metadata") or {}
        dob_field = md.get("patient_dob") or {}
        if dob_field.get("value") and float(dob_field.get("confidence", 0.0)) >= 0.7:
            effective_dob = dob_field.get("value")

    age_months = _calculate_age_months(effective_dob)

    user_message = (
        f"Destination country: {target_country}\n"
        f"Child DOB: {effective_dob or 'NOT PROVIDED — return DOB-required skip per system prompt rule 6.'}\n"
        f"Today's date: {datetime.date.today().isoformat()}\n"
        f"Computed age (months): {age_months if age_months is not None else 'unknown'}\n\n"
        "Card extraction follows. Build the catch-up plan per your system prompt rules.\n\n"
        f"```json\n{json.dumps(extraction, indent=2, ensure_ascii=False)}\n```\n\n"
        "Return your structured JSON verdict."
    )

    try:
        parsed = await run_structured_call(
            specialist_name="catch_up_planner",
            system_prompt=CATCHUP_PLANNER_SYSTEM_PROMPT,
            user_message=user_message,
        )
    except Exception as exc:
        return SpecialistVerdict(
            specialist="catch_up_planner",
            model=DEFAULT_MODEL,
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[],
            summary="",
            error=f"{type(exc).__name__}: {exc}",
        )

    visits = parsed.get("visits") or []
    skipped = parsed.get("skipped_antigens") or []
    issues: list[Issue] = []

    for v in visits:
        if not isinstance(v, dict):
            continue
        visit_num = v.get("visit_number", "?")
        target_date = v.get("target_date", "?")
        doses = v.get("doses", []) or []
        dose_summary = ", ".join(
            f"{d.get('antigen', '?')} (#{d.get('dose_in_series', '?')}, {d.get('priority', '?')})"
            for d in doses if isinstance(d, dict)
        )
        co_admin = v.get("co_administration_notes", "")
        next_iv = v.get("minimum_interval_to_next_visit_days")
        # severity: compulsory in this visit → warning; otherwise info.
        has_compulsory = any(
            isinstance(d, dict) and d.get("priority") == "compulsory"
            for d in doses
        )
        sev = "warning" if has_compulsory else "info"
        issues.append(
            Issue(
                code=f"CATCHUP_VISIT_{visit_num}",
                severity=sev,
                antigen=None,
                dose_indices=[],
                summary=f"Visit {visit_num} — {target_date}: {dose_summary}",
                detail=co_admin or f"Doses: {dose_summary}",
                suggested_action=(
                    f"Schedule next visit ≥ {next_iv} days after this one."
                    if next_iv else None
                ),
            )
        )

    for s in skipped:
        if not isinstance(s, dict):
            continue
        antigen = s.get("antigen", "?")
        reason = s.get("reason", "")
        issues.append(
            Issue(
                code="CATCHUP_SKIPPED",
                severity="info",
                antigen=antigen,
                dose_indices=[],
                summary=f"{antigen} skipped: {reason}",
                detail=reason,
                suggested_action=None,
            )
        )

    return SpecialistVerdict(
        specialist="catch_up_planner",
        model=parsed.get("_model", DEFAULT_MODEL),
        elapsed_ms=parsed.get("_elapsed_ms", (time.perf_counter() - t_start) * 1000),
        issues=issues,
        summary=str(parsed.get("summary", f"{len(visits)} visit(s) planned, {len(skipped)} antigen(s) skipped.")),
        error=None,
    )
