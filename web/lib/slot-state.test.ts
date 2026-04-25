/**
 * Tests for slot-state derivation, prediction-id formatting, and
 * the visit-first grouping helper.
 *
 * See docs/hitl-ui-design.md §1, §3, §6.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildVisits,
  predictedSubkindOf,
  predictionIdOf,
  slotStateForAudit,
  slotStateOf,
} from "./slot-state.ts";
import type { ParsedCardRow } from "./types.ts";

function row(partial: Partial<ParsedCardRow>): ParsedCardRow {
  return {
    antigen: "DTP",
    date: "2025-01-01",
    doseNumber: 1,
    doseKind: "primary",
    confidence: 0.95,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    source: "vision",
    ...partial,
  };
}

// ── slotStateOf ─────────────────────────────────────────────────────────────

test("slotStateOf: vision + high confidence → extracted", () => {
  assert.equal(slotStateOf(row({ source: "vision", confidence: 0.95 })), "extracted");
});

test("slotStateOf: vision + confidence below threshold → ambiguous", () => {
  assert.equal(slotStateOf(row({ source: "vision", confidence: 0.6 })), "ambiguous");
});

test("slotStateOf: vision_low_confidence → ambiguous regardless of confidence", () => {
  assert.equal(
    slotStateOf(row({ source: "vision_low_confidence", confidence: 0.99 })),
    "ambiguous",
  );
});

test("slotStateOf: template_inferred → predicted", () => {
  assert.equal(
    slotStateOf(row({ source: "template_inferred", confidence: 0.5 })),
    "predicted",
  );
});

test("slotStateOf: predicted_from_schedule → predicted", () => {
  assert.equal(
    slotStateOf(row({ source: "predicted_from_schedule", confidence: 0.5 })),
    "predicted",
  );
});

test("slotStateOf: per-field confidence below threshold downgrades to ambiguous", () => {
  assert.equal(
    slotStateOf(
      row({
        source: "vision",
        confidence: 0.95,
        fieldConfidences: { antigen: 0.95, date: 0.5 },
      }),
    ),
    "ambiguous",
  );
});

test("slotStateOf: explicit slot_state on the row is preserved", () => {
  // If the wire boundary already populated slot_state, the helper
  // should not re-derive — that lets the route handler pick a state
  // even on rows whose source/confidence would imply something else
  // (the route is the wire contract).
  assert.equal(
    slotStateOf(
      row({
        source: "vision",
        confidence: 0.99,
        slot_state: "predicted",
      }),
    ),
    "predicted",
  );
});

// ── predictedSubkindOf ──────────────────────────────────────────────────────

test("predictedSubkindOf: zero vision rows → predicted_zero_vision_template", () => {
  const r = row({ source: "template_inferred", confidence: 0.5 });
  assert.equal(predictedSubkindOf(r, 0), "predicted_zero_vision_template");
});

test("predictedSubkindOf: one or more vision rows → predicted_missing_visit", () => {
  const r = row({ source: "template_inferred", confidence: 0.5 });
  assert.equal(predictedSubkindOf(r, 1), "predicted_missing_visit");
  assert.equal(predictedSubkindOf(r, 5), "predicted_missing_visit");
});

test("predictedSubkindOf: non-predicted rows always return null", () => {
  assert.equal(predictedSubkindOf(row({ source: "vision" }), 0), null);
  assert.equal(
    predictedSubkindOf(row({ source: "vision_low_confidence" }), 5),
    null,
  );
});

// ── slotStateForAudit ───────────────────────────────────────────────────────

test("slotStateForAudit: flattens predicted + subkind into one enum", () => {
  assert.equal(slotStateForAudit(row({ source: "vision", confidence: 0.95 })), "extracted");
  assert.equal(
    slotStateForAudit(row({ source: "vision_low_confidence" })),
    "ambiguous",
  );
  assert.equal(
    slotStateForAudit(
      row({
        source: "template_inferred",
        slot_state: "predicted",
        predicted_subkind: "predicted_zero_vision_template",
      }),
    ),
    "predicted_zero_vision_template",
  );
  assert.equal(
    slotStateForAudit(
      row({
        source: "template_inferred",
        slot_state: "predicted",
        predicted_subkind: "predicted_missing_visit",
      }),
    ),
    "predicted_missing_visit",
  );
});

// ── predictionIdOf ──────────────────────────────────────────────────────────

test("predictionIdOf: vision rows get V:<fragment_id> prefix", () => {
  const r = row({
    source: "vision",
    sourceEvidenceFragmentId: "frag-abc",
  });
  assert.equal(predictionIdOf(r), "V:frag-abc");
});

test("predictionIdOf: predicted rows get T:<spec_idx> prefix", () => {
  const r = row({
    source: "template_inferred",
    slot_state: "predicted",
    template_spec_index: 4,
  });
  assert.equal(predictionIdOf(r), "T:4");
});

test("predictionIdOf: predicted row without template_spec_index throws", () => {
  const r = row({
    source: "template_inferred",
    slot_state: "predicted",
    template_spec_index: null,
  });
  assert.throws(
    () => predictionIdOf(r),
    /predicted rows must carry template_spec_index/i,
  );
});

test("predictionIdOf: existing prediction_id passes through unchanged", () => {
  const r = row({ prediction_id: "T:7" });
  assert.equal(predictionIdOf(r), "T:7");
});

test("predictionIdOf: T: and V: prefixes are structurally distinguishable", () => {
  // The whole point of Limitation 3's fix: downstream logs / FHIR
  // exports tell predicted from vision rows by the prefix, never by
  // copy. This test asserts the structural promise.
  const visionId = predictionIdOf(
    row({ source: "vision", sourceEvidenceFragmentId: "f-1" }),
  );
  const predictedId = predictionIdOf(
    row({
      source: "template_inferred",
      slot_state: "predicted",
      template_spec_index: 1,
    }),
  );
  assert.ok(visionId.startsWith("V:"));
  assert.ok(predictedId.startsWith("T:"));
  assert.notEqual(visionId, predictedId);
});

// ── buildVisits ─────────────────────────────────────────────────────────────

test("buildVisits: groups rows by template_spec_index in ascending order", () => {
  const rows: ParsedCardRow[] = [
    row({ row_id: "r1", template_spec_index: 3, antigen: "DTP" }),
    row({ row_id: "r2", template_spec_index: 0, antigen: "HepB" }),
    row({ row_id: "r3", template_spec_index: 8, antigen: "DTP" }),
  ];
  const visits = buildVisits(rows, {
    0: "Birth",
    3: "2 months",
    8: "18 months",
  });
  assert.equal(visits.length, 3);
  assert.deepEqual(
    visits.map((v) => v.template_spec_index),
    [0, 3, 8],
  );
  assert.deepEqual(
    visits.map((v) => v.age_label),
    ["Birth", "2 months", "18 months"],
  );
});

test("buildVisits: rows with the same template_spec_index group into one visit", () => {
  const rows: ParsedCardRow[] = [
    row({ row_id: "r1", template_spec_index: 3, antigen: "DTP" }),
    row({ row_id: "r2", template_spec_index: 3, antigen: "OPV" }),
    row({ row_id: "r3", template_spec_index: 3, antigen: "PCV" }),
  ];
  const visits = buildVisits(rows, { 3: "2 months" });
  assert.equal(visits.length, 1);
  assert.equal(visits[0].rows.length, 3);
  assert.equal(visits[0].age_label, "2 months");
});

test("buildVisits: rows with null template_spec_index land in their own visits at the end", () => {
  const rows: ParsedCardRow[] = [
    row({ row_id: "r1", template_spec_index: 0, antigen: "HepB" }),
    row({ row_id: "r2", template_spec_index: null, antigen: "MysteryAntigen" }),
    row({ row_id: "r3", template_spec_index: 5, antigen: "DTP" }),
  ];
  const visits = buildVisits(rows, { 0: "Birth", 5: "6 months" });
  assert.equal(visits.length, 3);
  // Template-aligned visits come first.
  assert.equal(visits[0].template_spec_index, 0);
  assert.equal(visits[1].template_spec_index, 5);
  // Non-template visit at the end.
  assert.equal(visits[2].template_spec_index, null);
  assert.equal(visits[2].rows[0].antigen, "MysteryAntigen");
  assert.equal(visits[2].age_label, null);
});

test("buildVisits: empty input → empty visits", () => {
  assert.deepEqual(buildVisits([], {}), []);
});
