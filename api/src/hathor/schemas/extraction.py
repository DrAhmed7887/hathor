"""Card-extraction tool output — per-field confidence schema.

Each field carries its own confidence, review flag, and ambiguity reason.
This is the input to Phase D (vision safety loop). Per-field, not per-row.

See docs/schema-proposal.md §1 and docs/hitl-ui-design.md §6 for the PR 2
clinician-action additions.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


ClinicianAction = Literal["none", "confirmed", "edited", "skipped", "rejected"]
"""Clinician decision recorded against an extracted dose. Mirrors the TS
``ParsedCardRow.clinician_action`` field. ``rejected`` is the only action
that requires a non-empty ``clinician_reason`` (schema-enforced below)."""


class FieldExtraction(BaseModel):
    value: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    needs_review: bool = False
    ambiguity_reason: str | None = None


class ExtractedDose(BaseModel):
    transcribed_antigen: FieldExtraction | None = None
    date_administered: FieldExtraction | None = None
    lot_number: FieldExtraction | None = None
    provider_signature: FieldExtraction | None = None
    dose_number_on_card: FieldExtraction | None = None

    # PR 2 schema additions (design note §6.1, §6.5).
    clinician_action: ClinicianAction = "none"
    """Clinician decision against this dose. Defaults to "none" until
    the clinician acts. Routes:
      - "confirmed"/"edited" → admitted by filter_confirmed_doses
      - "skipped"           → dropped (visit treated as unreviewed)
      - "rejected"          → routed to definitively_absent channel
    """
    clinician_reason: str | None = None
    """Free-text clinician note. Required (non-empty) when
    ``clinician_action == "rejected"``; optional otherwise."""

    @model_validator(mode="after")
    def _reject_requires_reason(self) -> "ExtractedDose":
        """Schema-enforced: a reason-less reject is impossible from any
        client (CLI export, API consumer, future automation), not only
        blocked by the UI. Mirrors ``assertClinicianAction`` on the TS
        side.
        """
        if self.clinician_action == "rejected":
            reason = (self.clinician_reason or "").strip()
            if not reason:
                raise ValueError(
                    "clinician_action='rejected' requires a non-empty "
                    "clinician_reason"
                )
        return self


class CardMetadata(BaseModel):
    detected_language: FieldExtraction | None = None
    overall_legibility: FieldExtraction | None = None
    patient_dob: FieldExtraction | None = None


class CardExtractionOutput(BaseModel):
    card_metadata: CardMetadata
    extracted_doses: list[ExtractedDose]
    extraction_method: str
    orientation_acknowledged: bool = True
    """Card-level orientation gate (design note §7). When the layout
    pipeline detects a rotated/tilted card, this defaults to False and
    the trust gate refuses to admit any dose until the clinician
    acknowledges via the UI. Defaults to True for backward compat with
    existing fixtures and call sites that have no orientation context."""
