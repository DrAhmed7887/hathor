"""Flagship demonstration scenarios for Hathor.

Two scenario shapes:

- :class:`FlagshipScenario` — typed dose list. The agent receives the doses
  directly in the prompt and never calls the extraction tool. Used to
  isolate clinical-reasoning quality from vision quality.

- :class:`CardScenario` — image-path scenario. The agent receives only the
  card path + DOB + target country and must call the extraction tool itself.
  Used for end-to-end measurements that include vision + (optional)
  enrichment + reasoning.

Imported by run_agent.py (--flagship / --arabic flags) and usable from any
evaluation harness.
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


@dataclass(frozen=True)
class CardScenario:
    image_path: str
    child_dob: str | None
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


ARABIC_EGYPT_CARD = CardScenario(
    image_path="cards/Arabic vaccination.jpg",
    child_dob=None,  # DOB not explicitly labelled on the card (Phase D will flag)
    target_country="Egypt",
    scenario_title="Egyptian Arabic vaccination card — staying in Egypt.",
    scenario_description=(
        "An Arabic-only Egyptian EPI card. Tests the end-to-end path on a "
        "non-English source: vision OCR must read Arabic, the agent must "
        "infer source country, normalise antigens (الثلاثى البكتيرى → DTP, "
        "الثلاثى الفيروسى → MMR, الدرن → BCG, شلل أطفال فموى → OPV, "
        "الالتهاب الكبدى → HepB), and reconcile against the Egyptian schedule. "
        "DOB is not explicitly labelled — Phase D should route it to HITL."
    ),
)


def build_card_agent_prompt(scenario: CardScenario) -> str:
    today = datetime.date.today().isoformat()
    dob_line = (
        f"Child date of birth : {scenario.child_dob}\n"
        if scenario.child_dob
        else "Child date of birth : NOT PROVIDED — extract from card if visible, else flag for clinician.\n"
    )
    return (
        f"A child's vaccination card is available at the following path:\n\n"
        f"  Image path : {scenario.image_path}\n\n"
        f"{dob_line}"
        f"Target country      : {scenario.target_country}\n"
        f"Today's date        : {today}\n\n"
        f"Please extract the vaccinations from this card image, then reconcile "
        f"the child's history against the {scenario.target_country} EPI schedule "
        f"and provide a complete catch-up plan. Use the extraction tool first, "
        f"then proceed through your normal reasoning."
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
