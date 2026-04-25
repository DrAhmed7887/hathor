"""Lightweight validation for Hathor schedule seed files."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from hathor.schedules.age import parse_age_administered

_ISO3_RE = re.compile(r"^[A-Z]{3}$")


def _has_source_metadata(schedule: dict[str, Any]) -> bool:
    has_name = bool(
        schedule.get("source")
        or schedule.get("source_name")
        or schedule.get("source_title")
    )
    has_url = bool(
        schedule.get("source_url")
        or schedule.get("source_urls")
        or schedule.get("sources")
    )
    return has_name and has_url


def _has_verified_date(schedule: dict[str, Any]) -> bool:
    value = schedule.get("last_verified_at") or schedule.get("last_updated")
    if not isinstance(value, str) or not value:
        return False
    if re.match(r"^\d{4}(-\d{2})?$", value):
        return True
    try:
        date.fromisoformat(value[:10])
    except ValueError:
        return False
    return True


def _validate_dose(index: int, dose: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if not isinstance(dose.get("antigen"), str) or not dose["antigen"].strip():
        errors.append(f"doses[{index}].antigen is required")

    dose_number = dose.get("dose_number")
    if dose_number is not None and not isinstance(dose_number, int):
        errors.append(f"doses[{index}].dose_number must be an integer or null")

    product_label = dose.get("product_label") or dose.get("local_vaccine_name")
    components = dose.get("components")
    if components is not None and not isinstance(components, list):
        errors.append(f"doses[{index}].components must be a list when present")
    if product_label is not None and not isinstance(product_label, str):
        errors.append(f"doses[{index}].product/local vaccine label must be text")

    has_age = any(
        key in dose
        for key in (
            "source_age_code",
            "recommended_age_unit",
            "recommended_age_months",
            "recommended_age_weeks",
            "recommended_age_years",
        )
    )
    if not has_age:
        errors.append(f"doses[{index}] must include a recommended age field")

    if "source_age_code" in dose:
        parsed = parse_age_administered(dose.get("source_age_code"))
        if parsed["recommended_age_unit"] == "unparsed":
            errors.append(f"doses[{index}].source_age_code is not recognized")

    for key in ("recommended_age_months", "recommended_age_weeks", "minimum_age_months", "minimum_age_weeks"):
        if key in dose and dose[key] is not None and not isinstance(dose[key], (int, float)):
            errors.append(f"doses[{index}].{key} must be numeric or null")

    return errors


def validate_schedule_seed(schedule: dict[str, Any]) -> list[str]:
    """Return validation errors for a schedule seed. Empty list means valid."""

    errors: list[str] = []

    country_code = schedule.get("country_code")
    if not isinstance(country_code, str) or not _ISO3_RE.match(country_code):
        errors.append("country_code must be an ISO-3 uppercase code")

    if not schedule.get("country"):
        errors.append("country is required")

    if not _has_source_metadata(schedule):
        errors.append("source metadata must include a source name and URL")

    if not _has_verified_date(schedule):
        errors.append("last_verified_at or last_updated must be an ISO date")

    doses = schedule.get("doses")
    if not isinstance(doses, list) or not doses:
        errors.append("doses must be a non-empty list")
        return errors

    for index, dose in enumerate(doses):
        if not isinstance(dose, dict):
            errors.append(f"doses[{index}] must be an object")
            continue
        errors.extend(_validate_dose(index, dose))

    return errors
