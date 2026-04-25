import os

from hathor.tools.card_extraction import extract_vaccinations_from_card
from hathor.tools.card_extraction_subagent import extract_and_enrich_card
from hathor.tools.consult_specialists import consult_specialists
from hathor.tools.age_math import compute_age_at_dose
from hathor.tools.vaccine_lookup import lookup_vaccine_equivalence
from hathor.tools.intervals import check_interval_rule
from hathor.tools.dose_validation import validate_dose
from hathor.tools.schedule import get_schedule
from hathor.tools.coverage import compute_missing_doses
from hathor.tools.catchup import build_catchup_schedule
from hathor.tools.emit_recommendations import emit_recommendations


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


# Three mutually-exclusive extraction-tool modes (priority: specialists >
# enriched > bare). The agent only ever sees ONE extraction tool to keep
# its decision space simple.
#
#   HATHOR_USE_SPECIALISTS=1     consult_specialists (parallel sub-agents)
#   HATHOR_USE_ENRICHED_EXTRACT=1 extract_and_enrich_card (single sub-agent)
#   (default)                    extract_vaccinations_from_card (bare OCR)
#
# Used by the sub-agent A/B in evaluation/.
if _flag("HATHOR_USE_SPECIALISTS"):
    _extract_tool = consult_specialists
elif _flag("HATHOR_USE_ENRICHED_EXTRACT"):
    _extract_tool = extract_and_enrich_card
else:
    _extract_tool = extract_vaccinations_from_card

HATHOR_TOOLS = [
    _extract_tool,
    compute_age_at_dose,
    lookup_vaccine_equivalence,
    check_interval_rule,
    validate_dose,
    get_schedule,
    compute_missing_doses,
    build_catchup_schedule,
    emit_recommendations,
]
