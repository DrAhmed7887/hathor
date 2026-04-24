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


@dataclass
class DroppedDose:
    """Record of a dose the trust gate refused to forward to the agent.

    Carries a short, human-readable reason so the UI and logs can
    surface WHY a row was withheld. Dropped doses still surface in
    the clinician review; they just do not reach the reasoning loop
    without an explicit confirmation.
    """

    dose_index: int
    reason: str


@dataclass
class ConfirmedDoseFilterResult:
    """Output of :func:`filter_confirmed_doses` — the trust gate."""

    confirmed: list[ExtractedDose]
    dropped: list[DroppedDose]


def _field_is_confirmed(f: FieldExtraction | None) -> bool:
    """A field is 'confirmed' when present, confident, and not flagged.

    The HITL merge rewrites clinician-edited and clinician-kept fields
    with ``confidence=1.0`` and ``needs_review=False`` (see
    ``_apply_corrections`` in ``hathor.server``), so this predicate
    uniformly accepts both auto-committed high-confidence fields and
    clinician-confirmed fields without needing a separate
    ``clinician_confirmed`` flag on the schema.
    """
    if f is None:
        return False
    if f.value is None:
        return False
    if f.needs_review:
        return False
    return f.confidence >= CONFIDENCE_THRESHOLD


def filter_confirmed_doses(
    extraction: CardExtractionOutput,
) -> ConfirmedDoseFilterResult:
    """Trust gate before reconciliation.

    Post-Phase-D, post-HITL-merge, each :class:`ExtractedDose` reaching
    the agent must satisfy the invariant:

        (source = vision AND confidence >= CONFIDENCE_THRESHOLD)
        OR (clinician_confirmed = True)

    In the Python schema that maps to: ``transcribed_antigen`` and
    ``date_administered`` are both present, non-flagged, and carry
    confidence >= :data:`CONFIDENCE_THRESHOLD`. Clinician-confirmed
    fields meet this automatically because the HITL merge rewrites
    their confidence to ``1.0``.

    Doses that fail the check are accumulated into ``dropped`` with a
    reason string. They are never silently forwarded. The caller can
    surface them for explicit clinician review, but they do NOT drive
    reconciliation.

    This function is pure and idempotent. It does not mutate the
    input. Template-inferred rows (a TypeScript-side concept with no
    Python equivalent in the current schema) never appear here
    because the Python pipeline only ever sees vision-origin doses.
    """
    confirmed: list[ExtractedDose] = []
    dropped: list[DroppedDose] = []
    for i, dose in enumerate(extraction.extracted_doses):
        if not _field_is_confirmed(dose.transcribed_antigen):
            dropped.append(
                DroppedDose(
                    dose_index=i,
                    reason="antigen field missing or below confidence threshold",
                )
            )
            continue
        if not _field_is_confirmed(dose.date_administered):
            dropped.append(
                DroppedDose(
                    dose_index=i,
                    reason="date field missing or below confidence threshold",
                )
            )
            continue
        confirmed.append(dose)
    return ConfirmedDoseFilterResult(confirmed=confirmed, dropped=dropped)


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
