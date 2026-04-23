"""Phase E output schemas — Recommendation, ValidationResult, HITLCorrectionRecord.

Rule ID naming convention (locked):

    {SOURCE}-{CATEGORY}-{NUMBER}

    SOURCE   ∈ {WHO-DAK, EG, HATHOR}
      WHO-DAK   rule originates directly from WHO SMART Guidelines / DAK PlanDefinition
      EG        rule is Egypt-MoH-sovereign (Egypt regulatory authority, not Hathor-authored)
      HATHOR    rule is project-authored (Hathor precedence / architectural decision)

    CATEGORY ∈ {EPI, CONTRA, SCHED, AGE, DOSE, …}
    NUMBER   = zero-padded integer (e.g. 001, 002, …)

    Examples:
      HATHOR-AGE-001    min_age_valid               (project rule, age domain)
      HATHOR-DOSE-002   min_interval_met            (project rule, dose-interval domain)
      EG-CONTRA-001     contraindication_source_conflict  (Egypt-MoH-sovereign precedence rule)

See docs/SAFETY_LOOPS.md — Phase E → Rules engine interface for the full registry.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

RecommendationKind = Literal[
    "due",            # child is due for antigen X
    "overdue",        # child is overdue for antigen Y
    "catchup_visit",  # visit plan entry (a single clinic appointment)
    "dose_verdict",   # a given dose is valid / invalid / marginal
    "contra",         # contraindication flag
]


class HITLCorrectionRecord(BaseModel):
    """One clinician correction that affected a source dose for a recommendation.

    Captured for FHIR Provenance audit. The ``pre_hitl_snapshot`` on a
    Recommendation contains one of these for every corrected field across all
    source doses. Empty list when no HITL corrections fired for those doses.

    Round-trip into FHIR Provenance:
      - ``field_path`` + ``pre_hitl_value``    → Provenance.entity  (what the extractor saw)
      - ``post_hitl_value`` + ``clinician_action`` → Provenance.activity (what the clinician decided)
      - ``pre_hitl_confidence`` + ``ambiguity_reason`` → Provenance.entity.detail
    """

    field_path: str                               # e.g. "extracted_doses[2].date_administered"
    pre_hitl_value: str | None                    # raw extracted value before correction
    pre_hitl_confidence: float                    # extractor confidence at time of extraction
    ambiguity_reason: str | None                  # extractor's reason for low confidence
    post_hitl_value: str | None                   # clinician-supplied value (None when skipped)
    clinician_action: Literal["edit", "keep", "skip"]


class Recommendation(BaseModel):
    """A structured clinical recommendation emitted by the agent via emit_recommendations.

    The agent calls emit_recommendations EXACTLY ONCE at the end of reasoning.
    Every actionable clinical claim (due, overdue, catchup_visit, dose_verdict, contra)
    must appear here. Narrative text (card summary, educational notes) goes in the
    agent's text response, not here.

    ``source_dose_indices`` points into the post-HITL confirmed dose list — the
    clinician-verified records the agent reasoned from.

    ``pre_hitl_snapshot`` preserves the correction delta for each source dose so the
    FHIR Provenance resource can reconstruct what the extractor saw, what the clinician
    changed, and why. Empty when no HITL corrections fired for those doses.
    """

    recommendation_id: str                        # unique within this emit call; agent-assigned
    kind: RecommendationKind
    antigen: str                                  # canonical Hathor antigen name
    dose_number: int | None = None                # 1-indexed; None for catchup_visit / contra
    target_date: date | None = None               # ISO date for due / overdue / catchup_visit
    agent_rationale: str                          # one-line summary shown to clinician
    reasoning: str                                # fuller agent reasoning (shown in HITL UI alongside Phase E verdict)
    agent_confidence: float = Field(ge=0.0, le=1.0)
    source_dose_indices: list[int] = []           # indices into post-HITL confirmed dose list
    pre_hitl_snapshot: list[HITLCorrectionRecord] = []  # HITL audit trail; empty when no corrections fired
    source_verdicts: list[dict] = []              # for EG-CONTRA-001: [{"source": str, "verdict": bool, "reason": str}]
                                                  # "source" ∈ {"EgyptMoH", "ManufacturerLabel", "WHO-DAK"}


class ValidationResult(BaseModel):
    """Per-recommendation output of Phase E (phase_e.validate()).

    severity:
      pass  → recommendation reaches clinician, annotated with rule_id
      warn  → recommendation reaches clinician with yellow badge + rule_rationale
      fail  → recommendation blocked; replaced with "requires physician review" entry
              carrying the DAK rule, agent's original proposal, and override affordance

    ``override_allowed`` is typed ``Literal[True]`` — Pydantic forbids ``False`` at
    the type level. Clinician final authority is a hard rule (CLAUDE.md). Changing
    this requires a schema change, not a field assignment.

    ``supersedes``: if set, this result supersedes an earlier result for the same
    recommendation whose ``rule_id`` equals this value. The engine drops the
    superseded result from the active set but preserves both in the Provenance audit
    log. Defined here so future rule bodies (e.g. HATHOR-DOSE-003 acip_grace_period
    superseding HATHOR-DOSE-002 min_interval_met) can declare composition without a
    schema change.
    """

    recommendation_id: str
    severity: Literal["pass", "warn", "fail"]
    rule_id: str | None = None                    # e.g. "HATHOR-AGE-001"
    rule_slug: str | None = None                  # e.g. "min_age_valid"
    rule_rationale: str | None = None             # 1-2 sentences from rule definition
    override_allowed: Literal[True] = True        # HARD RULE — never False
    override_logged_as: str = "AuditEvent"        # FHIR Provenance event type
    supersedes: str | None = None                 # rule_id of an earlier result this supersedes
