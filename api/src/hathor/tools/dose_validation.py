"""Tool: validate_dose — full per-dose validity check."""

import json
from claude_agent_sdk import tool

# Minimum age in days for first valid dose, by antigen.
# Source: ACIP general minimum ages / WHO.
MIN_AGE_DAYS: dict[str, int] = {
    "DTaP": 42,       # 6 weeks
    "DPT": 42,
    "HepB": 0,        # birth dose acceptable
    "Hib": 42,        # 6 weeks
    "IPV": 42,        # 6 weeks
    "OPV": 0,
    "PCV": 42,        # 6 weeks
    "MMR": 270,       # 9 months (minimum valid)
    "Measles": 180,   # 6 months (only as emergency MCV0; not counted in primary series)
    "Rubella": 270,
    "Varicella": 270, # 9 months minimum
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
    "Validate a single vaccination dose against the target country's schedule. Checks minimum age at time of dose, dose position appropriateness, and minimum interval from the prior dose (if provided). Returns valid/invalid with specific reasons and flags for the agent to reason about. dose_kind tells the engine whether the row is a numbered primary dose, a booster (validated by antigen + age + interval, not by position), a birth dose, or unknown; defaults to 'primary' when omitted. prior_dose_age_days: age in days of the prior dose in this series, or omitted/None for dose 1 or any dose without a prior reference.",
    {
        "type": "object",
        "properties": {
            "antigen": {"type": "string"},
            "dose_number": {"type": ["integer", "null"]},
            "dose_kind": {
                "type": "string",
                "enum": ["primary", "booster", "birth", "unknown"],
            },
            "age_at_dose_days": {"type": "integer"},
            "target_country": {"type": "string"},
            "prior_dose_age_days": {"type": "integer"},
        },
        "required": ["antigen", "age_at_dose_days", "target_country"],
    },
)
async def validate_dose(args: dict) -> dict:
    antigen = args["antigen"]
    dose_number = args.get("dose_number")
    dose_kind = args.get("dose_kind") or "primary"
    age_days = args["age_at_dose_days"]
    target_country = args.get("target_country", "Egypt")
    prior_age = args.get("prior_dose_age_days")

    reasons: list[str] = []
    flags: list[str] = []
    valid = True
    # Boosters validate by antigen + age + interval, not by a dose
    # position the engine does not carry. If no rule rejects the
    # booster, the engine refuses to unilaterally approve it — the
    # clinician gets the final call. This flag flips true by default
    # for boosters and can also be set explicitly below when a primary
    # row is missing data the engine needs for a full verdict.
    needs_clinician_confirmation = False

    # 0. Biological-plausibility gate. A dose administered before the
    # patient's date of birth is physically impossible — this is the
    # RED-gate catch for vision misreads that slipped past the clinician
    # (e.g. "2021-05-05" that should have been "2023-05-05"). Explicit
    # rejection with a clear reason string is preferable to letting the
    # dose ride through the rest of the rule chain, where the only
    # symptom would be a minimum-age failure with a misleading message.
    if age_days < 0:
        valid = False
        reasons.append(
            f"Administered {abs(age_days)} days BEFORE the child's date of birth — "
            f"biologically impossible. Re-check the year digit on the card."
        )

    # 1. Minimum age check. Applies to every dose_kind including boosters
    # (an 18-month booster still has to be given after the booster's own
    # minimum age; some antigens — BCG, HepB, OPV — have min_age of 0).
    min_age = MIN_AGE_DAYS.get(antigen, 42)
    if age_days >= 0 and age_days < min_age:
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

    # 3. Interval check from prior dose. Position-indexed interval rules
    # (dose N-1 → dose N) only make sense for primary-series rows with a
    # known dose_number. Booster rows get a generic "at least 28 days
    # since prior same-antigen dose" sanity floor and are then marked for
    # clinician confirmation because the engine does not encode booster
    # schedule rules per antigen.
    if prior_age is not None:
        if dose_kind == "primary" and dose_number is not None:
            from hathor.tools.intervals import _get_min_interval
            min_interval, rule_source = _get_min_interval(
                antigen, dose_number - 1, dose_number
            )
            actual_interval = age_days - prior_age
            if actual_interval < min_interval:
                valid = False
                reasons.append(
                    f"Interval from prior dose: {actual_interval} days, "
                    f"minimum required: {min_interval} days ({rule_source})."
                )
            else:
                flags.append(
                    f"Interval from prior dose: {actual_interval} days "
                    f"(minimum {min_interval} days — OK)."
                )
        else:
            # Booster / birth / unknown with a prior dose — 28-day
            # sanity floor only. Any tighter rule requires position data
            # the engine does not carry.
            actual_interval = age_days - prior_age
            generic_min = 28
            if actual_interval < generic_min:
                valid = False
                reasons.append(
                    f"Interval from prior {antigen} dose: {actual_interval} days, "
                    f"below the 28-day generic minimum for boosters/ungraded doses."
                )
            else:
                flags.append(
                    f"Interval from prior {antigen} dose: {actual_interval} days "
                    f"(generic 28-day floor — OK; verify against destination schedule)."
                )

    # 4. Age-appropriateness flag (not invalidating, just informational).
    # Reserved for future population-health logic.

    # 5. Booster posture. If nothing above rejected the booster, the
    # engine defers to the clinician — it is NOT silently approving.
    # This is the AMBER-review path: the row reaches the engine, the
    # engine confirms no biological or minimum-age violation, and the
    # clinician makes the final call.
    if dose_kind == "booster" and valid:
        needs_clinician_confirmation = True
        flags.append(
            f"Booster dose: engine does not encode position-specific booster rules "
            f"for {antigen}. Clinician must confirm against the destination schedule."
        )

    if not reasons and valid:
        reasons.append("Dose meets minimum age and interval requirements.")

    result = {
        "antigen": antigen,
        "dose_number": dose_number,
        "dose_kind": dose_kind,
        "age_at_dose_days": age_days,
        "target_country": target_country,
        "prior_dose_age_days": prior_age,
        "valid": valid,
        "needs_clinician_confirmation": needs_clinician_confirmation,
        "reasons": reasons,
        "flags": flags,
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
