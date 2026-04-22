"""Tool: get_schedule — load and filter a country's vaccination schedule."""

import json
from pathlib import Path
from claude_agent_sdk import tool

SCHEDULES_DIR = Path(__file__).parent.parent.parent.parent.parent / "data" / "schedules"

COUNTRY_MAP = {
    "egypt": "egypt.json",
    "ägypten": "egypt.json",
    "egy": "egypt.json",
    "eg": "egypt.json",
    "nigeria": "nigeria.json",
    "nga": "nigeria.json",
    "ng": "nigeria.json",
    "who": "who.json",
    "world health organization": "who.json",
    # Other schedules are available but not part of the primary scope.
    "germany": "germany.json",
    "deutschland": "germany.json",
    "deu": "germany.json",
    "de": "germany.json",
}


def _load_schedule(country_key: str) -> dict | None:
    filename = COUNTRY_MAP.get(country_key.lower().strip())
    if filename is None:
        return None
    path = SCHEDULES_DIR / filename
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


@tool(
    "get_schedule",
    "Load the vaccination schedule for a country and filter it to doses relevant for a child of the specified age. Valid countries: Egypt, Nigeria, WHO. Returns the list of doses and interval rules relevant to the child's current age, plus schedule metadata.",
    {"country_code": str, "child_age_months": int},
)
async def get_schedule(args: dict) -> dict:
    country = args["country_code"]
    child_age_months = args.get("child_age_months", 0)

    schedule = _load_schedule(country)
    if schedule is None:
        result = {
            "error": f"Schedule not found for country '{country}'. Supported: Egypt, Nigeria, WHO.",
            "supported_countries": list({v.replace(".json", "") for v in COUNTRY_MAP.values()}),
        }
        return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}

    # Filter doses: include all doses with recommended_age_months <= child_age_months + 24
    # (show what's due now and upcoming in the next 2 years)
    lookahead_months = child_age_months + 24
    relevant_doses = [
        d for d in schedule.get("doses", [])
        if d.get("recommended_age_months") is not None
        and d["recommended_age_months"] <= lookahead_months
    ]

    result = {
        "country": schedule["country"],
        "country_code": schedule["country_code"],
        "source": schedule["source"],
        "last_updated": schedule["last_updated"],
        "child_age_months": child_age_months,
        "filter_applied": f"doses with recommended_age_months <= {lookahead_months}",
        "total_doses_in_schedule": len(schedule.get("doses", [])),
        "doses_returned": len(relevant_doses),
        "doses": relevant_doses,
        "interval_rules": schedule.get("interval_rules", []),
        "key_differences_vs_egypt": schedule.get("key_differences_vs_egypt"),
        "key_features": schedule.get("key_features"),
        "not_in_schedule": schedule.get("not_in_schedule"),
        "context_note": schedule.get("context_note"),
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
