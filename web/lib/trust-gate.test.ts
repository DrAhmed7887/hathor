/**
 * Tests for the TS trust gate (filterConfirmedDoses).
 *
 * The first block exercises TS-native cases. The second block replays
 * the shared parity fixture
 * `cards/fixtures/synthetic_trust_gate_parity.json` and asserts the
 * same admit/drop outcome as the Python `filter_confirmed_doses`.
 * Identical replays in `api/tests/test_phase_d.py::TestParityFixture`
 * keep the two implementations honest.
 *
 * The third block asserts the gate cannot be bypassed at the funnel:
 * `buildValidationRecords` runs it before producing engine-wire
 * records. If a future PR renames or reorders the funnel, this test
 * is the safety net.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONFIDENCE_THRESHOLD,
  filterConfirmedDoses,
} from "./trust-gate.ts";
import { buildValidationRecords } from "./validation.ts";
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

// ── TS-native cases ─────────────────────────────────────────────────────────

test("filter: undefined source defaults to vision and admits when confidence ok", () => {
  const r = row({ source: undefined, confidence: 0.95 });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 1);
  assert.equal(out.dropped.length, 0);
});

test("filter: vision source admits at and above threshold (inclusivity)", () => {
  const out = filterConfirmedDoses([
    row({ confidence: CONFIDENCE_THRESHOLD }),
    row({ confidence: 0.99 }),
    row({ confidence: CONFIDENCE_THRESHOLD - 0.01 }),
  ]);
  assert.equal(out.confirmed.length, 2);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0].reason, /below threshold/i);
});

test("filter: template_inferred is never admitted, regardless of confidence", () => {
  const r = row({
    source: "template_inferred",
    // Even at impossibly high confidence, source bars it.
    confidence: 0.99,
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0].reason, /source/i);
});

test("filter: predicted_from_schedule is never admitted", () => {
  const r = row({ source: "predicted_from_schedule", confidence: 0.99 });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.match(out.dropped[0].reason, /source/i);
});

test("filter: vision_low_confidence is never admitted", () => {
  const r = row({ source: "vision_low_confidence", confidence: 0.99 });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.match(out.dropped[0].reason, /source/i);
});

test("filter: missing date drops the row", () => {
  const out = filterConfirmedDoses([
    row({ date: null }),
    row({ date: "" }),
  ]);
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.dropped.length, 2);
  for (const d of out.dropped) {
    assert.match(d.reason, /date/i);
  }
});

test("filter: per-field confidence below threshold drops even when row aggregate is fine", () => {
  // Row aggregate 0.95 looks fine, but the date cell specifically
  // came in at 0.5 — the gate must catch that.
  const r = row({
    confidence: 0.95,
    fieldConfidences: { antigen: 0.95, date: 0.5 },
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.match(out.dropped[0].reason, /date field confidence/i);
});

test("filter: per-field antigen confidence below threshold drops", () => {
  const r = row({
    confidence: 0.95,
    fieldConfidences: { antigen: 0.6, date: 0.95 },
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.match(out.dropped[0].reason, /antigen field confidence/i);
});

test("filter: confirmedIndices preserves original positions", () => {
  const rows = [
    row({ antigen: "BCG", confidence: 0.95 }),
    row({ antigen: "Bad", source: "template_inferred", confidence: 0.99 }),
    row({ antigen: "MMR", confidence: 0.95 }),
  ];
  const out = filterConfirmedDoses(rows);
  assert.deepEqual(out.confirmedIndices, [0, 2]);
  assert.deepEqual(
    out.confirmed.map((r) => r.antigen),
    ["BCG", "MMR"],
  );
  assert.equal(out.dropped[0].rowIndex, 1);
});

test("filter: pure — does not mutate input", () => {
  const r = row({ confidence: 0.5, source: "vision_low_confidence" });
  const before = JSON.stringify(r);
  filterConfirmedDoses([r]);
  const after = JSON.stringify(r);
  assert.equal(before, after);
});

test("filter: empty input returns empty result", () => {
  const out = filterConfirmedDoses([]);
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.dropped.length, 0);
  assert.equal(out.confirmedIndices.length, 0);
});

// ── Cross-language parity fixture ───────────────────────────────────────────

interface ParityCase {
  id: string;
  summary: string;
  antigen: { value: string | null; confidence: number; needs_review: boolean };
  date: { value: string | null; confidence: number; needs_review: boolean };
  /** Optional: TS-only cases use this to test source-bar semantics
   * (template_inferred, predicted_from_schedule, vision_low_confidence)
   * which have no Python schema analogue. Cross-language cases omit
   * it and default to "vision". */
  row_source?: ParsedCardRow["source"];
  row_confidence: number;
  expected: "admit" | "drop";
  expected_reason_substring?: string;
}

interface ParityFixture {
  description: string;
  threshold: number;
  /** Cross-language cases — Python AND TS both replay these. */
  cases: ParityCase[];
  /** TS-only cases — exercise the TS source-bar semantics. */
  ts_only_cases: ParityCase[];
}

const PARITY_FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "cards",
  "fixtures",
  "synthetic_trust_gate_parity.json",
);

const parityFixture = JSON.parse(
  readFileSync(PARITY_FIXTURE_PATH, "utf8"),
) as ParityFixture;

test("parity fixture: threshold matches the TS constant", () => {
  assert.equal(
    parityFixture.threshold,
    CONFIDENCE_THRESHOLD,
    "fixture threshold drifted from the TS constant — sync both implementations",
  );
});

function caseToRow(c: ParityCase): ParsedCardRow {
  // Translate the neutral parity-case into ParsedCardRow shape.
  // Cross-language cases default to source="vision" so the TS source
  // check passes and per-field signals drive the decision (matching
  // Python's per-field schema). TS-only cases set row_source
  // explicitly to test source-bar semantics.
  return {
    antigen: c.antigen.value ?? "(missing)",
    date: c.date.value,
    doseNumber: 1,
    doseKind: "primary",
    confidence: c.row_confidence,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    source: c.row_source ?? "vision",
    fieldConfidences: {
      antigen: c.antigen.confidence,
      date: c.date.confidence,
    },
  };
}

function assertParityCase(c: ParityCase) {
  const out = filterConfirmedDoses([caseToRow(c)]);
  if (c.expected === "admit") {
    assert.equal(
      out.confirmed.length,
      1,
      `case "${c.id}" expected admit but TS dropped: ${out.dropped[0]?.reason}`,
    );
    assert.equal(out.dropped.length, 0);
  } else {
    assert.equal(
      out.confirmed.length,
      0,
      `case "${c.id}" expected drop but TS admitted`,
    );
    assert.equal(out.dropped.length, 1);
    if (c.expected_reason_substring) {
      assert.match(
        out.dropped[0].reason,
        new RegExp(c.expected_reason_substring, "i"),
        `case "${c.id}" drop reason "${out.dropped[0].reason}" did not contain "${c.expected_reason_substring}"`,
      );
    }
  }
}

for (const c of parityFixture.cases) {
  test(`parity · ${c.id}: ${c.summary}`, () => assertParityCase(c));
}

for (const c of parityFixture.ts_only_cases) {
  test(`ts-only parity · ${c.id}: ${c.summary}`, () => assertParityCase(c));
}

// ── Funnel-enforcement test ─────────────────────────────────────────────────

test("buildValidationRecords runs the trust gate (no bypass at the funnel)", () => {
  // Mix one admittable row with three the gate must drop. If
  // buildValidationRecords ever stops calling filterConfirmedDoses,
  // this test fails — the gate would otherwise be a coincidental
  // filter for whatever reason isEngineEligible currently captures.
  const rows: ParsedCardRow[] = [
    row({
      antigen: "BCG",
      doseNumber: 1,
      doseKind: "birth",
      date: "2024-01-01",
      confidence: 0.95,
      source: "vision",
    }),
    // Template-inferred — the engine must NEVER see this even though
    // antigen + date + dose_number look complete.
    row({
      antigen: "MMR",
      doseNumber: 1,
      doseKind: "primary",
      date: "2025-01-01",
      confidence: 0.6,
      source: "template_inferred",
    }),
    // Vision but ambiguous — held back for review.
    row({
      antigen: "DTP",
      doseNumber: 2,
      doseKind: "primary",
      date: "2024-05-01",
      confidence: 0.6,
      source: "vision_low_confidence",
    }),
    // Vision-confident row aggregate, but per-field date is poor.
    row({
      antigen: "DTP",
      doseNumber: 3,
      doseKind: "primary",
      date: "2024-07-01",
      confidence: 0.95,
      source: "vision",
      fieldConfidences: { antigen: 0.95, date: 0.5 },
    }),
  ];
  const { records, indices } = buildValidationRecords(rows, "2024-01-01");
  // Exactly the BCG row passes both the trust gate AND
  // isEngineEligible.
  assert.equal(
    records.length,
    1,
    "trust gate must drop everything except the vision-confident BCG row",
  );
  assert.equal(records[0].antigen, "BCG");
  // The returned index points to the original row position.
  assert.deepEqual(indices, [0]);
});

test("buildValidationRecords gate runs BEFORE engine-eligibility", () => {
  // A row that is a template-inferred prediction for an
  // engine-covered antigen with valid date/dose still must be
  // dropped — the trust gate is a hard barrier independent of the
  // engine-eligibility check.
  const rows: ParsedCardRow[] = [
    row({
      antigen: "DTP",
      doseNumber: 1,
      doseKind: "primary",
      date: "2024-03-01",
      confidence: 0.99,
      source: "template_inferred",
    }),
  ];
  const { records } = buildValidationRecords(rows, "2024-01-01");
  assert.equal(records.length, 0);
});
