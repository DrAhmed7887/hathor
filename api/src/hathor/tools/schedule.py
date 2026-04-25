"""Tool: get_schedule — load and filter a country's vaccination schedule."""

import json
from pathlib import Path
from claude_agent_sdk import tool
from hathor.schedules.age import with_normalized_age

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


def _derive_months_from_legacy_fields(dose: dict) -> dict:
    """Keep week-based legacy seeds visible to month-based filters."""

    normalized = with_normalized_age(dose)
    if normalized.get("recommended_age_months") is None:
        weeks = normalized.get("recommended_age_weeks")
        years = normalized.get("recommended_age_years")
        if isinstance(weeks, (int, float)):
            if normalized.get("recommended_age_unit") is None:
                normalized["recommended_age_unit"] = "weeks"
            if normalized.get("recommended_age_value") is None:
                normalized["recommended_age_value"] = weeks
            normalized["recommended_age_months"] = round(float(weeks) * 7 / 30.4375, 2)
        elif isinstance(years, (int, float)):
            if normalized.get("recommended_age_unit") is None:
                normalized["recommended_age_unit"] = "years"
            if normalized.get("recommended_age_value") is None:
                normalized["recommended_age_value"] = years
            normalized["recommended_age_months"] = float(years) * 12
    if normalized.get("minimum_age_months") is None:
        weeks = normalized.get("minimum_age_weeks")
        years = normalized.get("minimum_age_years")
        if isinstance(weeks, (int, float)):
            normalized["minimum_age_months"] = round(float(weeks) * 7 / 30.4375, 2)
        elif isinstance(years, (int, float)):
            normalized["minimum_age_months"] = float(years) * 12
    return normalized


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
    normalized_doses = [
        _derive_months_from_legacy_fields(d)
        for d in schedule.get("doses", [])
    ]
    relevant_doses = [
        d for d in normalized_doses
        if d.get("recommended_age_months") is not None
        and d["recommended_age_months"] <= lookahead_months
    ]

    result = {
        "country": schedule["country"],
        "country_code": schedule["country_code"],
        "source": schedule["source"],
        "source_url": schedule.get("source_url"),
        "source_urls": schedule.get("source_urls", []),
        "source_name": schedule.get("source_name", schedule.get("source")),
        "source_year_or_release_date": schedule.get("source_year_or_release_date"),
        "last_updated": schedule["last_updated"],
        "last_verified_at": schedule.get("last_verified_at", schedule.get("last_updated")),
        "safety_note": "Schedule guidance requires clinician/public-health confirmation.",
        "source_note": "Based on WHO/UNICEF country-reported schedule sources where available.",
        "child_age_months": child_age_months,
        "filter_applied": f"doses with recommended_age_months <= {lookahead_months}",
        "total_doses_in_schedule": len(normalized_doses),
        "doses_returned": len(relevant_doses),
        "doses": relevant_doses,
        "interval_rules": schedule.get("interval_rules", []),
        "key_differences_vs_egypt": schedule.get("key_differences_vs_egypt"),
        "key_features": schedule.get("key_features"),
        "not_in_schedule": schedule.get("not_in_schedule"),
        "context_note": schedule.get("context_note"),
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
