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
    target_country: str = args.get("target_country", "Germany")
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

    # Group doses into visit buckets — naive approach for Day 2:
    # Visit 1: all overdue compulsory doses that can be given together
    # Visit 2 (4 weeks later): next round
    # Flag live vaccines that need 4-week separation
    LIVE_VACCINES = {"MMR", "Varicella", "Rotavirus", "OPV", "BCG"}

    # Separate live from non-live for scheduling
    live_needed = [d for d in all_needed if d["antigen"] in LIVE_VACCINES]
    non_live_needed = [d for d in all_needed if d["antigen"] not in LIVE_VACCINES]

    visits = []

    # Visit 1: non-live vaccines (can all be given same day)
    if non_live_needed:
        visits.append(
            {
                "visit_number": 1,
                "timing": "As soon as possible (today)",
                "estimated_age_months": round(current_age_months, 1),
                "doses": non_live_needed,
                "notes": "All non-live vaccines can be co-administered. No interval constraints between them.",
            }
        )

    # Visit 2: live vaccines (can give MMR + Varicella together on same day)
    if live_needed:
        mmr = [d for d in live_needed if d["antigen"] == "MMR"]
        varicella = [d for d in live_needed if d["antigen"] == "Varicella"]
        other_live = [d for d in live_needed if d["antigen"] not in ("MMR", "Varicella")]

        if mmr or varicella:
            visit_timing_days = 0 if not non_live_needed else 0  # can be same day as non-live
            visits.append(
                {
                    "visit_number": len(visits) + 1,
                    "timing": "Same visit as non-live vaccines, OR any time",
                    "estimated_age_months": round(current_age_months, 1),
                    "doses": mmr + varicella,
                    "notes": (
                        "MMR and Varicella can be given on the same day as each other and on the same day as non-live vaccines. "
                        "If NOT given on the same day as other live vaccines, a minimum 28-day gap is required between different live vaccines."
                    ),
                }
            )

        if other_live:
            visits.append(
                {
                    "visit_number": len(visits) + 1,
                    "timing": "Same day as MMR/Varicella, or minimum 28 days later if not co-administered",
                    "estimated_age_months": round(current_age_months + 1, 1),
                    "doses": other_live,
                    "notes": "Other live vaccines not listed above. Check specific co-administration rules.",
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
