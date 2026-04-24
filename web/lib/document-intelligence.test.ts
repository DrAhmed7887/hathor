/**
 * Tests for the lightweight, CrossBeam-inspired document-intelligence
 * layer: schema normalization + conservative evidence merger.
 *
 * Run:
 *   node --experimental-strip-types --test web/lib/document-intelligence.test.ts
 *   npm test   # runs the full suite (validation.test.ts + this file)
 *
 * Covers these acceptance points from the task spec:
 *   - schema normalization (valid, missing, malformed)
 *   - missing document_intelligence does not break parse response
 *   - evidence merger never drops parsed rows
 *   - booster rows remain booster through the merge
 *   - conflicting evidence creates a warning, not an overwrite
 *   - orientation warning appears in the trace data
 *   - Arabic row-label evidence is preserved verbatim
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mergeEvidenceIntoRows,
  normalizeDocumentIntelligence,
  type DocumentRegion,
  type EvidenceFragment,
  type LayoutAnalysisResult,
} from "./document-intelligence.ts";
import type { ParsedCardRow } from "./types.ts";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function row(partial: Partial<ParsedCardRow>): ParsedCardRow {
  return {
    antigen: "DTP",
    date: "2025-01-01",
    doseNumber: 1,
    doseKind: "primary",
    confidence: 1.0,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    ...partial,
  };
}

function region(partial: Partial<DocumentRegion>): DocumentRegion {
  return {
    region_id: "r1",
    kind: "vaccine_row",
    page_number: 1,
    label: null,
    source_text: null,
    confidence: 0.9,
    warnings: [],
    ...partial,
  };
}

function fragment(partial: Partial<EvidenceFragment>): EvidenceFragment {
  return {
    fragment_id: "f1",
    region_id: "r1",
    kind: "row_label",
    source_text: null,
    row_label: null,
    raw_date_text: null,
    vaccine_text: null,
    confidence: 0.9,
    warnings: [],
    ...partial,
  };
}

// ── normalizeDocumentIntelligence ───────────────────────────────────────────

test("normalize: null/undefined/non-object input returns a valid empty trace", () => {
  for (const input of [null, undefined, "string", 42, true, []]) {
    const out = normalizeDocumentIntelligence(input);
    assert.equal(out.pages_detected, 1);
    assert.equal(out.orientation_warning, null);
    assert.equal(out.crop_warning, null);
    assert.deepEqual(out.regions, []);
    assert.deepEqual(out.evidence_fragments, []);
    assert.equal(out.overall_confidence, 0);
    assert.deepEqual(out.warnings, []);
  }
});

test("normalize: fills missing fields with safe defaults", () => {
  const out = normalizeDocumentIntelligence({
    pages_detected: 2,
    regions: [{ kind: "vaccine_table" }, { kind: "bogus_kind" }],
    evidence_fragments: [{}],
  });
  assert.equal(out.pages_detected, 2);
  assert.equal(out.regions.length, 2);
  // Auto-assigned region_id when the model omits it.
  assert.ok(out.regions[0].region_id);
  // Unknown kinds fall back to "unknown" — we keep the region, we
  // don't discard it.
  assert.equal(out.regions[1].kind, "unknown");
  // Fragments with no data still get a stable fragment_id.
  assert.ok(out.evidence_fragments[0].fragment_id);
  // Confidence clamped into [0, 1].
  for (const r of out.regions) {
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
});

test("normalize: clamps out-of-range confidence and drops invalid array entries", () => {
  const out = normalizeDocumentIntelligence({
    regions: [null, 42, { kind: "vaccine_row", confidence: 5 }],
    evidence_fragments: [null, { kind: "row_label", confidence: -2 }],
  });
  assert.equal(out.regions.length, 1);
  assert.equal(out.regions[0].confidence, 1);
  assert.equal(out.evidence_fragments.length, 1);
  assert.equal(out.evidence_fragments[0].confidence, 0);
});

test("normalize: preserves Arabic row-label evidence verbatim", () => {
  // Acceptance: Arabic row-label evidence is preserved (not romanised
  // or otherwise reinterpreted by the normaliser).
  const out = normalizeDocumentIntelligence({
    evidence_fragments: [
      {
        fragment_id: "f1",
        kind: "row_label",
        source_text: "جرعة ثالثة: عند إتمام ٦ شهور من العمر",
        row_label: "جرعة ثالثة",
        confidence: 0.92,
      },
    ],
  });
  assert.equal(out.evidence_fragments.length, 1);
  assert.equal(
    out.evidence_fragments[0].source_text,
    "جرعة ثالثة: عند إتمام ٦ شهور من العمر",
  );
  assert.equal(out.evidence_fragments[0].row_label, "جرعة ثالثة");
});

test("normalize: orientation and crop warnings survive round-trip", () => {
  // Acceptance: orientation warning appears in the trace data.
  const out = normalizeDocumentIntelligence({
    orientation_warning: "Rotated 180°; header at the bottom edge",
    crop_warning: "Right margin cut off on dose-4 row",
  });
  assert.equal(
    out.orientation_warning,
    "Rotated 180°; header at the bottom edge",
  );
  assert.equal(out.crop_warning, "Right margin cut off on dose-4 row");
});

// ── mergeEvidenceIntoRows ───────────────────────────────────────────────────

test("merge: missing layout → used_fallback=true, rows unchanged", () => {
  // Acceptance: missing document_intelligence does not break the
  // downstream flow — it falls back cleanly.
  const rows = [row({ antigen: "DTP", doseNumber: 1 })];
  const out = mergeEvidenceIntoRows(null, rows);
  assert.equal(out.used_fallback, true);
  assert.deepEqual(out.rows, rows);
  assert.ok(out.warnings.length >= 1);
});

test("merge: empty layout (no regions/fragments) → fallback", () => {
  const rows = [row({ antigen: "DTP", doseNumber: 1 })];
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [],
    evidence_fragments: [],
    overall_confidence: 0,
    warnings: [],
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  assert.equal(out.used_fallback, true);
  assert.equal(out.rows.length, rows.length);
});

test("merge: never drops parsed rows even when layout is rich", () => {
  // Acceptance: evidence merger never drops parsed rows.
  const rows = [
    row({ antigen: "DTP", doseNumber: 1 }),
    row({ antigen: "DTP", doseNumber: 2 }),
    row({ antigen: "DTP", doseNumber: null, doseKind: "booster" }),
  ];
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [region({ region_id: "tbl", kind: "vaccine_table" })],
    evidence_fragments: [
      fragment({
        fragment_id: "fL1",
        region_id: "tbl",
        kind: "row_label",
        source_text: "1st dose",
        row_label: "1st dose",
        confidence: 0.95,
      }),
    ],
    overall_confidence: 0.9,
    warnings: [],
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  assert.equal(out.rows.length, 3);
  assert.deepEqual(
    out.rows.map((r) => r.antigen),
    ["DTP", "DTP", "DTP"],
  );
});

test("merge: booster row survives verbatim through the merge", () => {
  // Acceptance: booster row remains booster through merge.
  const booster = row({
    antigen: "DTP",
    doseNumber: null,
    doseKind: "booster",
    date: "2026-04-08",
  });
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [region({ region_id: "booster-row", kind: "vaccine_row" })],
    evidence_fragments: [
      fragment({
        fragment_id: "fB",
        region_id: "booster-row",
        kind: "row_label",
        source_text: "جرعة منشطة: عند إتمام ١٨ شهراً",
        row_label: "جرعة منشطة",
        confidence: 0.9,
      }),
    ],
    overall_confidence: 0.88,
    warnings: [],
  };
  const out = mergeEvidenceIntoRows(layout, [booster]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].doseKind, "booster");
  assert.equal(out.rows[0].doseNumber, null);
  // And the merger must NOT produce a "suggests dose X" warning for
  // booster rows — booster labels do not project onto numbered slots.
  for (const w of out.warnings) {
    assert.doesNotMatch(
      w,
      /suggests dose/,
      "booster evidence must not raise a numeric conflict warning",
    );
  }
});

test("merge: conflicting evidence produces a warning, never overwrites", () => {
  // Acceptance: conflicting evidence creates warning, not overwrite.
  const rows = [row({ antigen: "DTP", doseNumber: 2, doseKind: "primary" })];
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [region({ region_id: "row-3", kind: "vaccine_row" })],
    evidence_fragments: [
      fragment({
        fragment_id: "fC",
        region_id: "row-3",
        kind: "row_label",
        source_text: "3rd dose",
        row_label: "3rd dose",
        confidence: 0.94,
      }),
    ],
    overall_confidence: 0.9,
    warnings: [],
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  // Row is untouched — we never rewrite clinician-facing data.
  assert.equal(out.rows[0].doseNumber, 2);
  assert.equal(out.rows[0].doseKind, "primary");
  // Warning fired.
  assert.ok(
    out.warnings.some((w) => /suggests dose 3/.test(w)),
    `expected a "suggests dose 3" warning, got: ${JSON.stringify(out.warnings)}`,
  );
  assert.equal(out.used_fallback, false);
});

test("merge: orientation + crop warnings surface in the merge output", () => {
  const rows = [row({})];
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: "Rotated 180°",
    crop_warning: "Right edge cut off",
    regions: [region({})],
    evidence_fragments: [fragment({})],
    overall_confidence: 0.8,
    warnings: ["Low contrast on date cells"],
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  assert.ok(out.warnings.some((w) => /Rotated 180/.test(w)));
  assert.ok(out.warnings.some((w) => /Right edge cut off/.test(w)));
  assert.ok(out.warnings.some((w) => /Low contrast/.test(w)));
});

test("merge: Arabic ordinal row labels are understood for conflict detection", () => {
  // Acceptance-adjacent: Arabic row-label evidence is preserved AND
  // interpreted safely enough to flag a conflict, without losing the
  // original source text.
  const rows = [row({ antigen: "DTP", doseNumber: 1, doseKind: "primary" })];
  const layout: LayoutAnalysisResult = {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [region({})],
    evidence_fragments: [
      fragment({
        fragment_id: "fAr",
        kind: "row_label",
        source_text: "جرعة ثالثة",
        row_label: "جرعة ثالثة",
        confidence: 0.9,
      }),
    ],
    overall_confidence: 0.9,
    warnings: [],
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  assert.ok(
    out.warnings.some((w) => /suggests dose 3/.test(w)),
    `expected Arabic "ثالثة" to interpret as dose 3 conflict, got: ${JSON.stringify(out.warnings)}`,
  );
});
