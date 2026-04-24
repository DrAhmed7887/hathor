"""Tool: validate_dose — full per-dose validity check."""

import json
from claude_agent_sdk import tool

# Minimum age in days for first valid dose, by antigen.
# Source: ACIP general minimum ages + STIKO where stricter.
MIN_AGE_DAYS: dict[str, int] = {
    "DTaP": 42,       # 6 weeks
    "DPT": 42,
    "HepB": 0,        # birth dose acceptable
    "Hib": 42,        # 6 weeks
    "IPV": 42,        # 6 weeks
    "OPV": 0,
    "PCV": 42,        # 6 weeks
    "MenB": 42,       # 6 weeks (STIKO)
    "MenC": 60,       # 2 months
    "MenACWY": 270,   # 9 months (STIKO standard; varies by product)
    "MMR": 270,       # 9 months (minimum valid; STIKO standard is 11 months)
    "Measles": 180,   # 6 months (only as emergency MCV0; not counted in primary series)
    "Rubella": 270,
    "Varicella": 270, # 9 months minimum (STIKO standard is 11 months)
    "Rotavirus": 42,  # 6 weeks; must COMPLETE series before 730 days (24 months)
    "BCG": 0,
    "HepA": 365,      # 12 months
}

# Maximum age for certain vaccines
MAX_AGE_DAYS: dict[str, int] = {
    "Rotavirus": 730,  # Series must be completed by 24 months
    "Hib": 1825,       # 5 years (no benefit after 5 years)
}


@tool(
    "validate_dose",
    "Validate a single vaccination dose against the target country's schedule. Checks minimum age at time of dose, dose position appropriateness, and minimum interval from the prior dose (if provided). Returns valid/invalid with specific reasons and flags for the agent to reason about. prior_dose_age_days: age in days of the prior dose in this series, or omitted/None for dose 1 or any dose without a prior reference.",
    {
        "type": "object",
        "properties": {
            "antigen": {"type": "string"},
            "dose_number": {"type": "integer"},
            "age_at_dose_days": {"type": "integer"},
            "target_country": {"type": "string"},
            "prior_dose_age_days": {"type": "integer"},
        },
        "required": ["antigen", "dose_number", "age_at_dose_days", "target_country"],
    },
)
async def validate_dose(args: dict) -> dict:
    antigen = args["antigen"]
    dose_number = args["dose_number"]
    age_days = args["age_at_dose_days"]
    target_country = args.get("target_country", "Egypt")
    prior_age = args.get("prior_dose_age_days")

    reasons: list[str] = []
    flags: list[str] = []
    valid = True

    # 1. Minimum age check
    min_age = MIN_AGE_DAYS.get(antigen, 42)
    if age_days < min_age:
        valid = False
        reasons.append(
            f"Given at {age_days} days — below minimum age of {min_age} days for {antigen}."
        )

    # 2. Maximum age check (Rotavirus only in 0–6y scope)
    max_age = MAX_AGE_DAYS.get(antigen)
    if max_age and age_days > max_age:
        valid = False
        reasons.append(
            f"Given at {age_days} days — above maximum valid age of {max_age} days for {antigen}."
        )

    # 3. Interval check from prior dose
    if prior_age is not None:
        from hathor.tools.intervals import _get_min_interval
        min_interval, rule_source = _get_min_interval(antigen, dose_number - 1, dose_number)
        actual_interval = age_days - prior_age
        if actual_interval < min_interval:
            valid = False
            reasons.append(
                f"Interval from prior dose: {actual_interval} days, minimum required: {min_interval} days ({rule_source})."
            )
        else:
            flags.append(f"Interval from prior dose: {actual_interval} days (minimum {min_interval} days — OK).")

    # 4. Age-appropriateness flag (not invalidating, just informational)
    if antigen == "MMR" and dose_number == 1 and age_days < 330:
        flags.append(
            "MMR dose 1 given before 11 months — below STIKO standard age (11 months). "
            "May be clinically valid in the source country but falls below Germany's standard timing. "
            "STIKO may accept doses given from 9 months; verify with local paediatrician."
        )

    if antigen == "Varicella" and dose_number == 1 and age_days < 330:
        flags.append(
            "Varicella dose 1 given before 11 months — below STIKO standard age. "
            "STIKO minimum is 9 months; check if this dose satisfies the requirement."
        )

    if not reasons and valid:
        reasons.append("Dose meets minimum age and interval requirements.")

    result = {
        "antigen": antigen,
        "dose_number": dose_number,
        "age_at_dose_days": age_days,
        "target_country": target_country,
        "prior_dose_age_days": prior_age,
        "valid": valid,
        "reasons": reasons,
        "flags": flags,
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
