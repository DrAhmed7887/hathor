"""Phase D — Vision Safety Loop (per-field).

Partitions extracted card fields into auto-committed vs HITL-review. Any field
with confidence below the threshold, or flagged with needs_review=True, must
not reach the agent without clinician confirmation.

Per-field gating, not per-row: a smudged date on an otherwise legible row
blocks only that date, not the row.
"""

from dataclasses import dataclass

from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)

CONFIDENCE_THRESHOLD: float = 0.85


@dataclass
class HITLField:
    dose_index: int | None
    field_path: str
    extracted: FieldExtraction
    reason: str


@dataclass
class PhaseDResult:
    auto_committed: CardExtractionOutput
    hitl_queue: list[HITLField]

    @property
    def requires_review(self) -> bool:
        return bool(self.hitl_queue)


def _needs_review(f: FieldExtraction) -> bool:
    return f.needs_review or f.confidence < CONFIDENCE_THRESHOLD


def _partition(
    field: FieldExtraction | None,
    dose_index: int | None,
    field_path: str,
    queue: list[HITLField],
) -> FieldExtraction | None:
    if field is None:
        return None
    if _needs_review(field):
        queue.append(
            HITLField(
                dose_index=dose_index,
                field_path=field_path,
                extracted=field,
                reason=field.ambiguity_reason or "confidence below threshold",
            )
        )
        return None
    return field


def gate(extraction: CardExtractionOutput) -> PhaseDResult:
    """Partition every field into auto-commit vs HITL review.

    Fields that pass (confidence >= threshold AND not flagged) are kept in the
    auto_committed output. Fields that fail are nulled in auto_committed and
    appended to hitl_queue with a JSON-path for the UI to locate them.
    """
    hitl: list[HITLField] = []

    committed_metadata = CardMetadata(
        detected_language=_partition(
            extraction.card_metadata.detected_language,
            None,
            "card_metadata.detected_language",
            hitl,
        ),
        overall_legibility=_partition(
            extraction.card_metadata.overall_legibility,
            None,
            "card_metadata.overall_legibility",
            hitl,
        ),
        patient_dob=_partition(
            extraction.card_metadata.patient_dob,
            None,
            "card_metadata.patient_dob",
            hitl,
        ),
    )

    committed_doses: list[ExtractedDose] = []
    for i, dose in enumerate(extraction.extracted_doses):
        committed_doses.append(
            ExtractedDose(
                transcribed_antigen=_partition(
                    dose.transcribed_antigen, i,
                    f"extracted_doses[{i}].transcribed_antigen", hitl,
                ),
                date_administered=_partition(
                    dose.date_administered, i,
                    f"extracted_doses[{i}].date_administered", hitl,
                ),
                lot_number=_partition(
                    dose.lot_number, i,
                    f"extracted_doses[{i}].lot_number", hitl,
                ),
                provider_signature=_partition(
                    dose.provider_signature, i,
                    f"extracted_doses[{i}].provider_signature", hitl,
                ),
                dose_number_on_card=_partition(
                    dose.dose_number_on_card, i,
                    f"extracted_doses[{i}].dose_number_on_card", hitl,
                ),
            )
        )

    return PhaseDResult(
        auto_committed=CardExtractionOutput(
            card_metadata=committed_metadata,
            extracted_doses=committed_doses,
            extraction_method=extraction.extraction_method,
        ),
        hitl_queue=hitl,
    )
