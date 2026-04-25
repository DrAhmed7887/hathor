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
  /** PR 2: parity cases can specify a clinician action so both
   * implementations exercise the routing for skip/reject/confirm. */
  clinician_action?: ParsedCardRow["clinician_action"];
  clinician_reason?: string;
  row_confidence_field?: number;
  expected: "admit" | "drop" | "definitively_absent";
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
    clinician_action: c.clinician_action ?? "none",
    clinician_reason: c.clinician_reason ?? null,
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
    assert.equal(out.definitively_absent.length, 0);
  } else if (c.expected === "definitively_absent") {
    assert.equal(
      out.definitively_absent.length,
      1,
      `case "${c.id}" expected definitively_absent but TS routed elsewhere ` +
        `(confirmed=${out.confirmed.length} dropped=${out.dropped.length})`,
    );
    assert.equal(out.confirmed.length, 0);
    assert.equal(out.dropped.length, 0);
  } else {
    assert.equal(
      out.confirmed.length,
      0,
      `case "${c.id}" expected drop but TS admitted`,
    );
    assert.equal(out.definitively_absent.length, 0);
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

// ── PR 2: clinician action routing ──────────────────────────────────────────

test("filter: clinician confirmed admits even when underlying source is AMBER", () => {
  const r = row({
    confidence: 0.55,
    source: "vision_low_confidence",
    clinician_action: "confirmed",
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 1);
  assert.equal(out.dropped.length, 0);
  assert.equal(out.definitively_absent.length, 0);
});

test("filter: clinician edited admits with no source/confidence check", () => {
  const r = row({
    confidence: 0.4,
    source: "template_inferred",
    clinician_action: "edited",
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 1);
});

test("filter: clinician skipped is dropped with explicit reason", () => {
  const r = row({
    confidence: 0.95,
    source: "vision",
    clinician_action: "skipped",
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0].reason, /clinician skipped/i);
});

test("filter: clinician rejected routes to definitively_absent (NOT dropped)", () => {
  const r = row({
    confidence: 0.95,
    source: "vision",
    clinician_action: "rejected",
    clinician_reason: "Mother confirmed visit was missed.",
  });
  const out = filterConfirmedDoses([r]);
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.dropped.length, 0);
  assert.equal(out.definitively_absent.length, 1);
});

test("filter: definitively_absent and dropped are independent channels", () => {
  // Mix all four actions plus a vanilla vision row.
  const rows: ParsedCardRow[] = [
    row({ antigen: "BCG", date: "2024-01-01", clinician_action: "none" }),
    row({ antigen: "MMR", date: "2025-01-01", clinician_action: "confirmed" }),
    row({ antigen: "OPV", date: "2024-04-01", clinician_action: "skipped" }),
    row({
      antigen: "DTP",
      date: "2024-05-01",
      clinician_action: "rejected",
      clinician_reason: "Mother confirmed visit was missed.",
    }),
    row({ antigen: "HepB", date: "2024-01-01", clinician_action: "edited" }),
  ];
  const out = filterConfirmedDoses(rows);
  assert.equal(out.confirmed.length, 3, "BCG (none/confident) + MMR (confirmed) + HepB (edited)");
  assert.equal(out.dropped.length, 1, "OPV (skipped)");
  assert.equal(out.definitively_absent.length, 1, "DTP (rejected)");
});

// ── PR 2: orientation blocking ──────────────────────────────────────────────

test("filter: orientation_blocked drops every row indiscriminately", () => {
  const rows: ParsedCardRow[] = [
    row({ confidence: 0.99 }),
    row({ confidence: 0.99 }),
    row({ confidence: 0.5, source: "vision_low_confidence" }),
  ];
  const out = filterConfirmedDoses(rows, { orientation_blocked: true });
  assert.equal(out.confirmed.length, 0);
  assert.equal(out.definitively_absent.length, 0);
  assert.equal(out.dropped.length, 3);
  for (const d of out.dropped) {
    assert.match(d.reason, /orientation unconfirmed/i);
  }
});

test("buildValidationRecords blocks records when orientation unacknowledged", () => {
  const rows: ParsedCardRow[] = [
    row({
      antigen: "BCG",
      doseNumber: 1,
      doseKind: "birth",
      date: "2024-01-01",
      confidence: 0.99,
    }),
  ];
  // No orientation context → records build normally.
  const { records: ok } = buildValidationRecords(rows, "2024-01-01");
  assert.equal(ok.length, 1);
  // Orientation blocked → zero records, regardless of row state.
  const { records: blocked } = buildValidationRecords(rows, "2024-01-01", {
    orientation_blocked: true,
  });
  assert.equal(blocked.length, 0);
});

// ── PR 2: schema-enforced reject reason ─────────────────────────────────────

test("assertClinicianAction throws when reject lacks reason", async () => {
  const { assertClinicianAction } = await import("./types.ts");
  const r = row({ clinician_action: "rejected", clinician_reason: null });
  assert.throws(() => assertClinicianAction(r), /requires a non-empty/i);
});

test("assertClinicianAction throws when reject reason is whitespace-only", async () => {
  const { assertClinicianAction } = await import("./types.ts");
  const r = row({ clinician_action: "rejected", clinician_reason: "   " });
  assert.throws(() => assertClinicianAction(r), /requires a non-empty/i);
});

test("assertClinicianAction passes for non-reject actions with null reason", async () => {
  const { assertClinicianAction } = await import("./types.ts");
  for (const action of ["none", "confirmed", "edited", "skipped"] as const) {
    const r = row({ clinician_action: action, clinician_reason: null });
    assertClinicianAction(r); // must not throw
  }
});

test("assertAuditEntry throws when reject entry lacks reason", async () => {
  const { assertAuditEntry } = await import("./types.ts");
  const entry = {
    audit_entry_id: "a1",
    row_id: "r1",
    clinician_id: "demo-clinician",
    clinician_display_name: null,
    timestamp: "2026-04-25T10:00:00Z",
    action: "reject" as const,
    slot_state_at_action: "ambiguous" as const,
    predicted_value: {
      antigen: "DTP",
      date: "2024-05-01",
      dose_number: 1,
      dose_kind: "primary" as const,
      lot_number: null,
      source: "vision" as const,
      confidence: 0.95,
    },
    confirmed_value: null,
    reason: null,
    predicted_subkind: null,
  };
  assert.throws(() => assertAuditEntry(entry), /requires a non-empty/i);
});
