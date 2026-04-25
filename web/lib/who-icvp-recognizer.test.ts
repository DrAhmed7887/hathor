/**
 * WHO/ICVP template recognition + registry tests.
 *
 * Covers:
 *   1. recognizeTemplate flips on each of the official IHR title strings
 *      (EN, FR, ES) and on the synthetic-card disclosure stamp.
 *   2. Egypt MoHP markers continue to win their own card after the new
 *      WHO branch was added.
 *   3. WHO_ICVP_TEMPLATE is registered with empty row_specs — there is
 *      NO template inference for ICVP cards (no fixed age slots).
 *   4. The card-extraction prompt teaches the model the WHO/ICVP rules.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  VACCINE_CARD_TEMPLATES,
  recognizeTemplate,
  type LayoutAnalysisResult,
} from "./document-intelligence.ts";
import { CARD_EXTRACTION_SYSTEM_PROMPT } from "./card-extraction-prompt.ts";

function fakeLayout(regionTexts: string[]): LayoutAnalysisResult {
  return {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: regionTexts.map((t, i) => ({
      region_id: `r${i}`,
      kind: "child_info",
      page_number: 1,
      label: null,
      source_text: t,
      confidence: 0.9,
      warnings: [],
    })),
    evidence_fragments: [],
    overall_confidence: 0.9,
    warnings: [],
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
  };
}

test("recognizes WHO/ICVP from English IHR title", () => {
  const layout = fakeLayout([
    "International Certificate of Vaccination or Prophylaxis",
  ]);
  assert.equal(
    recognizeTemplate(layout),
    "who_icvp_international_certificate",
  );
});

test("recognizes WHO/ICVP from French IHR title", () => {
  const layout = fakeLayout([
    "Certificat International de Vaccination ou de Prophylaxie",
  ]);
  assert.equal(
    recognizeTemplate(layout),
    "who_icvp_international_certificate",
  );
});

test("recognizes WHO/ICVP from Spanish IHR title", () => {
  const layout = fakeLayout([
    "Certificado Internacional de Vacunación o Profilaxis",
  ]);
  assert.equal(
    recognizeTemplate(layout),
    "who_icvp_international_certificate",
  );
});

test("recognizes WHO/ICVP from synthetic disclosure stamp", () => {
  const layout = fakeLayout(["SYNTHETIC TEST RECORD — NOT VALID FOR TRAVEL"]);
  assert.equal(
    recognizeTemplate(layout),
    "who_icvp_international_certificate",
  );
});

test("Egyptian MoHP marker still wins its own card", () => {
  const layout = fakeLayout(["التطعيمات الإجبارية"]);
  assert.equal(
    recognizeTemplate(layout),
    "egypt_mohp_mandatory_childhood_immunization",
  );
});

test("WHO_ICVP_TEMPLATE has empty row_specs (no template inference for ICVP)", () => {
  const tmpl = VACCINE_CARD_TEMPLATES.who_icvp_international_certificate;
  assert.equal(tmpl.template_id, "who_icvp_international_certificate");
  assert.equal(
    tmpl.row_specs.length,
    0,
    "ICVP cards must not synthesise rows from a fixed schedule — entries are traveller-driven",
  );
});

test("prompt instructs the model to recognise WHO/ICVP cards", () => {
  const text = CARD_EXTRACTION_SYSTEM_PROMPT.toLowerCase();
  assert.match(text, /who_icvp_international_certificate/);
  assert.match(text, /international certificate of vaccination/);
});

test("prompt forbids echoing the passport number into rows", () => {
  const text = CARD_EXTRACTION_SYSTEM_PROMPT.toLowerCase();
  assert.match(text, /passport.*do not.*echo|do not.*passport/);
});

test("prompt requires preserving unknown disease/vaccine names verbatim", () => {
  const text = CARD_EXTRACTION_SYSTEM_PROMPT;
  // \s+ tolerates the wrapped line break the source file may contain.
  assert.match(text, /unknown disease or vaccine\s+names/i);
  assert.match(text, /verbatim/i);
});
