"""Normalize WHO/XMart AGEADMINISTERED schedule age codes."""

from __future__ import annotations

import re
from typing import Any

_AGE_CODE_RE = re.compile(r"^(?P<unit>[DWMY])(?P<value>\d+(?:\.\d+)?)$", re.I)
_CONTACT_BASED = {
    "1st contact",
    "first contact",
    "at first contact",
    "fc",
}


def _as_number(raw: str) -> int | float:
    value = float(raw)
    return int(value) if value.is_integer() else value


def parse_age_administered(source_age_code: str | None) -> dict[str, Any]:
    """Parse a WHO/XMart AGEADMINISTERED value into stable fields.

    Supported examples:
    - ``B`` -> birth
    - ``W6`` -> 6 weeks
    - ``M9`` -> 9 months
    - ``Y9`` -> 9 years
    - ``1st contact`` -> contact-based, non-fixed age
    """

    if source_age_code is None:
        return {
            "source_age_code": None,
            "recommended_age_unit": None,
            "recommended_age_value": None,
            "recommended_age_months": None,
            "is_birth_dose": False,
            "age_is_fixed": False,
        }

    code = str(source_age_code).strip()
    lowered = code.lower()

    if lowered == "b":
        return {
            "source_age_code": code,
            "recommended_age_unit": "birth",
            "recommended_age_value": 0,
            "recommended_age_months": 0,
            "is_birth_dose": True,
            "age_is_fixed": True,
        }

    if lowered in _CONTACT_BASED:
        return {
            "source_age_code": code,
            "recommended_age_unit": "contact_based",
            "recommended_age_value": None,
            "recommended_age_months": None,
            "is_birth_dose": False,
            "age_is_fixed": False,
        }

    match = _AGE_CODE_RE.match(code)
    if match is None:
        return {
            "source_age_code": code,
            "recommended_age_unit": "unparsed",
            "recommended_age_value": None,
            "recommended_age_months": None,
            "is_birth_dose": False,
            "age_is_fixed": False,
        }

    unit_code = match.group("unit").upper()
    value = _as_number(match.group("value"))
    unit_map = {
        "D": "days",
        "W": "weeks",
        "M": "months",
        "Y": "years",
    }
    months = {
        "D": round(float(value) / 30.4375, 2),
        "W": round(float(value) * 7 / 30.4375, 2),
        "M": float(value),
        "Y": float(value) * 12,
    }[unit_code]

    return {
        "source_age_code": code,
        "recommended_age_unit": unit_map[unit_code],
        "recommended_age_value": value,
        "recommended_age_months": int(months) if months.is_integer() else months,
        "is_birth_dose": False,
        "age_is_fixed": True,
    }


def with_normalized_age(dose: dict[str, Any]) -> dict[str, Any]:
    """Return a dose row with normalized age fields added when possible."""

    source_age_code = dose.get("source_age_code") or dose.get("AGEADMINISTERED")
    parsed = parse_age_administered(source_age_code)
    out = {**dose}
    for key, value in parsed.items():
        out.setdefault(key, value)
    return out
