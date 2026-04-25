"""Parallel specialist sub-agents for Hathor.

Each specialist owns one specific clinical sub-question (per the CLAUDE.md
tool-granularity principle). Specialists are designed to run in parallel
after card extraction — wall-clock latency is the slowest specialist, not
the sum.

Pattern:
- Each specialist exports an ``async def consult(extraction: dict) -> dict``
  function returning a structured ``SpecialistVerdict`` dict.
- Specialists are stateless, self-contained, and use Sonnet 4.6 by default
  (env-overridable per specialist).
- The orchestrator at ``hathor.tools.consult_specialists`` calls all
  registered specialists via ``asyncio.gather(return_exceptions=True)`` so
  one specialist failing doesn't kill the others.

See ``_base.py`` for the shared verdict shape and helpers.
"""

from hathor.specialists._base import SpecialistVerdict, run_structured_call
from hathor.specialists.attending_physician import (
    consult as attending_physician_consult,
)
from hathor.specialists.source_country import consult as source_country_consult
from hathor.specialists.who_baseline import consult as who_baseline_consult
from hathor.specialists.translator import consult as translator_consult
from hathor.specialists.catch_up_planner import consult as catch_up_planner_consult

# Registry of (name, consult_fn, needs_planning_context) tuples. The
# orchestrator iterates this list and runs every entry in parallel.
#
# needs_planning_context = True means the consult function takes the
# extra ``target_country`` and ``child_dob`` keyword arguments alongside
# the extraction. The orchestrator dispatches accordingly.
SPECIALISTS: list[tuple[str, object, bool]] = [
    ("source_country", source_country_consult, False),
    ("attending_physician", attending_physician_consult, False),
    ("who_baseline", who_baseline_consult, False),
    ("translator", translator_consult, False),
    ("catch_up_planner", catch_up_planner_consult, True),
]

__all__ = [
    "SPECIALISTS",
    "SpecialistVerdict",
    "run_structured_call",
    "attending_physician_consult",
    "source_country_consult",
    "who_baseline_consult",
    "translator_consult",
    "catch_up_planner_consult",
]
