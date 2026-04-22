"""Tool: build_catchup_schedule — generate a catch-up plan for missing doses."""

import json
from claude_agent_sdk import tool

# Minimum catch-up intervals in days, by antigen.
# More conservative than primary-series minimums in some cases.
CATCHUP_MIN_INTERVALS: dict[str, int] = {
    "DTaP": 28,
    "DPT": 28,
    "HepB": 28,
    "Hib": 28,
    "IPV": 28,
    "PCV": 56,       # 8 weeks minimum for catch-up doses
    "MenB": 56,
    "MMR": 28,
    "Varicella": 84, # 3 months preferred between catch-up doses
    "Rotavirus": 28,
    "OPV": 28,
}


@tool(
    "build_catchup_schedule",
    "Generate a catch-up vaccination plan for doses that are overdue or missing. Input: list of overdue/missing doses (from compute_missing_doses), current age in days, and target country. Returns a prioritised catch-up schedule with recommended visit intervals and clinical notes. Day 2 implementation covers basic ordering; complex edge cases flagged for paediatrician review.",
    {
        "overdue_doses": list,
        "due_now_doses": list,
        "current_age_days": int,
        "target_country": str,
    },
)
async def build_catchup_schedule(args: dict) -> dict:
    overdue: list[dict] = args.get("overdue_doses", [])
    due_now: list[dict] = args.get("due_now_doses", [])
    current_age_days: int = args["current_age_days"]
    target_country: str = args.get("target_country", "Egypt")
    current_age_months = current_age_days / 30.44

    # Combine overdue + due_now; prioritise overdue first
    all_needed = overdue + [d for d in due_now if d not in overdue]

    if not all_needed:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "target_country": target_country,
                            "current_age_days": current_age_days,
                            "message": "No overdue or due-now doses found. Catch-up schedule is empty.",
                            "visits": [],
                        },
                        indent=2,
                    ),
                }
            ]
        }

    LIVE_VACCINES = {"MMR", "Varicella", "Rotavirus", "OPV", "BCG"}

    # Assign each dose to a visit day (offset from today in days), enforcing
    # minimum inter-dose intervals. Same-antigen doses can never share a visit.
    antigen_last_day: dict[str, int] = {}
    # day_offset → list of doses scheduled that day
    day_to_doses: dict[int, list] = {}

    # Sort: overdue first (already in overdue+due_now order from all_needed),
    # then within same priority group, non-live before live to anchor early visits.
    sorted_needed = sorted(
        all_needed,
        key=lambda d: (0 if d["antigen"] not in LIVE_VACCINES else 1),
    )

    for dose in sorted_needed:
        antigen = dose["antigen"]
        min_interval = CATCHUP_MIN_INTERVALS.get(antigen, 28)

        if antigen not in antigen_last_day:
            earliest_day = 0  # first dose of this antigen: today
        else:
            earliest_day = antigen_last_day[antigen] + min_interval

        # Snap to an existing visit on or after earliest_day, or open a new one
        chosen_day: int | None = None
        for vday in sorted(day_to_doses.keys()):
            if vday >= earliest_day:
                # Don't place two doses of the same antigen in the same visit
                if not any(d["antigen"] == antigen for d in day_to_doses[vday]):
                    chosen_day = vday
                    break

        if chosen_day is None:
            chosen_day = earliest_day

        day_to_doses.setdefault(chosen_day, []).append(dose)
        antigen_last_day[antigen] = chosen_day

    # Convert day-keyed buckets to visit list
    visits = []
    for visit_num, day_offset in enumerate(sorted(day_to_doses.keys()), start=1):
        doses_this_visit = day_to_doses[day_offset]
        age_at_visit_months = round((current_age_days + day_offset) / 30.44, 1)

        if day_offset == 0:
            timing = "As soon as possible (today)"
        else:
            timing = f"≥ {day_offset} days from today"

        live_in_visit = [d for d in doses_this_visit if d["antigen"] in LIVE_VACCINES]
        notes_parts = []
        if live_in_visit and len(live_in_visit) < len(doses_this_visit):
            notes_parts.append(
                "Visit contains both live and non-live vaccines — this co-administration is permitted."
            )
        if len(live_in_visit) > 1:
            notes_parts.append(
                "Multiple live vaccines in same visit — confirm all can be co-administered per current guidance."
            )
        for d in doses_this_visit:
            iv = CATCHUP_MIN_INTERVALS.get(d["antigen"], 28)
            if antigen_last_day.get(d["antigen"], 0) > day_offset:
                notes_parts.append(
                    f"{d['antigen']}: next dose must be ≥ {iv} days after this visit."
                )

        visits.append(
            {
                "visit_number": visit_num,
                "day_offset_from_today": day_offset,
                "timing": timing,
                "estimated_age_months": age_at_visit_months,
                "doses": doses_this_visit,
                "notes": " ".join(notes_parts) if notes_parts else "Standard co-administration rules apply.",
            }
        )

    paediatrician_flags = []

    # Flag cases that need clinical judgement
    varicella_doses = [d for d in all_needed if d["antigen"] == "Varicella"]
    if varicella_doses:
        paediatrician_flags.append(
            "Varicella catch-up: verify whether the child has had natural chickenpox infection — if so, no vaccine needed. "
            "If uncertain, serology can confirm immunity."
        )

    rotavirus_doses = [d for d in all_needed if d["antigen"] == "Rotavirus"]
    if rotavirus_doses and current_age_days > 548:  # > 18 months
        paediatrician_flags.append(
            "Rotavirus catch-up: child is >18 months — STIKO does not recommend starting Rotavirus series after this age. "
            "Discuss with paediatrician whether catch-up is appropriate."
        )

    if current_age_months > 12:
        paediatrician_flags.append(
            "Child is over 12 months: some catch-up rules differ from the infant primary series. "
            "Verify specific catch-up intervals with a STIKO-certified paediatrician."
        )

    result = {
        "target_country": target_country,
        "current_age_days": current_age_days,
        "current_age_months_approx": round(current_age_months, 1),
        "total_doses_needed": len(all_needed),
        "suggested_visits": visits,
        "paediatrician_flags": paediatrician_flags,
        "disclaimer": (
            "This is a decision-support output, not a prescription. "
            "Final catch-up schedule must be confirmed by a licensed paediatrician. "
            "STIKO catch-up guidance: https://www.rki.de"
        ),
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
