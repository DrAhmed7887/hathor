"""Tool: compute_age_at_dose — pure date arithmetic."""

import json
from datetime import date, datetime
from claude_agent_sdk import tool


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


@tool(
    "compute_age_at_dose",
    "Calculate how old a child was when a dose was given. Input: child's date of birth and the date the dose was administered (both ISO 8601: YYYY-MM-DD). Returns age in days, whole months, and a human-readable string.",
    {"date_of_birth": str, "date_given": str},
)
async def compute_age_at_dose(args: dict) -> dict:
    dob = _parse_date(args["date_of_birth"])
    dose_date = _parse_date(args["date_given"])

    if dose_date < dob:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"error": "date_given is before date_of_birth"}),
                }
            ]
        }

    age_days = (dose_date - dob).days

    months = 0
    d = dob
    while True:
        m = d.month + 1
        y = d.year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        next_month = d.replace(year=y, month=m)
        if next_month > dose_date:
            break
        d = next_month
        months += 1

    years = months // 12
    rem_months = months % 12

    if years > 0 and rem_months > 0:
        human = f"{years} year{'s' if years != 1 else ''} {rem_months} month{'s' if rem_months != 1 else ''}"
    elif years > 0:
        human = f"{years} year{'s' if years != 1 else ''}"
    elif months > 0:
        human = f"{months} month{'s' if months != 1 else ''}"
    else:
        human = f"{age_days} day{'s' if age_days != 1 else ''}"

    result = {
        "date_of_birth": str(dob),
        "date_given": str(dose_date),
        "age_days": age_days,
        "age_months": months,
        "age_years_and_months": {"years": years, "months": rem_months},
        "human_readable": human,
    }
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
