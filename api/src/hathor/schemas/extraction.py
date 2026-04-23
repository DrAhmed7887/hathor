"""Card-extraction tool output — per-field confidence schema.

Each field carries its own confidence, review flag, and ambiguity reason.
This is the input to Phase D (vision safety loop). Per-field, not per-row.

See docs/schema-proposal.md §1.
"""

from pydantic import BaseModel, Field


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


class CardMetadata(BaseModel):
    detected_language: FieldExtraction | None = None
    overall_legibility: FieldExtraction | None = None
    patient_dob: FieldExtraction | None = None


class CardExtractionOutput(BaseModel):
    card_metadata: CardMetadata
    extracted_doses: list[ExtractedDose]
    extraction_method: str
