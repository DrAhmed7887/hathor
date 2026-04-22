"""Tool: compute_missing_doses — diff validated history against target schedule.

Antigen normalisation: if the agent validates individual component antigens
(e.g. "Measles", "Mumps", "Rubella" separately), they are rolled up to their
canonical combined-vaccine key (e.g. "MMR") before the schedule diff runs.
This prevents silent gaps when a validated combined dose is reported as components.
"""

import json
from claude_agent_sdk import tool

# Map sets of individual component antigens → canonical schedule key.
# Keys are frozensets so order doesn't matter.
_ROLLUP_TABLE: dict[frozenset, str] = {
    frozenset({"Measles", "Mumps", "Rubella"}): "MMR",
    frozenset({"Measles", "Rubella"}): "MR",
    frozenset({"Measles", "Mumps", "Rubella", "Varicella"}): "MMRV",
    frozenset({"Diphtheria", "Tetanus", "Pertussis"}): "DTaP",
    frozenset({"Diphtheria", "Tetanus", "Pertussis", "Polio"}): "DTaP-IPV",
}

# Reverse map: individual component → its parent combined-vaccine key (for single-entry normalisation)
_COMPONENT_TO_COMBINED: dict[str, str] = {
    "Measles": "MMR",
    "Mumps": "MMR",
    "Rubella": "MMR",
}


def _normalise_antigen(antigen: str) -> str:
    """Map individual component antigens to their canonical combined-vaccine key."""
    return _COMPONENT_TO_COMBINED.get(antigen, antigen)


@tool(
    "compute_missing_doses",
    "Compare a child's validated vaccination history against the target country's schedule to identify gaps. Input: validated_history (list of dicts with antigen, dose_number, age_days, valid) and target_schedule (list of dose dicts from get_schedule). Returns doses completed, missing, overdue, due_now, and upcoming. NOTE: individual component antigens (Measles/Mumps/Rubella) are automatically rolled up to their combined key (MMR) before the diff.",
    {
        "validated_history": list,
        "target_schedule": list,
        "current_age_days": int,
        "target_country": str,
    },
)
async def compute_missing_doses(args: dict) -> dict:
    history: list[dict] = args["validated_history"]
    schedule: list[dict] = args["target_schedule"]
    current_age_days: int = args["current_age_days"]
    target_country: str = args.get("target_country", "Egypt")
    current_age_months = current_age_days / 30.44

    # Normalise component antigens in history to canonical combined-vaccine keys
    normalised_history = [
        {**entry, "antigen": _normalise_antigen(entry["antigen"])}
        if "antigen" in entry
        else entry
        for entry in history
    ]

    # Build a set of (antigen, dose_number) that the child has received and are valid
    valid_doses: set[tuple[str, int]] = set()
    invalid_doses: list[dict] = []
    for entry in normalised_history:
        if entry.get("valid", False):
            valid_doses.add((entry["antigen"], entry["dose_number"]))
        else:
            invalid_doses.append(entry)

    completed: list[dict] = []
    missing: list[dict] = []
    overdue: list[dict] = []
    due_now: list[dict] = []
    upcoming: list[dict] = []

    # Tolerance windows (months)
    DUE_NOW_WINDOW = 2  # dose is "due now" if recommended age is within 2 months of current age

    for dose in schedule:
        antigen = dose.get("antigen")
        dose_num = dose.get("dose_number")
        rec_age_months = dose.get("recommended_age_months")
        min_age_months = dose.get("minimum_age_months", rec_age_months)
        category = dose.get("category", "compulsory")

        if antigen is None or dose_num is None:
            continue

        key = (antigen, dose_num)
        dose_summary = {
            "antigen": antigen,
            "dose_number": dose_num,
            "recommended_age_months": rec_age_months,
            "minimum_age_months": min_age_months,
            "category": category,
            "notes": dose.get("notes", ""),
        }

        if key in valid_doses:
            completed.append({**dose_summary, "status": "completed"})
        elif rec_age_months is not None and rec_age_months < current_age_months - DUE_NOW_WINDOW:
            overdue.append({**dose_summary, "status": "overdue", "months_overdue": round(current_age_months - rec_age_months, 1)})
        elif rec_age_months is not None and rec_age_months <= current_age_months + DUE_NOW_WINDOW:
            due_now.append({**dose_summary, "status": "due_now"})
        else:
            upcoming.append({**dose_summary, "status": "upcoming"})
            missing.append({**dose_summary, "status": "missing_not_yet_due"})

    # Doses missing = overdue + (some upcoming that are legitimately missed)
    # For cleaner output, separate overdue from future-due
    all_missing = overdue + [d for d in missing if d not in overdue]

    result = {
        "target_country": target_country,
        "current_age_days": current_age_days,
        "current_age_months_approx": round(current_age_months, 1),
        "summary": {
            "completed": len(completed),
            "overdue": len(overdue),
            "due_now": len(due_now),
            "upcoming": len(upcoming),
            "invalid_doses_in_history": len(invalid_doses),
        },
        "completed": completed,
        "overdue": overdue,
        "due_now": due_now,
        "upcoming": upcoming,
        "invalid_doses": invalid_doses,
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
