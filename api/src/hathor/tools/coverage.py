"""Tool: compute_missing_doses — diff validated history against target schedule.

Coverage is evaluated at the **component level**, not the antigen-product level.

A Nigerian Pentavalent dose covers DPT + HepB + Hib but NOT IPV; an Egyptian
Hexavalent slot at the same dose position needs all four. The tool credits
Penta for the three components it supplies and reports the position as
*partial coverage* with an explicit IPV gap, instead of naively flagging the
entire Hexavalent dose as missing. The same pattern handles
Measles-monovalent → MMR (covers Measles only, leaves Mumps + Rubella as
gaps), MR → MMR, DT → DTaP-position, etc.

Single-component antigens (BCG, OPV, Rotavirus, etc.) are self-equivalent in
the components map, so behaviour reduces to a direct match for those rows.
"""

import json
from claude_agent_sdk import tool


# Combination vaccines → component antigens covered by one dose at a given position.
# A dose of `antigen` at dose_number N is treated as one dose of each component at
# the same position N. Antigens not in this map are self-equivalent (single
# component) and matched directly. Keys are the antigen labels Hathor uses in
# schedule files and history records; aliases route to the same component list.
_COMBINATION_COMPONENTS: dict[str, list[str]] = {
    # Sub-Saharan African pentavalent (no IPV) — Nigeria, Ethiopia, Sudan,
    # South Sudan, Eritrea, Syria.
    "Penta": ["DPT", "HepB", "Hib"],
    "Pentavalent": ["DPT", "HepB", "Hib"],
    "DTP-HepB-Hib": ["DPT", "HepB", "Hib"],
    # Egyptian / EU-private hexavalent (with IPV).
    "Hexavalent": ["DPT", "HepB", "Hib", "IPV"],
    "DTP-HepB-Hib-IPV": ["DPT", "HepB", "Hib", "IPV"],
    # Pentaxim (private-market, no HepB).
    "Pentaxim": ["DPT", "Hib", "IPV"],
    # Measles-containing combinations.
    "MMR": ["Measles", "Mumps", "Rubella"],
    "MR": ["Measles", "Rubella"],
    "MMRV": ["Measles", "Mumps", "Rubella", "Varicella"],
    # DPT family — DTaP/DTPw/DPT/Tdap all cover the same DPT antigen triple.
    "DTaP": ["DPT"],
    "DTPw": ["DPT"],
    "DPT": ["DPT"],
    "Tdap": ["DPT"],
    # School-entry boosters — diphtheria + tetanus only, no pertussis.
    "DT": ["Diphtheria", "Tetanus"],
    "Td": ["Diphtheria", "Tetanus"],
}


def _components_for(antigen: str) -> list[str]:
    return _COMBINATION_COMPONENTS.get(antigen, [antigen])


def cumulative_component_tally(antigens: list[str]) -> dict[str, int]:
    """Cumulative count of doses per component antigen.

    Each input antigen is expanded via :data:`_COMBINATION_COMPONENTS` so that
    a Pentavalent dose contributes 1×DPT + 1×HepB + 1×Hib, a Hexavalent dose
    adds 1×IPV, an MMR dose contributes 1×Measles + 1×Mumps + 1×Rubella, etc.
    Single-component antigens count as themselves.

    The result is a flat dict ``{component: count}`` representing how many
    doses of each component the child has received in total — independent of
    dose-number alignment or destination-country slot positions. Useful for
    WHO-IVB primary-series adequacy checks (≥3 DPT, ≥3 polio, ≥3 HepB,
    ≥1 measles), which are cumulative claims rather than slot-level claims.

    Callers control filtering (e.g. drop invalid doses) by what they pass in.
    The function does no validity reasoning — it just counts.
    """
    counts: dict[str, int] = {}
    for antigen in antigens:
        for comp in _components_for(antigen):
            counts[comp] = counts.get(comp, 0) + 1
    return counts


@tool(
    "compute_missing_doses",
    "Compare a child's validated vaccination history against the target country's schedule to identify gaps. Coverage is evaluated at the component level: a Pentavalent dose credits DPT+HepB+Hib (but not IPV) at its dose-number position, so a Nigerian-origin child reaching the Egyptian Hexavalent slot is reported as partial_coverage with the IPV gap, instead of fully missing. A Measles-monovalent dose credits Measles only, leaving Mumps+Rubella as the gap against an MMR slot. Input: validated_history (list of dicts with antigen, dose_number, age_days, valid) and target_schedule (list of dose dicts from get_schedule). Returns six buckets: completed, partial_coverage, overdue, due_now, upcoming, invalid_doses. Each schedule row carries required_components, covered_components, missing_components, and covered_via (which source antigens contributed).",
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

    # Component-level coverage map: (component_antigen, dose_number) → list of
    # source antigen labels that contributed to that component's coverage.
    # A Penta dose 1 in the history populates ("DPT", 1), ("HepB", 1), ("Hib", 1).
    component_coverage: dict[tuple[str, int], list[str]] = {}
    invalid_doses: list[dict] = []
    for entry in history:
        antigen = entry.get("antigen")
        dose_num = entry.get("dose_number")
        if antigen is None or dose_num is None:
            continue
        if not entry.get("valid", False):
            invalid_doses.append(entry)
            continue
        for comp in _components_for(antigen):
            component_coverage.setdefault((comp, dose_num), []).append(antigen)

    completed: list[dict] = []
    overdue: list[dict] = []
    due_now: list[dict] = []
    upcoming: list[dict] = []
    partial: list[dict] = []

    DUE_NOW_WINDOW = 2  # months — schedule slots within this band are "due now"

    for dose in schedule:
        antigen = dose.get("antigen")
        dose_num = dose.get("dose_number")
        rec_age_months = dose.get("recommended_age_months")
        min_age_months = dose.get("minimum_age_months", rec_age_months)
        category = dose.get("category", "compulsory")

        if antigen is None or dose_num is None:
            continue

        required = _components_for(antigen)
        covered_components = [c for c in required if (c, dose_num) in component_coverage]
        missing_components = [c for c in required if (c, dose_num) not in component_coverage]

        # Audit: which source antigens contributed coverage (e.g. "Penta" credited
        # against an Egyptian Hexavalent slot). Excludes the slot's own antigen
        # name because that's the trivial self-match.
        covered_via = sorted({
            src
            for c in covered_components
            for src in component_coverage.get((c, dose_num), [])
            if src != antigen
        })

        dose_summary = {
            "antigen": antigen,
            "dose_number": dose_num,
            "recommended_age_months": rec_age_months,
            "minimum_age_months": min_age_months,
            "category": category,
            "required_components": required,
            "covered_components": covered_components,
            "missing_components": missing_components,
            "covered_via": covered_via,
            "notes": dose.get("notes", ""),
        }

        if not missing_components:
            completed.append({**dose_summary, "status": "completed"})
            continue

        if covered_components:
            # Some components present, others absent. The dose still needs to
            # happen for the missing components, but the agent should not
            # treat it as a wholesale gap.
            partial.append({**dose_summary, "status": "partial_coverage"})
            continue

        # No component covered at this position — bucket by timing.
        if rec_age_months is not None and rec_age_months < current_age_months - DUE_NOW_WINDOW:
            overdue.append({
                **dose_summary,
                "status": "overdue",
                "months_overdue": round(current_age_months - rec_age_months, 1),
            })
        elif rec_age_months is not None and rec_age_months <= current_age_months + DUE_NOW_WINDOW:
            due_now.append({**dose_summary, "status": "due_now"})
        else:
            upcoming.append({**dose_summary, "status": "upcoming"})

    result = {
        "target_country": target_country,
        "current_age_days": current_age_days,
        "current_age_months_approx": round(current_age_months, 1),
        "summary": {
            "completed": len(completed),
            "partial_coverage": len(partial),
            "overdue": len(overdue),
            "due_now": len(due_now),
            "upcoming": len(upcoming),
            "invalid_doses_in_history": len(invalid_doses),
        },
        "completed": completed,
        "partial_coverage": partial,
        "overdue": overdue,
        "due_now": due_now,
        "upcoming": upcoming,
        "invalid_doses": invalid_doses,
    }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
