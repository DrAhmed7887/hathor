/**
 * Node-native test suite for the pure TS helpers that bridge parsed
 * card rows to the /validate-schedule wire.
 *
 * Run:
 *   node --experimental-strip-types --test web/lib/validation.test.ts
 *   node --experimental-strip-types --test web/lib/*.test.ts
 *
 * No test framework / new dependency required — Node 25 strips TS
 * annotations natively and `node:test` is built in.
 *
 * Covers these acceptance criteria from Ahmed's spec:
 *   1. Booster rows are included in validation records.
 *   2. Booster rows are displayed as Booster in UI mapping.
 *   5. Arabic numeral confusion (٣ vs ١) is explicit in the prompt.
 *   6. Dose number follows printed row label, not fill order.
 *   8. Re-parse does not double-trigger the schedule engine
 *      (proxied by rowsSignature stability + documented phaseEReady gate).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildValidationRecords,
  displayDoseLabel,
  isEngineEligible,
  rowsSignature,
} from "./validation.ts";
import type { ParsedCardRow } from "./types.ts";
import { CARD_EXTRACTION_SYSTEM_PROMPT } from "./card-extraction-prompt.ts";

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

// ── Booster handling in buildValidationRecords ──────────────────────────────

test("booster rows with null dose_number are engine-eligible", () => {
  const booster = row({
    doseNumber: null,
    doseKind: "booster",
    date: "2026-04-01",
  });
  assert.equal(isEngineEligible(booster), true);
});

test("primary rows with null dose_number are NOT engine-eligible", () => {
  // If the vision pass could not read the dose number AND the card did
  // not mark it as a booster, the row stays in the review UI — the
  // engine would have nothing to validate against.
  const unreadable = row({ doseNumber: null, doseKind: "unknown" });
  assert.equal(isEngineEligible(unreadable), false);
});

test("buildValidationRecords emits booster rows with dose_kind='booster'", () => {
  const rows: ParsedCardRow[] = [
    row({ antigen: "DTP", date: "2024-12-12", doseNumber: 1 }),
    row({ antigen: "DTP", date: "2025-02-09", doseNumber: 2 }),
    row({ antigen: "DTP", date: "2025-04-08", doseNumber: 3 }),
    row({
      antigen: "DTP",
      date: "2026-04-08",
      doseNumber: null,
      doseKind: "booster",
    }),
  ];
  const { records, indices } = buildValidationRecords(rows, "2024-10-01");

  assert.equal(records.length, 4, "booster must not be filtered out");
  assert.equal(indices.length, 4);

  const booster = records.find((r) => r.dose_kind === "booster");
  assert.ok(booster, "booster row present in engine records");
  assert.equal(booster.dose_number, null);
  assert.equal(booster.date, "2026-04-08");
  // Booster's prior_dose_age_days should be dose 3's age — the grouping
  // preserves chronological order within the antigen.
  assert.ok(booster.prior_dose_age_days !== null);
  assert.ok(
    booster.prior_dose_age_days > 150,
    `expected booster prior_dose_age_days ~189, got ${booster.prior_dose_age_days}`,
  );
});

test("buildValidationRecords keeps primary series numbering when a booster is present", () => {
  // Acceptance criterion: DTP-containing rows do not come out as dose 1
  // + dose 2 if the printed card labels indicate dose 3 + booster.
  // We pass the labels in as the vision pass should have produced them.
  const rows: ParsedCardRow[] = [
    row({ antigen: "DTP", date: "2025-04-08", doseNumber: 3 }),
    row({
      antigen: "DTP",
      date: "2026-04-08",
      doseNumber: null,
      doseKind: "booster",
    }),
  ];
  const { records } = buildValidationRecords(rows, "2024-10-01");
  assert.equal(records.length, 2);
  assert.equal(records[0].dose_number, 3);
  assert.equal(records[0].dose_kind, "primary");
  assert.equal(records[1].dose_number, null);
  assert.equal(records[1].dose_kind, "booster");
});

// ── UI display mapping ──────────────────────────────────────────────────────

test("displayDoseLabel surfaces 'Booster' for booster rows", () => {
  assert.equal(
    displayDoseLabel(row({ doseNumber: null, doseKind: "booster" })),
    "Booster",
  );
  assert.equal(
    displayDoseLabel(row({ doseNumber: 4, doseKind: "booster" })),
    "Booster · dose 4",
  );
});

test("displayDoseLabel surfaces 'Birth dose' for birth rows", () => {
  assert.equal(
    displayDoseLabel(row({ doseNumber: null, doseKind: "birth" })),
    "Birth dose",
  );
});

test("displayDoseLabel returns 'Dose N' for primary rows", () => {
  assert.equal(
    displayDoseLabel(row({ doseNumber: 2, doseKind: "primary" })),
    "Dose 2",
  );
});

// ── rowsSignature stability (re-parse double-trigger guard) ─────────────────

test("rowsSignature is stable across identical inputs → no spurious remount", () => {
  const records = [
    { antigen: "DTP", date: "2025-04-08", dose_number: 3, dose_kind: "primary" as const, prior_dose_age_days: 189 },
    { antigen: "DTP", date: "2026-04-08", dose_number: null, dose_kind: "booster" as const, prior_dose_age_days: 554 },
  ];
  const a = rowsSignature(records, "2024-10-01");
  const b = rowsSignature(records.map(r => ({ ...r })), "2024-10-01");
  assert.equal(a, b, "Re-rendering with the same payload must produce the same key");
});

test("rowsSignature changes when dose_kind changes", () => {
  const a = rowsSignature(
    [{ antigen: "DTP", date: "2026-04-08", dose_number: null, dose_kind: "booster", prior_dose_age_days: 554 }],
    "2024-10-01",
  );
  const b = rowsSignature(
    [{ antigen: "DTP", date: "2026-04-08", dose_number: null, dose_kind: "primary", prior_dose_age_days: 554 }],
    "2024-10-01",
  );
  assert.notEqual(a, b, "Booster vs primary must surface as distinct payloads");
});

// ── Prompt-snapshot regressions (Arabic digits + row-label rule) ────────────

test("prompt still instructs the model to use printed row labels, not fill order", () => {
  // Bug 4 from commit bcdf3d8 — the model was inferring dose_number
  // from fill order. The fix is a prompt rule. If the rule gets
  // refactored away by accident, this test fires. Phrasing has been
  // refactored once (template-anchored → general); the regression
  // guard is "READ THE [...] LABEL and use [it] as dose_number"
  // plus the explicit prohibition on counting filled rows.
  assert.match(
    CARD_EXTRACTION_SYSTEM_PROMPT,
    /READ THE [A-Z ]*LABEL/i,
  );
  assert.match(
    CARD_EXTRACTION_SYSTEM_PROMPT,
    /(do NOT infer dose_number\s*by counting filled rows|Do NOT infer dose_number[\s\S]*by counting filled rows)/i,
  );
});

test("prompt still carries the Arabic numeral confusion rule (٣ vs ١)", () => {
  // Bug 5 from commit bcdf3d8 — Sofia's card misread year 2023 as 2021
  // because ٣ and ١ share a vertical stroke. The rule keeps the model
  // calibrated. Regression-protect the literal digits.
  assert.match(CARD_EXTRACTION_SYSTEM_PROMPT, /٣/);
  assert.match(CARD_EXTRACTION_SYSTEM_PROMPT, /١/);
  assert.match(
    CARD_EXTRACTION_SYSTEM_PROMPT,
    /biological[\s-]+plausibility/i,
  );
});

test("prompt instructs the model to emit dose_kind for every row", () => {
  assert.match(CARD_EXTRACTION_SYSTEM_PROMPT, /dose_kind:/);
  assert.match(CARD_EXTRACTION_SYSTEM_PROMPT, /"booster"/);
  assert.match(CARD_EXTRACTION_SYSTEM_PROMPT, /"birth"/);
});
