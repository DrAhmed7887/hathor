"""Tests that the agent system prompt keeps up with the extraction schema.

Not a full integration test — we don't call the LLM here. These are
schema-handling tests: they prove (a) the prompt documents what the agent
needs to know about CardExtractionOutput, and (b) the @tool-wrapped
coroutine's output round-trips into CardExtractionOutput so the agent can
consume it without schema drift.
"""

import asyncio
import json
import unittest

from hathor.agent_prompt import SYSTEM_PROMPT
from hathor.schemas.extraction import CardExtractionOutput
from hathor.tools.card_extraction import extract_vaccinations_from_card


class TestSystemPromptDocumentsExtractionSchema(unittest.TestCase):
    def test_prompt_documents_per_field_shape(self):
        """Prompt must mention value/confidence/needs_review/ambiguity_reason."""
        for key in ("value", "confidence", "needs_review", "ambiguity_reason"):
            self.assertIn(
                key, SYSTEM_PROMPT,
                f"System prompt is missing documentation for `{key}`",
            )

    def test_prompt_documents_new_field_names(self):
        """Prompt must reference the new schema keys the agent will see."""
        for key in (
            "transcribed_antigen",
            "date_administered",
            "card_metadata",
            "patient_dob",
        ):
            self.assertIn(
                key, SYSTEM_PROMPT,
                f"System prompt does not document `{key}`",
            )

    def test_prompt_warns_against_legacy_field_names(self):
        """Prompt should explicitly tell the agent not to use the old names
        (vaccine_trade_name, date_given, child_dob) since those no longer
        appear in the extraction output."""
        self.assertIn("date_given", SYSTEM_PROMPT)  # mentioned to mark as old
        self.assertIn("child_dob", SYSTEM_PROMPT)

    def test_prompt_documents_threshold(self):
        """Prompt must name the 0.85 threshold so the agent handles
        low-confidence fields consistently with Phase D."""
        self.assertIn("0.85", SYSTEM_PROMPT)

    def test_prompt_instructs_unverified_handling(self):
        """Prompt must tell the agent to flag (not use) low-confidence fields."""
        self.assertIn("UNVERIFIED", SYSTEM_PROMPT)
        self.assertIn("needs_verification", SYSTEM_PROMPT)


class TestToolOutputRoundTripsIntoSchema(unittest.TestCase):
    """Exercise the @tool-wrapped coroutine. Verify the JSON text the agent
    receives parses back into CardExtractionOutput without drift."""

    def _invoke(self, image_path: str) -> dict:
        # The @tool decorator wraps the function in an SdkMcpTool; the underlying
        # coroutine lives on .handler.
        result = asyncio.run(
            extract_vaccinations_from_card.handler({"image_path": image_path})
        )
        text = result["content"][0]["text"]
        payload = json.loads(text)
        # The tool echoes the image_path for debugging; strip before validation.
        payload.pop("image_path_received", None)
        return payload

    def test_happy_path_round_trip(self):
        payload = self._invoke("cards/nigeria.jpg")
        parsed = CardExtractionOutput.model_validate(payload)
        self.assertEqual(
            parsed.extracted_doses[0].transcribed_antigen.value, "Hexyon"
        )
        self.assertEqual(parsed.card_metadata.patient_dob.value, "2024-06-15")
        # Every field's confidence is 1.0 on the happy path.
        for f in (
            parsed.card_metadata.patient_dob,
            parsed.extracted_doses[0].transcribed_antigen,
            parsed.extracted_doses[0].date_administered,
        ):
            self.assertEqual(f.confidence, 1.0)

    def test_phase_d_variant_round_trip(self):
        payload = self._invoke("cards/phase_d_demo.jpg")
        parsed = CardExtractionOutput.model_validate(payload)
        smudged = parsed.extracted_doses[2].date_administered
        self.assertTrue(smudged.needs_review)
        self.assertLess(smudged.confidence, 0.85)
        self.assertIn("smudged", smudged.ambiguity_reason.lower())


class TestAgentTranslationFromSchemaToDownstreamTools(unittest.TestCase):
    """Simulate what the agent does with an extraction result: unwrap each
    FieldExtraction to build the scalar arguments downstream tools expect
    (lookup_vaccine_equivalence, validate_dose, compute_age_at_dose). Prove
    the new schema carries all the scalars the agent needs."""

    def test_happy_path_yields_full_scalar_dose_list(self):
        from hathor.tools.card_extraction import build_stub_output

        out = build_stub_output("cards/nigeria.jpg")
        child_dob = out.card_metadata.patient_dob.value

        scalar_doses = []
        for dose in out.extracted_doses:
            if dose.transcribed_antigen is None or dose.date_administered is None:
                continue  # would be a low-confidence field in a real card
            scalar_doses.append({
                "vaccine_trade_name": dose.transcribed_antigen.value,
                "date_given": dose.date_administered.value,
            })

        self.assertEqual(child_dob, "2024-06-15")
        self.assertEqual(len(scalar_doses), 4)
        self.assertEqual(scalar_doses[0]["vaccine_trade_name"], "Hexyon")
        self.assertEqual(scalar_doses[0]["date_given"], "2024-08-15")
        self.assertEqual(scalar_doses[-1]["vaccine_trade_name"], "MMR")

    def test_phase_d_variant_yields_three_scalars_and_one_flagged(self):
        """On the demo variant, the agent should end up with three usable
        scalar doses and one that needs verification (the smudged date)."""
        from hathor.tools.card_extraction import build_stub_output

        out = build_stub_output("cards/phase_d_demo.jpg")

        usable = []
        needs_verification = []
        for dose in out.extracted_doses:
            if dose.date_administered is None:
                continue
            if dose.date_administered.needs_review or dose.date_administered.confidence < 0.85:
                needs_verification.append(dose)
            else:
                usable.append(dose)

        self.assertEqual(len(usable), 3)
        self.assertEqual(len(needs_verification), 1)
        self.assertEqual(
            needs_verification[0].transcribed_antigen.value, "Hexyon"
        )


if __name__ == "__main__":
    unittest.main()
