"""Tool: compute_missing_doses — diff validated history against target schedule."""

import json
from claude_agent_sdk import tool


@tool(
    "compute_missing_doses",
    "Compare a child's validated vaccination history against the target country's schedule to identify gaps. Input: validated_history (list of dicts with antigen, dose_number, age_days, valid) and target_schedule (list of dose dicts from get_schedule). Returns doses completed, missing, overdue, due_now, and upcoming.",
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
    target_country: str = args.get("target_country", "Germany")
    current_age_months = current_age_days / 30.44

    # Build a set of (antigen, dose_number) that the child has received and are valid
    valid_doses: set[tuple[str, int]] = set()
    invalid_doses: list[dict] = []
    for entry in history:
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
