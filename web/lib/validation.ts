/**
 * Pure helpers that bridge ParsedResults (clinician-reviewed rows) to
 * the /validate-schedule request body.
 *
 * Extracted from web/app/demo/page.tsx so the booster-dose logic can be
 * exercised without mounting a React tree.
 *
 * Contract in one sentence: take rows the clinician just reviewed, emit
 * engine-eligible ValidateScheduleRecord entries — primary AND booster —
 * without silently dropping boosters the way the previous filter did.
 */

import type {
  DoseKind,
  ParsedCardRow,
  ValidateScheduleRecord,
} from "./types";
import { filterConfirmedDoses } from "./trust-gate.ts";

/** Antigens the engine carries valid INTERVAL_RULES for today (PRD §8.2).
 * Rows outside this set are shown in parse + letter but not sent to
 * /validate-schedule — the engine's fallback interval would mislead. */
export const ENGINE_COVERED_ANTIGENS: ReadonlySet<string> = new Set([
  "BCG",
  "HepB",
  "OPV",
  "bOPV",
  "IPV",
  "DTP",
  "DTaP",
  "DPT",
  "Hib",
  "PCV",
  "Rotavirus",
  "MMR",
  "Measles",
]);

export function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((da - db) / 86_400_000);
}

/** A row is engine-eligible when:
 *   - the antigen is in ENGINE_COVERED_ANTIGENS, and
 *   - it has a date the engine can compare to DOB, and
 *   - it has EITHER a numbered primary position OR an explicit booster
 *     label (doseKind === "booster").
 *
 * The booster allowance is the core of the fix Ahmed flagged: rows
 * labeled as boosters on the card previously carried doseNumber=null
 * and were filtered out, so the engine never saw them. Boosters now
 * pass through with dose_kind="booster" and the engine validates by
 * antigen + age + interval.
 *
 * Birth doses (BCG / HepB at birth) carry doseKind="birth" and a
 * doseNumber of 1 — the engine sees them as dose 1, so they stay
 * eligible under the doseNumber !== null branch.
 */
export function isEngineEligible(row: ParsedCardRow): boolean {
  if (!ENGINE_COVERED_ANTIGENS.has(row.antigen)) return false;
  if (row.date === null || row.date === "") return false;
  if (row.doseNumber !== null) return true;
  if (row.doseKind === "booster") return true;
  return false;
}

/** Map a row's doseKind to the engine-wire string. "unknown" in the UI
 * becomes "primary" server-side so legacy engine rules still apply.
 * Boosters and birth doses travel as their own kinds. */
export function wireDoseKind(kind: DoseKind): DoseKind {
  if (kind === "unknown") return "primary";
  return kind;
}

/** For each engine-eligible row, compute prior_dose_age_days against
 * the previous dose of the same antigen in chronological order.
 *
 * TRUST GATE: this function runs `filterConfirmedDoses` (web/lib/
 * trust-gate.ts) FIRST. Only rows that are vision-confident or
 * clinician-confirmed reach the engine wire. Template-inferred and
 * ambiguous rows are dropped here — they remain visible in the UI
 * for clinician review but never silently drive reconciliation. The
 * gate is enforced; the test
 * `trust-gate.test.ts::"buildValidationRecords runs the trust gate"`
 * asserts this can never be bypassed at the funnel.
 *
 * Returned `indices` reference the ORIGINAL input array, so callers
 * can correlate engine output back to the displayed rows. */
export function buildValidationRecords(
  rows: ParsedCardRow[],
  childDob: string,
): { records: ValidateScheduleRecord[]; indices: number[] } {
  const gated = filterConfirmedDoses(rows);
  const eligibleIndices = gated.confirmed
    .map((r, idx) => ({ r, i: gated.confirmedIndices[idx] }))
    .filter((x) => isEngineEligible(x.r));

  // Group by antigen, sort by date ascending.
  const byAntigen = new Map<string, { r: ParsedCardRow; i: number }[]>();
  for (const x of eligibleIndices) {
    const key = x.r.antigen;
    const list = byAntigen.get(key) ?? [];
    list.push(x);
    byAntigen.set(key, list);
  }
  for (const list of byAntigen.values()) {
    list.sort((a, b) => (a.r.date! < b.r.date! ? -1 : 1));
  }

  // Walk each group; compute prior_dose_age_days from the previous
  // same-antigen dose. Preserves original row indices for re-joining.
  const priorByOriginalIndex = new Map<number, number | null>();
  for (const list of byAntigen.values()) {
    let priorAge: number | null = null;
    for (const { r, i } of list) {
      const age = daysBetween(r.date!, childDob);
      priorByOriginalIndex.set(i, priorAge);
      priorAge = age;
    }
  }

  const records: ValidateScheduleRecord[] = [];
  const indices: number[] = [];
  for (const { r, i } of eligibleIndices) {
    records.push({
      antigen: r.antigen,
      date: r.date!,
      dose_number: r.doseNumber,
      dose_kind: wireDoseKind(r.doseKind),
      prior_dose_age_days: priorByOriginalIndex.get(i) ?? null,
    });
    indices.push(i);
  }

  return { records, indices };
}

/** Stable signature for a validation payload — used to re-key
 * ScheduleView so it remounts and re-auto-runs the engine call when
 * the clinician edits a row and re-submits. Pure: same input → same
 * string, independent of object identity. */
export function rowsSignature(
  records: ValidateScheduleRecord[],
  childDob: string,
): string {
  return (
    records
      .map(
        (r) =>
          `${r.antigen}|${r.date}|${r.dose_number ?? "n"}|${r.dose_kind ?? "primary"}|${r.prior_dose_age_days ?? "n"}`,
      )
      .join("·") +
    "|" +
    childDob
  );
}

/** Display label for a row's dose position. Booster rows render as
 * "Booster" rather than blank / null, matching the card's own label. */
export function displayDoseLabel(row: ParsedCardRow): string {
  if (row.doseKind === "booster") {
    return row.doseNumber !== null
      ? `Booster · dose ${row.doseNumber}`
      : "Booster";
  }
  if (row.doseKind === "birth") {
    return row.doseNumber !== null ? `Birth dose ${row.doseNumber}` : "Birth dose";
  }
  if (row.doseNumber !== null) return `Dose ${row.doseNumber}`;
  return "—";
}
