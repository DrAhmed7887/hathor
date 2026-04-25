/**
 * Trust gate for the TypeScript card-extraction path.
 *
 * Mirror of `filter_confirmed_doses` in
 * `api/src/hathor/safety/phase_d.py`. Both implementations are
 * exercised against the shared parity fixture
 * `cards/fixtures/synthetic_trust_gate_parity.json` — they MUST agree
 * on every case.
 *
 * INVARIANT
 *   No `ParsedCardRow` reaches reconciliation (the engine wire) unless
 *
 *     (source = vision AND row.confidence >= CONFIDENCE_THRESHOLD)
 *     OR
 *     (clinician_confirmed = true)
 *
 *   In the TS schema, "clinician_confirmed" is encoded by the HITL
 *   flow rewriting the row's `source` to "vision" and `confidence` to
 *   1.0 (mirroring the Python HITL merge in `_apply_corrections`). A
 *   row that remains at `source: "vision_low_confidence"`,
 *   `template_inferred`, or `predicted_from_schedule` is NEVER
 *   admitted.
 *
 * WHERE THIS RUNS
 *   `web/lib/validation.ts::buildValidationRecords` calls this gate
 *   at entry. `buildValidationRecords` is the single TS funnel from
 *   parsed rows to the engine wire (`/validate-schedule`), so any
 *   downstream surface that relies on engine-wire records is
 *   automatically gated. A test in `trust-gate.test.ts` asserts that
 *   `buildValidationRecords` runs the gate.
 *
 * PURITY
 *   Pure function. Does not mutate input. Idempotent.
 */

import type { ParsedCardRow } from "./types";

export const CONFIDENCE_THRESHOLD = 0.85;

export interface DroppedRow {
  /** Index into the input array. */
  rowIndex: number;
  /** Short human-readable reason. The substring is stable enough for
   * UI bucketing and parity-fixture matching. */
  reason: string;
}

export interface ConfirmedDoseFilterResult {
  /** Rows that cleared the gate, in original input order. */
  confirmed: ParsedCardRow[];
  /** Rows the clinician explicitly REJECTED — i.e. asserted the
   * visit definitively did not occur. Routed to a separate channel
   * (not dropped) because the reconciler needs to know "this dose
   * was not given" so catch-up scheduling can suppress it. The
   * engine never sees these; the reconciler does. Design note §6.5. */
  definitively_absent: ParsedCardRow[];
  /** Rows the gate refused. Never silently forwarded. */
  dropped: DroppedRow[];
  /** Original indices of confirmed rows, parallel to `confirmed`. Lets
   * callers re-join a gate run with non-row data without having to
   * search by reference. */
  confirmedIndices: number[];
}

/** Optional context passed to the trust gate. */
export interface TrustGateOptions {
  /** True when the parse output had an `orientation_warning` AND the
   * clinician has not yet acknowledged it. While true, the gate
   * drops every row with reason "orientation unconfirmed",
   * regardless of source/confidence. Design note §7.
   *
   * Defaults to `false` — callers without an orientation context
   * (existing tests, non-route callers) behave as before. */
  orientation_blocked?: boolean;
}

/** Apply the trust gate. See module docstring for the invariant.
 *
 * Order of checks (drop reason picks the FIRST failing check, so that
 * `expected_reason_substring` in the parity fixture is deterministic):
 *
 *   0. orientation_blocked — when true, every row drops with reason
 *      "orientation unconfirmed", before any other check.
 *   1. clinician_action — explicit decisions short-circuit the rest.
 *      "confirmed" or "edited" → admit (the audit log carries the
 *      vetted snapshot).
 *      "rejected" → routed to definitively_absent (NOT dropped —
 *      the reconciler needs the claim of absence). Reject schema
 *      requires a reason; assertClinicianAction enforces this at the
 *      wire boundary.
 *      "skipped" → drop with reason "clinician skipped".
 *   2. source must be "vision" or undefined (undefined defaults to
 *      "vision" — pre-source rows from earlier code paths).
 *   3. row.confidence >= threshold.
 *   4. row.date is non-null and non-empty.
 *   5. fieldConfidences (when present) for antigen and date must
 *      also clear the threshold.
 */
export function filterConfirmedDoses(
  rows: ParsedCardRow[],
  options: TrustGateOptions = {},
): ConfirmedDoseFilterResult {
  const confirmed: ParsedCardRow[] = [];
  const confirmedIndices: number[] = [];
  const definitively_absent: ParsedCardRow[] = [];
  const dropped: DroppedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Orientation block — applies to every row indiscriminately.
    if (options.orientation_blocked) {
      dropped.push({
        rowIndex: i,
        reason: "orientation unconfirmed",
      });
      continue;
    }

    const action = row.clinician_action ?? "none";

    // Clinician decisions short-circuit the source/confidence checks.
    if (action === "rejected") {
      definitively_absent.push(row);
      continue;
    }
    if (action === "skipped") {
      dropped.push({
        rowIndex: i,
        reason: "clinician skipped",
      });
      continue;
    }
    if (action === "confirmed" || action === "edited") {
      // Clinician took a positive action; admit even if the underlying
      // source was AMBER — the audit log carries the vetted snapshot.
      confirmed.push(row);
      confirmedIndices.push(i);
      continue;
    }

    // action === "none" — fall through to source/confidence checks.
    const source = row.source ?? "vision";

    if (source !== "vision") {
      dropped.push({
        rowIndex: i,
        reason: `source is "${source}", not vision`,
      });
      continue;
    }

    if (row.confidence < CONFIDENCE_THRESHOLD) {
      dropped.push({
        rowIndex: i,
        reason: `row confidence ${row.confidence.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`,
      });
      continue;
    }

    if (row.date === null || row.date === "") {
      dropped.push({
        rowIndex: i,
        reason: "date field missing",
      });
      continue;
    }

    if (row.fieldConfidences) {
      const fa = row.fieldConfidences.antigen;
      if (fa !== undefined && fa < CONFIDENCE_THRESHOLD) {
        dropped.push({
          rowIndex: i,
          reason: `antigen field confidence ${fa.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`,
        });
        continue;
      }
      const fd = row.fieldConfidences.date;
      if (fd !== undefined && fd < CONFIDENCE_THRESHOLD) {
        dropped.push({
          rowIndex: i,
          reason: `date field confidence ${fd.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`,
        });
        continue;
      }
    }

    confirmed.push(row);
    confirmedIndices.push(i);
  }

  return { confirmed, definitively_absent, dropped, confirmedIndices };
}
