"""Flagship demonstration scenario for Hathor.

Nigerian infant relocating to Egypt — the canonical demo case.
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
        {"trade_name": "BCG", "date_given": "2024-06-16"},
        {"trade_name": "HepB birth dose", "date_given": "2024-06-16"},
        {"trade_name": "OPV0", "date_given": "2024-06-16"},
        {"trade_name": "Pentavalent (DPT-HepB-Hib)", "date_given": "2024-07-27"},
        {"trade_name": "OPV1", "date_given": "2024-07-27"},
        {"trade_name": "PCV13", "date_given": "2024-07-27"},
        {"trade_name": "Rotavirus", "date_given": "2024-07-27"},
        {"trade_name": "Pentavalent (DPT-HepB-Hib)", "date_given": "2024-08-24"},
        {"trade_name": "OPV2", "date_given": "2024-08-24"},
        {"trade_name": "PCV13", "date_given": "2024-08-24"},
        {"trade_name": "Rotavirus", "date_given": "2024-08-24"},
        {"trade_name": "Pentavalent (DPT-HepB-Hib)", "date_given": "2024-09-21"},
        {"trade_name": "OPV3", "date_given": "2024-09-21"},
        {"trade_name": "PCV13", "date_given": "2024-09-21"},
        {"trade_name": "IPV", "date_given": "2024-09-21"},
        {"trade_name": "Measles", "date_given": "2025-03-15"},
        {"trade_name": "Yellow Fever", "date_given": "2025-03-15"},
    ],
    source_country="Nigeria",
    target_country="Egypt",
    scenario_title="Lagos → Cairo: a Nigerian infant's vaccination card, reconciled against Egyptian EPI.",
    scenario_description=(
        "A common case for families relocating within Africa. The child was fully immunised "
        "on Nigeria's NPI schedule (6/10/14-week primary series, Measles + Yellow Fever at 9 "
        "months) and is now 22 months old, moving to Cairo. The family plans to enrol the "
        "child in an Egyptian nursery. Which Nigerian doses count under Egyptian EPI? What "
        "is missing? What about the Yellow Fever dose — is it still relevant in Egypt? And "
        "what about MMR, which Nigeria does not use routinely (Measles monovalent only)?"
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
        f"Source country      : {scenario.source_country}\n"
        f"Target country      : {scenario.target_country}\n"
        f"Today's date        : {today}\n\n"
        f"The family plans to enrol the child in an Egyptian nursery within the next 4 weeks.\n\n"
        f"Please reconcile this child's vaccination history against the Egyptian EPI schedule "
        f"and provide a complete catch-up plan. Flag any doses present on the Nigerian record "
        f"that are not part of Egyptian EPI (preserve them but do not count them as Egyptian EPI) "
        f"and any Egyptian EPI antigens that are missing from the Nigerian record."
    )
