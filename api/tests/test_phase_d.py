"""Tests for Phase D (vision safety loop) gate.

Uses stdlib unittest to avoid adding pytest as a dependency for now.
Run with: `python -m unittest api.tests.test_phase_d` from the project root,
or `uv run python -m unittest tests.test_phase_d` from `api/`.
"""

import json
import pathlib
import unittest

from hathor.safety.phase_d import (
    CONFIDENCE_THRESHOLD,
    filter_confirmed_doses,
    gate,
)
from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)


PARITY_FIXTURE_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "cards"
    / "fixtures"
    / "synthetic_trust_gate_parity.json"
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


class TestFilterConfirmedDoses(unittest.TestCase):
    """Trust gate — nothing reaches the agent unless it is either
    vision-confident (confidence >= threshold, not flagged) or was
    clinician-corrected (HITL merge writes confidence=1.0)."""

    def test_all_confirmed_passes_through(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-08-15"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("MMR"),
                date_administered=_hi("2025-02-01"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(len(r.confirmed), 2)
        self.assertEqual(r.dropped, [])

    def test_low_confidence_antigen_dropped(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_lo("Hexyon", "faded ink"),
                date_administered=_hi("2024-08-15"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(r.confirmed, [])
        self.assertEqual(len(r.dropped), 1)
        self.assertEqual(r.dropped[0].dose_index, 0)
        self.assertIn("antigen", r.dropped[0].reason)

    def test_low_confidence_date_dropped(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_lo("2024-08-1?", "smudged day digit"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(r.confirmed, [])
        self.assertEqual(len(r.dropped), 1)
        self.assertIn("date", r.dropped[0].reason)

    def test_needs_review_flag_drops_even_with_high_confidence(self):
        flagged = FieldExtraction(
            value="MMR",
            confidence=0.95,
            needs_review=True,
            ambiguity_reason="ambiguous abbreviation",
        )
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=flagged,
                date_administered=_hi("2025-06-15"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(r.confirmed, [])
        self.assertEqual(len(r.dropped), 1)

    def test_missing_field_dropped(self):
        # No date_administered at all — the card did not record one,
        # or HITL clinician chose "skip" on that field.
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("BCG"),
                date_administered=None,
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(r.confirmed, [])
        self.assertEqual(len(r.dropped), 1)

    def test_clinician_corrected_field_passes_through(self):
        # Post-HITL merge: clinician-corrected fields arrive with
        # confidence=1.0 and needs_review=False. The filter must
        # treat them as confirmed.
        corrected = FieldExtraction(
            value="2024-08-15",
            confidence=1.0,
            needs_review=False,
            ambiguity_reason=None,
        )
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=corrected,
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(len(r.confirmed), 1)
        self.assertEqual(r.dropped, [])

    def test_threshold_inclusivity(self):
        # confidence == CONFIDENCE_THRESHOLD passes (the Phase D
        # inclusivity convention is ">= threshold").
        on_threshold = FieldExtraction(
            value="Hexyon",
            confidence=CONFIDENCE_THRESHOLD,
            needs_review=False,
        )
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=on_threshold,
                date_administered=_hi("2024-08-15"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(len(r.confirmed), 1)

    def test_partial_set_some_confirmed_some_dropped(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-08-15"),
            ),
            ExtractedDose(
                transcribed_antigen=_lo("MMR", "faded"),
                date_administered=_hi("2025-02-01"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("BCG"),
                date_administered=_hi("2024-01-01"),
            ),
        ])
        r = filter_confirmed_doses(e)
        self.assertEqual(len(r.confirmed), 2)
        self.assertEqual(len(r.dropped), 1)
        self.assertEqual(r.dropped[0].dose_index, 1)

    def test_pure_function_does_not_mutate_input(self):
        e = _extraction([
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_lo("2024-08-1?", "smudged"),
            ),
        ])
        before = e.model_dump()
        filter_confirmed_doses(e)
        after = e.model_dump()
        self.assertEqual(before, after)


class TestParityFixture(unittest.TestCase):
    """Cross-language parity for filter_confirmed_doses.

    Replays every case in cards/fixtures/synthetic_trust_gate_parity.json
    against the Python implementation. The TS side runs the same
    fixture in web/lib/trust-gate.test.ts. Both implementations are
    required to admit/drop identically — if either side diverges, this
    test (or its TS twin) fails first.
    """

    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(PARITY_FIXTURE_PATH.read_text())

    def test_threshold_matches_python_constant(self):
        self.assertEqual(
            self.fixture["threshold"],
            CONFIDENCE_THRESHOLD,
            "fixture threshold drifted from the Python CONFIDENCE_THRESHOLD",
        )

    def test_every_case_admits_or_drops_as_expected(self):
        for case in self.fixture["cases"]:
            with self.subTest(case=case["id"]):
                # Translate the neutral parity case into the Python
                # ExtractedDose schema. Python encodes the
                # admission decision via per-field confidence +
                # needs_review; the row-level "source" value is
                # only consulted by the TS side and is irrelevant
                # here because the Python schema has no source field.
                # The fixture authors guarantee that every case
                # whose row_source is non-vision also has a
                # corresponding per-field signal (confidence below
                # threshold or needs_review=True) so the Python
                # decision matches.
                antigen_field = (
                    None
                    if case["antigen"]["value"] is None
                    else FieldExtraction(
                        value=case["antigen"]["value"],
                        confidence=case["antigen"]["confidence"],
                        needs_review=case["antigen"]["needs_review"],
                    )
                )
                date_field = (
                    None
                    if case["date"]["value"] is None
                    else FieldExtraction(
                        value=case["date"]["value"],
                        confidence=case["date"]["confidence"],
                        needs_review=case["date"]["needs_review"],
                    )
                )
                extraction = CardExtractionOutput(
                    card_metadata=CardMetadata(),
                    extracted_doses=[
                        ExtractedDose(
                            transcribed_antigen=antigen_field,
                            date_administered=date_field,
                        )
                    ],
                    extraction_method=f"parity-fixture::{case['id']}",
                )
                result = filter_confirmed_doses(extraction)

                if case["expected"] == "admit":
                    self.assertEqual(
                        len(result.confirmed),
                        1,
                        f"case '{case['id']}' expected admit but Python "
                        f"dropped: "
                        f"{result.dropped[0].reason if result.dropped else '?'}",
                    )
                    self.assertEqual(len(result.dropped), 0)
                else:
                    self.assertEqual(
                        len(result.confirmed),
                        0,
                        f"case '{case['id']}' expected drop but Python admitted",
                    )
                    self.assertEqual(len(result.dropped), 1)
                    expected_substr = case.get("expected_reason_substring")
                    if expected_substr:
                        self.assertIn(
                            expected_substr.lower(),
                            result.dropped[0].reason.lower(),
                            f"case '{case['id']}' drop reason "
                            f"'{result.dropped[0].reason}' did not contain "
                            f"'{expected_substr}'",
                        )


if __name__ == "__main__":
    unittest.main()
