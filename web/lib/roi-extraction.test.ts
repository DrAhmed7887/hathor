/**
 * Tests for the per-ROI extraction orchestrator (roi-extraction.ts)
 * and the per-ROI prompt regression (roi-extraction-prompt.ts).
 *
 * No live Anthropic calls. Tests inject a deterministic mock cropper
 * and a deterministic mock vision callable. The mocks are tiny so the
 * orchestrator's behaviour around blanks / mismatches / concurrency
 * is the only thing under test.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CONFIDENCE_THRESHOLD } from "./trust-gate.ts";
import { loadEgyptMohpTemplate, resetTemplateCache, type VaccineCardTemplateJson } from "./templates/egypt-mohp.ts";
import {
  runRoiExtraction,
  type Cropper,
  type RoiVisionCall,
  type RoiReadResult,
} from "./roi-extraction.ts";
import {
  ROI_EXTRACTION_SYSTEM_PROMPT,
  ROI_EXTRACTION_TOOL,
  ROI_EXTRACTION_TOOL_NAME,
} from "./roi-extraction-prompt.ts";
import type { PixelRect } from "./image-crop.ts";

// ── Test scaffolding ────────────────────────────────────────────────────────

const CARD_DIMS = { width: 1600, height: 1050 } as const;

function loadTemplate(): VaccineCardTemplateJson {
  resetTemplateCache();
  return loadEgyptMohpTemplate();
}

function dummyImageBuffer(): Buffer {
  // Length encodes "image bytes" — content does not matter; the cropper
  // and vision are mocks.
  return Buffer.from("test-image", "utf8");
}

/** Cropper mock: returns a deterministic buffer derived from the rect. */
function makeMockCropper(): { cropper: Cropper; calls: PixelRect[] } {
  const calls: PixelRect[] = [];
  const cropper: Cropper = async (image, rect) => {
    calls.push(rect);
    void image;
    return Buffer.from(`crop:${rect.x}:${rect.y}:${rect.width}:${rect.height}`);
  };
  return { cropper, calls };
}

/** Vision mock factory: returns a different RoiReadResult per crop
 * based on a per-row override map keyed by template_spec_index. */
function makeVisionByIndex(
  template: VaccineCardTemplateJson,
  perIndex: (idx: number) => RoiReadResult,
): { roiVision: RoiVisionCall; concurrencyHigh: () => number } {
  let inFlight = 0;
  let high = 0;
  const cropToIndex = new Map<string, number>();
  for (let i = 0; i < template.row_specs.length; i++) {
    const spec = template.row_specs[i];
    const r = denormForKey(spec.date_roi);
    cropToIndex.set(r, spec.row_index);
  }
  const roiVision: RoiVisionCall = async (cropBytes, _mime) => {
    inFlight++;
    if (inFlight > high) high = inFlight;
    // Tiny await so concurrent calls overlap in event-loop time.
    await new Promise((r) => setTimeout(r, 5));
    const key = cropBytes.toString("utf8");
    // crop: prefix carries the rect; keep only the middle for matching.
    const rect = key.replace(/^crop:/, "");
    const idx = cropToIndex.get(rect);
    inFlight--;
    if (idx === undefined) {
      throw new Error(`vision mock: no row matches crop ${rect}`);
    }
    return perIndex(idx);
  };
  return { roiVision, concurrencyHigh: () => high };
}

function denormForKey(box: { x: number; y: number; width: number; height: number }) {
  // Mirror image-crop's denormalize logic for this fixture (no clamping
  // needed because the canonical template fits inside [0,1]).
  const x = Math.round(box.x * CARD_DIMS.width);
  const y = Math.round(box.y * CARD_DIMS.height);
  const x1 = Math.round((box.x + box.width) * CARD_DIMS.width);
  const y1 = Math.round((box.y + box.height) * CARD_DIMS.height);
  return `${x}:${y}:${x1 - x}:${y1 - y}`;
}

// ── Per-ROI prompt regression (lock the load-bearing phrasing) ───────────────

test("prompt: contains 'single cell' to anchor the model on one crop", () => {
  assert.match(ROI_EXTRACTION_SYSTEM_PROMPT, /single cell/i);
});

test("prompt: explicitly says 'do not infer' (no schedule reasoning)", () => {
  assert.match(ROI_EXTRACTION_SYSTEM_PROMPT, /do not infer/i);
});

test("prompt: explicitly says 'do not guess'", () => {
  assert.match(ROI_EXTRACTION_SYSTEM_PROMPT, /do not guess/i);
});

test("prompt: documents the blank_or_illegible field semantics", () => {
  assert.match(ROI_EXTRACTION_SYSTEM_PROMPT, /blank_or_illegible/);
});

test("prompt: tool is named record_roi_read", () => {
  assert.equal(ROI_EXTRACTION_TOOL_NAME, "record_roi_read");
  assert.equal(ROI_EXTRACTION_TOOL.name, "record_roi_read");
});

test("prompt: tool input_schema requires the five expected fields", () => {
  assert.deepEqual([...ROI_EXTRACTION_TOOL.input_schema.required].sort(), [
    "blank_or_illegible",
    "confidence",
    "normalized_date_candidate",
    "raw_text",
    "reasoning_if_uncertain",
  ]);
});

// ── Orchestrator: full-confidence read across all 9 ROIs ────────────────────

test("orchestrator: every ROI confident → 9 source='vision' rows", async () => {
  const template = loadTemplate();
  const { cropper, calls } = makeMockCropper();
  const dates = [
    "2024-01-01", "2024-01-08", "2024-01-15", "2024-03-01",
    "2024-05-01", "2024-07-01", "2024-10-01", "2025-01-01",
    "2025-07-01",
  ];
  const { roiVision } = makeVisionByIndex(template, (idx) => ({
    raw_text: dates[idx],
    normalized_date_candidate: dates[idx],
    confidence: 0.95,
    blank_or_illegible: false,
    reasoning_if_uncertain: null,
  }));

  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });

  assert.equal(out.rows.length, 9);
  assert.equal(calls.length, 9, "cropper called once per row_spec");
  for (let i = 0; i < 9; i++) {
    const row = out.rows[i];
    assert.equal(row.template_spec_index, i, `row ${i} keeps template_spec_index`);
    assert.equal(row.source, "vision");
    assert.equal(row.slot_state, "extracted");
    assert.equal(row.date, dates[i]);
    assert.equal(row.prediction_id, `V:roi-${i}`);
    assert.equal(row.sourceEvidenceFragmentId, `roi-${i}`);
    assert.equal(row.clinician_action, "none");
    assert.ok(row.confidence >= CONFIDENCE_THRESHOLD);
  }
});

// ── Orchestrator: blanks degrade to AMBER, never source='vision' ────────────

test("orchestrator: blank_or_illegible → date=null, source='vision_low_confidence'", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision } = makeVisionByIndex(template, () => ({
    raw_text: null,
    normalized_date_candidate: null,
    confidence: 0.0,
    blank_or_illegible: true,
    reasoning_if_uncertain: "cell appears blank",
  }));

  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });
  assert.equal(out.rows.length, 9);
  for (const row of out.rows) {
    assert.equal(row.date, null);
    assert.equal(row.source, "vision_low_confidence");
    assert.equal(row.slot_state, "ambiguous");
    assert.ok(row.confidence < CONFIDENCE_THRESHOLD);
  }
  for (const diag of out.diagnostics) {
    assert.equal(diag.cross_check, "blank");
    assert.equal(diag.blank_or_illegible, true);
  }
});

// ── Orchestrator: candidate / parser disagreement degrades to AMBER ─────────

test("orchestrator: candidate vs parser mismatch → AMBER, parser wins", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  // raw_text parses as 2024-01-01; model claims 2024-01-02 — mismatch.
  const { roiVision } = makeVisionByIndex(template, () => ({
    raw_text: "01/01/2024",
    normalized_date_candidate: "2024-01-02",
    confidence: 0.95,
    blank_or_illegible: false,
    reasoning_if_uncertain: null,
  }));

  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });

  for (let i = 0; i < 9; i++) {
    const row = out.rows[i];
    const diag = out.diagnostics[i];
    assert.equal(row.date, "2024-01-01", "parser verdict wins on mismatch");
    assert.equal(row.source, "vision_low_confidence");
    assert.ok(row.confidence < CONFIDENCE_THRESHOLD);
    assert.equal(diag.cross_check, "mismatch");
  }
});

// ── Orchestrator: candidate-only (parser couldn't parse) → AMBER ────────────

test("orchestrator: candidate without parseable raw_text → AMBER, candidate kept", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision } = makeVisionByIndex(template, () => ({
    raw_text: "Jan 2024", // parseRawDate cannot parse this
    normalized_date_candidate: "2024-01-15",
    confidence: 0.9,
    blank_or_illegible: false,
    reasoning_if_uncertain: "month-name format, not a digits date",
  }));
  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });
  for (let i = 0; i < 9; i++) {
    const row = out.rows[i];
    const diag = out.diagnostics[i];
    assert.equal(row.date, "2024-01-15");
    assert.equal(row.source, "vision_low_confidence");
    assert.ok(row.confidence < CONFIDENCE_THRESHOLD);
    assert.equal(diag.cross_check, "candidate_only");
  }
});

// ── Orchestrator: parser-only (model returned null candidate) → AMBER ────────

test("orchestrator: parser succeeds but model emits null candidate → AMBER", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision } = makeVisionByIndex(template, () => ({
    raw_text: "01/03/2024",
    normalized_date_candidate: null,
    confidence: 0.92,
    blank_or_illegible: false,
    reasoning_if_uncertain: "unsure whether to commit to a YYYY-MM-DD form",
  }));
  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });
  for (let i = 0; i < 9; i++) {
    const row = out.rows[i];
    const diag = out.diagnostics[i];
    assert.equal(row.date, "2024-03-01", "parser fills the date when model demurred");
    assert.equal(row.source, "vision_low_confidence");
    assert.ok(row.confidence < CONFIDENCE_THRESHOLD);
    assert.ok(row.confidence <= 0.7 + 1e-9, "confidence capped to single-side threshold");
    assert.equal(diag.cross_check, "parsed_only");
  }
});

// ── Orchestrator: low model confidence stays AMBER even on a match ──────────

test("orchestrator: low model confidence on a matched read still routes to AMBER", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision } = makeVisionByIndex(template, () => ({
    raw_text: "01/01/2024",
    normalized_date_candidate: "2024-01-01",
    confidence: 0.7, // below threshold
    blank_or_illegible: false,
    reasoning_if_uncertain: "year smudged",
  }));
  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });
  for (const row of out.rows) {
    assert.equal(row.source, "vision_low_confidence");
    assert.equal(row.slot_state, "ambiguous");
    assert.equal(row.date, "2024-01-01");
  }
});

// ── Orchestrator: row order is deterministic regardless of completion order ─

test("orchestrator: output is sorted by template_spec_index even with stale resolves", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const dates = [
    "2024-01-01", "2024-01-08", "2024-01-15", "2024-03-01",
    "2024-05-01", "2024-07-01", "2024-10-01", "2025-01-01",
    "2025-07-01",
  ];
  // Resolve calls in reverse order — the orchestrator must still
  // emit rows in row_index 0..8 order.
  const cropToIndex = new Map<string, number>();
  for (let i = 0; i < template.row_specs.length; i++) {
    cropToIndex.set(denormForKey(template.row_specs[i].date_roi), i);
  }
  const roiVision: RoiVisionCall = async (cropBytes) => {
    const idx = cropToIndex.get(cropBytes.toString("utf8").replace(/^crop:/, ""))!;
    // Higher idx → resolves sooner.
    await new Promise((r) => setTimeout(r, (8 - idx) * 2));
    return {
      raw_text: dates[idx],
      normalized_date_candidate: dates[idx],
      confidence: 0.9,
      blank_or_illegible: false,
      reasoning_if_uncertain: null,
    };
  };
  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
    concurrency: 9,
  });
  for (let i = 0; i < 9; i++) {
    assert.equal(out.rows[i].template_spec_index, i);
    assert.equal(out.rows[i].date, dates[i]);
  }
});

// ── Concurrency cap respected ───────────────────────────────────────────────

test("orchestrator: respects the concurrency cap", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision, concurrencyHigh } = makeVisionByIndex(template, () => ({
    raw_text: "01/01/2024",
    normalized_date_candidate: "2024-01-01",
    confidence: 0.9,
    blank_or_illegible: false,
    reasoning_if_uncertain: null,
  }));
  await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
    concurrency: 3,
  });
  assert.ok(
    concurrencyHigh() <= 3,
    `concurrency high water mark ${concurrencyHigh()} exceeded cap 3`,
  );
  assert.ok(
    concurrencyHigh() >= 2,
    `concurrency high water mark ${concurrencyHigh()} too low — calls did not overlap`,
  );
});

// ── Predicted rows: orchestrator never emits source='predicted_*' ───────────
// The orchestrator is the vision-side surface; predicted rows come from
// inferRowsFromTemplate downstream. This test pins that contract.
test("orchestrator: never emits predicted-source rows itself", async () => {
  const template = loadTemplate();
  const { cropper } = makeMockCropper();
  const { roiVision } = makeVisionByIndex(template, (idx) =>
    idx % 2 === 0
      ? {
          raw_text: "01/01/2024",
          normalized_date_candidate: "2024-01-01",
          confidence: 0.95,
          blank_or_illegible: false,
          reasoning_if_uncertain: null,
        }
      : {
          raw_text: null,
          normalized_date_candidate: null,
          confidence: 0,
          blank_or_illegible: true,
          reasoning_if_uncertain: "blank",
        },
  );
  const out = await runRoiExtraction({
    imageBuffer: dummyImageBuffer(),
    mimeType: "image/png",
    imageDimensions: CARD_DIMS,
    template,
    cropper,
    roiVision,
  });
  for (const row of out.rows) {
    assert.notEqual(row.source, "template_inferred");
    assert.notEqual(row.source, "predicted_from_schedule");
    assert.equal(row.predicted_subkind, null);
  }
});
