"""Flagship demonstration scenario for Hathor.

Egyptian infant relocating to Germany — the canonical demo case.
Imported by run_agent.py (--flagship flag) and usable from any evaluation harness.
"""

import datetime
from dataclasses import dataclass


@dataclass(frozen=True)
class FlagshipScenario:
    child_dob: str
    doses: list[dict]
    source_country: str
    target_country: str
    scenario_title: str
    scenario_description: str


FLAGSHIP = FlagshipScenario(
    child_dob="2024-06-15",
    doses=[
        {"trade_name": "Hexyon", "date_given": "2024-08-15"},
        {"trade_name": "Hexyon", "date_given": "2024-10-15"},
        {"trade_name": "Hexyon", "date_given": "2024-12-15"},
        {"trade_name": "MMR", "date_given": "2025-06-15"},
    ],
    source_country="Egypt",
    target_country="Germany",
    scenario_title="Cairo → Aachen: an Egyptian infant's vaccination card, reconciled against STIKO.",
    scenario_description=(
        "A common case for migrant families. Egyptian EPI schedule (BCG at birth, "
        "Hexyon at 2-4-6 months, MMR at 12 months). Moving to Germany for graduate study. "
        "Child now 22 months. What doses count? What's overdue? What's legally required "
        "before Kita enrolment? The family plans to enrol the child in Kita within the next 4 weeks."
    ),
)


def build_agent_prompt(scenario: FlagshipScenario) -> str:
    today = datetime.date.today().isoformat()
    doses_text = "\n".join(
        f"  - {d['trade_name']} — date given: {d['date_given']}"
        for d in scenario.doses
    )
    return (
        f"A family is relocating from {scenario.source_country} to {scenario.target_country}. "
        f"Their child has the following entries on a vaccination card:\n\n"
        f"{doses_text}\n\n"
        f"Child date of birth : {scenario.child_dob}\n"
        f"Target country      : {scenario.target_country}\n"
        f"Today's date        : {today}\n\n"
        f"The family plans to enrol the child in Kita (daycare) within the next 4 weeks.\n\n"
        f"Please reconcile this child's vaccination history against the German STIKO schedule "
        f"and provide a complete catch-up plan."
    )
