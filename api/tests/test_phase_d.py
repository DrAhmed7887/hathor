"""Tests for Phase D (vision safety loop) gate.

Uses stdlib unittest to avoid adding pytest as a dependency for now.
Run with: `python -m unittest api.tests.test_phase_d` from the project root,
or `uv run python -m unittest tests.test_phase_d` from `api/`.
"""

import unittest

from hathor.safety.phase_d import CONFIDENCE_THRESHOLD, gate
from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)


def _hi(value: str) -> FieldExtraction:
    return FieldExtraction(value=value, confidence=0.95)


def _lo(value: str, reason: str = "smudged") -> FieldExtraction:
    return FieldExtraction(
        value=value, confidence=0.62, needs_review=True, ambiguity_reason=reason
    )


def _extraction(doses: list[ExtractedDose]) -> CardExtractionOutput:
    return CardExtractionOutput(
        card_metadata=CardMetadata(
            detected_language=_hi("English"),
            overall_legibility=_hi("High"),
            patient_dob=_hi("2023-06-15"),
        ),
        extracted_doses=doses,
        extraction_method="test-fixture",
    )


class TestPhaseDGate(unittest.TestCase):
    def test_all_high_confidence_passes_through(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-08-15"),
            )
        ])
        r = gate(e)
        self.assertFalse(r.requires_review)
        self.assertEqual(r.hitl_queue, [])
        self.assertEqual(
            r.auto_committed.extracted_doses[0].transcribed_antigen.value,
            "Hexyon",
        )

    def test_low_confidence_field_routes_to_hitl(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_lo("2024-08-1?", "Day digit smudged"),
            )
        ])
        r = gate(e)
        self.assertTrue(r.requires_review)
        self.assertEqual(len(r.hitl_queue), 1)
        self.assertEqual(
            r.hitl_queue[0].field_path,
            "extracted_doses[0].date_administered",
        )
        self.assertEqual(r.hitl_queue[0].reason, "Day digit smudged")
        self.assertEqual(r.hitl_queue[0].dose_index, 0)
        # auto-committed keeps the high-confidence antigen, nulls the smudged date
        row = r.auto_committed.extracted_doses[0]
        self.assertEqual(row.transcribed_antigen.value, "Hexyon")
        self.assertIsNone(row.date_administered)

    def test_needs_review_flag_routes_even_when_confidence_high(self):
        flagged = FieldExtraction(
            value="MMR",
            confidence=0.92,
            needs_review=True,
            ambiguity_reason="ambiguous abbreviation",
        )
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=flagged,
                date_administered=_hi("2025-06-15"),
            )
        ])
        r = gate(e)
        self.assertEqual(len(r.hitl_queue), 1)
        self.assertEqual(r.hitl_queue[0].reason, "ambiguous abbreviation")

    def test_per_field_gating_not_per_row(self):
        """Multiple fields on the same row route independently."""
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_lo("Rougeole", "faded ink"),
                date_administered=_hi("2023-09-15"),
                lot_number=_lo("??-4421", "leading digits unreadable"),
            )
        ])
        r = gate(e)
        # two distinct HITL items from one row
        self.assertEqual(len(r.hitl_queue), 2)
        paths = sorted(h.field_path for h in r.hitl_queue)
        self.assertEqual(paths, [
            "extracted_doses[0].lot_number",
            "extracted_doses[0].transcribed_antigen",
        ])
        row = r.auto_committed.extracted_doses[0]
        self.assertEqual(row.date_administered.value, "2023-09-15")
        self.assertIsNone(row.transcribed_antigen)
        self.assertIsNone(row.lot_number)

    def test_card_metadata_fields_also_gated(self):
        e = CardExtractionOutput(
            card_metadata=CardMetadata(
                detected_language=_hi("English"),
                overall_legibility=_hi("Medium"),
                patient_dob=_lo("2023-0?-15", "Month digit unclear"),
            ),
            extracted_doses=[],
            extraction_method="test-fixture",
        )
        r = gate(e)
        self.assertEqual(len(r.hitl_queue), 1)
        self.assertIsNone(r.hitl_queue[0].dose_index)
        self.assertEqual(
            r.hitl_queue[0].field_path, "card_metadata.patient_dob"
        )
        self.assertIsNone(r.auto_committed.card_metadata.patient_dob)

    def test_threshold_boundary_is_inclusive(self):
        """Confidence exactly at the threshold passes (not flagged)."""
        at_threshold = FieldExtraction(
            value="Hexyon",
            confidence=CONFIDENCE_THRESHOLD,
            needs_review=False,
        )
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=at_threshold,
                date_administered=_hi("2024-08-15"),
            )
        ])
        r = gate(e)
        self.assertFalse(r.requires_review)

    def test_none_field_stays_none(self):
        """A field that wasn't extracted at all (None) stays None and
        does not appear in the HITL queue — that case is 'not present on
        card', distinct from 'extracted but uncertain'."""
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-08-15"),
                # lot_number, provider_signature, dose_number_on_card all None
            )
        ])
        r = gate(e)
        self.assertEqual(r.hitl_queue, [])
        self.assertIsNone(r.auto_committed.extracted_doses[0].lot_number)

    def test_extraction_method_preserved(self):
        e = _extraction([
            ExtractedDose(transcribed_antigen=_hi("Hexyon"))
        ])
        r = gate(e)
        self.assertEqual(r.auto_committed.extraction_method, "test-fixture")


if __name__ == "__main__":
    unittest.main()
