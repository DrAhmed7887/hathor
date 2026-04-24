"""Tests for the card_extraction.py STUB variants.

These verify that the stub's output conforms to CardExtractionOutput and that
each variant behaves correctly when passed through the Phase D gate.

STUB-specific tests: real vision extraction will have its own test module.
"""

import unittest

from hathor.safety.phase_d import gate
from hathor.schemas.extraction import CardExtractionOutput
from hathor.tools.card_extraction import build_stub_output


class TestHappyPathVariant(unittest.TestCase):
    def test_returns_card_extraction_output(self):
        out = build_stub_output("")
        self.assertIsInstance(out, CardExtractionOutput)

    def test_all_confidences_are_one(self):
        out = build_stub_output("")
        # metadata
        self.assertEqual(out.card_metadata.detected_language.confidence, 1.0)
        self.assertEqual(out.card_metadata.overall_legibility.confidence, 1.0)
        self.assertEqual(out.card_metadata.patient_dob.confidence, 1.0)
        # doses
        for dose in out.extracted_doses:
            for f in (
                dose.transcribed_antigen,
                dose.date_administered,
                dose.dose_number_on_card,
            ):
                if f is not None:
                    self.assertEqual(f.confidence, 1.0)
                    self.assertFalse(f.needs_review)

    def test_passes_phase_d_with_no_hitl(self):
        out = build_stub_output("")
        r = gate(out)
        self.assertFalse(r.requires_review)
        self.assertEqual(r.hitl_queue, [])

    def test_extraction_method_label(self):
        out = build_stub_output("cards/nigeria_happy.jpg")
        self.assertIn("Nigerian EPI flagship", out.extraction_method)


class TestPhaseDDemoVariant(unittest.TestCase):
    def test_phase_d_image_path_triggers_demo(self):
        out = build_stub_output("cards/phase_d_test.jpg")
        self.assertIn("phase_d demo", out.extraction_method)

    def test_hitl_demo_image_path_also_triggers_demo(self):
        out = build_stub_output("cards/hitl_demo.jpg")
        self.assertIn("phase_d demo", out.extraction_method)

    def test_case_insensitive_matching(self):
        out = build_stub_output("CARDS/PHASE_D_CARD.JPG")
        self.assertIn("phase_d demo", out.extraction_method)

    def test_one_low_confidence_date_routes_to_hitl(self):
        out = build_stub_output("cards/phase_d_test.jpg")
        r = gate(out)
        self.assertTrue(r.requires_review)
        self.assertEqual(len(r.hitl_queue), 1)
        # the smudged field is Pentavalent dose 3's date (index 5 in the new
        # flagship: BCG=0, Penta1=1, OPV1=2, Penta2=3, OPV2=4, Penta3=5, OPV3=6)
        self.assertEqual(
            r.hitl_queue[0].field_path,
            "extracted_doses[5].date_administered",
        )
        self.assertIn("smudged", r.hitl_queue[0].reason.lower())

    def test_auto_committed_doses_retain_clean_fields(self):
        out = build_stub_output("cards/phase_d_test.jpg")
        r = gate(out)
        # the smudged field is nulled; everything else on that row survives
        dose3 = r.auto_committed.extracted_doses[5]  # Pentavalent dose 3 is at index 5
        self.assertIsNone(dose3.date_administered)
        self.assertEqual(dose3.transcribed_antigen.value, "Pentavalent (DPT-HepB-Hib)")
        self.assertEqual(dose3.dose_number_on_card.value, "3")
        # the other 6 doses are untouched
        for i in (0, 1, 2, 3, 4, 6):
            self.assertIsNotNone(
                r.auto_committed.extracted_doses[i].date_administered
            )


if __name__ == "__main__":
    unittest.main()
