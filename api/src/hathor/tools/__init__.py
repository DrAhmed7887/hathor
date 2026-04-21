from hathor.tools.card_extraction import extract_vaccinations_from_card
from hathor.tools.age_math import compute_age_at_dose
from hathor.tools.vaccine_lookup import lookup_vaccine_equivalence
from hathor.tools.intervals import check_interval_rule
from hathor.tools.dose_validation import validate_dose
from hathor.tools.schedule import get_schedule
from hathor.tools.coverage import compute_missing_doses
from hathor.tools.catchup import build_catchup_schedule

HATHOR_TOOLS = [
    extract_vaccinations_from_card,
    compute_age_at_dose,
    lookup_vaccine_equivalence,
    check_interval_rule,
    validate_dose,
    get_schedule,
    compute_missing_doses,
    build_catchup_schedule,
]
