"""Tool: check_interval_rule — minimum interval validation between doses."""

import json
from claude_agent_sdk import tool

# Minimum interval in days between consecutive doses, by antigen.
# source: ACIP general rules + STIKO footnotes where stricter.
INTERVAL_RULES: dict[str, dict] = {
    "DTaP": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "STIKO requires minimum 6 months between G2 and G3 (doses 2→3). Standard ACIP minimum 28 days applies between doses 1→2.",
        "source": "ACIP / STIKO Impfkalender 2026 footnote d",
    },
    "DPT": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "Same rules as DTaP — whole-cell and acellular pertussis share interval requirements.",
        "source": "ACIP / STIKO",
    },
    "HepB": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "STIKO: doses 2→3 minimum 6 months (delivered in hexavalent combination with DTaP).",
        "source": "ACIP / STIKO",
    },
    "Hib": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "Same hexavalent constraint — 6 months minimum between G2 and G3.",
        "source": "ACIP / STIKO",
    },
    "IPV": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "Same hexavalent constraint.",
        "source": "ACIP / STIKO",
    },
    "PCV": {
        "standard_min_days": 28,
        "stiko_g2_to_g3_min_days": 180,
        "note": "STIKO co-schedules PCV with hexavalent; 6-month minimum before G3/booster in the 2+1 or 3p schedule.",
        "source": "ACIP / STIKO",
    },
    "MenB": {
        "standard_min_days": 56,
        "note": "Minimum 8 weeks between all MenB doses in the 3-dose infant series.",
        "source": "STIKO",
    },
    "MMR": {
        "standard_min_days": 28,
        "note": "Minimum 4 weeks between MMR doses 1 and 2.",
        "source": "ACIP / STIKO",
    },
    "Measles": {
        "standard_min_days": 28,
        "note": "Measles-containing vaccines: minimum 28 days between doses.",
        "source": "ACIP / WHO",
    },
    "Varicella": {
        "standard_min_days": 28,
        "note": "Minimum 4 weeks between Varicella doses 1 and 2.",
        "source": "ACIP / STIKO",
    },
    "Rotavirus": {
        "standard_min_days": 28,
        "note": "Minimum 4 weeks between doses. Series must be completed before 24 months of age.",
        "source": "ACIP / STIKO",
    },
    "OPV": {
        "standard_min_days": 28,
        "note": "Minimum 4 weeks between OPV doses.",
        "source": "WHO / ACIP",
    },
}


def _get_min_interval(antigen: str, from_dose: int, to_dose: int) -> tuple[int, str]:
    rule = INTERVAL_RULES.get(antigen)
    if rule is None:
        return 28, "default ACIP minimum (antigen not in rule table)"

    # STIKO special case: stricter minimum for the last primary-to-booster transition
    if from_dose == 2 and to_dose == 3 and "stiko_g2_to_g3_min_days" in rule:
        return rule["stiko_g2_to_g3_min_days"], rule.get("source", "STIKO")

    return rule["standard_min_days"], rule.get("source", "ACIP")


@tool(
    "check_interval_rule",
    "Check whether the interval between two consecutive doses of the same antigen meets the minimum required interval. Provide the antigen name, the child's age in days at the prior dose, and age in days at the current dose. Returns whether the interval is valid, the minimum required, and the actual interval.",
    {
        "antigen": str,
        "prior_dose_age_days": int,
        "current_dose_age_days": int,
        "from_dose_number": int,
        "to_dose_number": int,
    },
)
async def check_interval_rule(args: dict) -> dict:
    antigen = args["antigen"]
    prior_age = args["prior_dose_age_days"]
    current_age = args["current_dose_age_days"]
    from_dose = args.get("from_dose_number", 1)
    to_dose = args.get("to_dose_number", 2)

    actual_interval = current_age - prior_age
    min_interval, rule_source = _get_min_interval(antigen, from_dose, to_dose)

    rule_entry = INTERVAL_RULES.get(antigen, {})

    result = {
        "antigen": antigen,
        "from_dose_number": from_dose,
        "to_dose_number": to_dose,
        "prior_dose_age_days": prior_age,
        "current_dose_age_days": current_age,
        "actual_interval_days": actual_interval,
        "minimum_interval_days": min_interval,
        "valid": actual_interval >= min_interval,
        "margin_days": actual_interval - min_interval,
        "rule_source": rule_source,
        "rule_note": rule_entry.get("note", ""),
    }

    if actual_interval < min_interval:
        result["flag"] = f"INTERVAL TOO SHORT: {actual_interval} days given, minimum {min_interval} days required."

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
