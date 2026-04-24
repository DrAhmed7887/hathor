/**
 * Visit grouping for parsed vaccination card rows.
 *
 * Two related but distinct jobs:
 *
 *   1. Collapse rows that came from the **same OCR evidence fragment**.
 *      A single source line read twice by two preprocessing variants is
 *      one event, not two.
 *
 *   2. Group the remaining rows by visit date so the UI can render
 *      "21 Mar 2023 — 2 doses recorded" instead of a numbered dump.
 *      Same-date rows from **different** fragments are medically
 *      meaningful (multiple antigens given on one visit) and must be
 *      preserved.
 *
 * The rules engine never sees the grouped view — it always sees the
 * row-level events. Grouping is a presentation concern.
 */
import type { ParsedCardRow } from "./types";

export interface VisitGroup {
  /** ISO YYYY-MM-DD; null only if every row in the group has a null
   * date (the UI buckets those under "needs review"). */
  isoDate: string | null;
  /** Distinct rows on this date. Same-date rows from different
   * evidence fragments stay distinct here. */
  rows: ParsedCardRow[];
  /** Number of distinct dose events on this visit. */
  count: number;
  /** Mixed sources collapse to "mixed". Single-source visits report
   * the source verbatim so the UI can colour-bucket them. */
  source: ParsedCardRow["source"] | "mixed" | undefined;
  /** True when at least one row in the group needs clinician
   * confirmation (any non-"vision" source, or any null date). */
  needsReview: boolean;
}

export interface GroupedVisits {
  /** Rows after fragment-level dedup, before grouping. The exporter
   * uses this list when it needs the row-level form. */
  dedupedRows: ParsedCardRow[];
  /** Visits sorted ascending by date; null-date visits sink to the end. */
  groups: VisitGroup[];
  /** How many input rows were collapsed because they shared a
   * sourceEvidenceFragmentId with an earlier row. Surfaced for the
   * audit trail. */
  collapsedFragmentDuplicates: number;
}

/**
 * Collapse OCR duplicates that share a sourceEvidenceFragmentId.
 *
 * Rows without a fragment id are treated as already-distinct and pass
 * through unchanged — we never merge two anonymous rows just because
 * they happen to look alike, because that is exactly the
 * medically-meaningful case the spec calls out (two doses given on the
 * same visit).
 *
 * When two rows share a fragment id, the survivor is the one with the
 * higher confidence (ties go to the first). The duplicate is dropped;
 * its row count is reflected in the result's collapsed counter.
 */
export function dedupeFragmentDuplicates(
  rows: ParsedCardRow[],
): { rows: ParsedCardRow[]; collapsed: number } {
  const seen = new Map<string, number>(); // fragment id → index in survivors
  const survivors: ParsedCardRow[] = [];
  let collapsed = 0;

  for (const row of rows) {
    const fragId = row.sourceEvidenceFragmentId;
    if (!fragId) {
      survivors.push(row);
      continue;
    }
    const existingIdx = seen.get(fragId);
    if (existingIdx === undefined) {
      seen.set(fragId, survivors.length);
      survivors.push(row);
      continue;
    }
    collapsed++;
    const existing = survivors[existingIdx];
    if (row.confidence > existing.confidence) {
      survivors[existingIdx] = row;
    }
  }

  return { rows: survivors, collapsed };
}

function aggregateSource(
  rows: ParsedCardRow[],
): ParsedCardRow["source"] | "mixed" | undefined {
  const sources = new Set<ParsedCardRow["source"] | undefined>();
  for (const r of rows) sources.add(r.source);
  if (sources.size === 0) return undefined;
  if (sources.size === 1) return [...sources][0];
  return "mixed";
}

/**
 * Group rows by ISO date after collapsing fragment duplicates.
 * `null`-date rows are bucketed together at the end of the result.
 */
export function groupVisits(rows: ParsedCardRow[]): GroupedVisits {
  const { rows: deduped, collapsed } = dedupeFragmentDuplicates(rows);

  const byDate = new Map<string, ParsedCardRow[]>();
  const nulls: ParsedCardRow[] = [];
  for (const row of deduped) {
    if (row.date === null) {
      nulls.push(row);
      continue;
    }
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }

  const dated = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map<VisitGroup>(([isoDate, groupRows]) => ({
      isoDate,
      rows: groupRows,
      count: groupRows.length,
      source: aggregateSource(groupRows),
      needsReview: groupRows.some(
        (r) =>
          r.source !== undefined &&
          r.source !== "vision",
      ),
    }));

  const nullGroup: VisitGroup[] = nulls.length === 0
    ? []
    : [{
        isoDate: null,
        rows: nulls,
        count: nulls.length,
        source: aggregateSource(nulls),
        needsReview: true,
      }];

  return {
    dedupedRows: deduped,
    groups: [...dated, ...nullGroup],
    collapsedFragmentDuplicates: collapsed,
  };
}

/**
 * Format a visit group's date for display.
 * Returns a long-form English label like "21 Mar 2023" or
 * "Date needs review" for null-date groups.
 */
export function formatVisitDate(group: VisitGroup): string {
  if (group.isoDate === null) return "Date needs review";
  // Date constructor is fine — buildIso (in document-intelligence) has
  // already validated plausibility.
  const [y, m, d] = group.isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${d} ${month} ${y}`;
}
