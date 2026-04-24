/**
 * Debug script for the synthetic vaccination-card fixture.
 *
 * Reads cards/fixtures/synthetic_egypt_handwritten.json and walks each
 * case through the parser + grouper, printing a diff against the
 * fixture's expected outputs. Use this when iterating on the parser
 * locally — CI gets the same coverage through the *.test.ts files.
 *
 * Run:
 *   npm run debug:synthetic
 *   or
 *   node --experimental-strip-types web/scripts/debug-synthetic-card.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseRawDate } from "../lib/document-intelligence.ts";
import { groupVisits } from "../lib/visit-grouping.ts";
import type { ParsedCardRow } from "../lib/types.ts";

interface ParserCase {
  id: string;
  raw_text: string;
  expected_iso: string | null;
  kind: "parse" | "reject";
  reason?: string;
  comment?: string;
}

interface GroupingRow {
  id: string;
  antigen: string;
  iso_date: string;
  source_evidence_fragment_id: string;
  comment?: string;
}

interface ExpectedGroup {
  iso_date: string;
  count: number;
  comment?: string;
}

interface Fixture {
  parser_cases: ParserCase[];
  grouping_case: {
    rows: GroupingRow[];
    expected_groups: ExpectedGroup[];
    expected_total_rows_after_dedup: number;
  };
}

const FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "cards",
  "fixtures",
  "synthetic_egypt_handwritten.json",
);

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function pad(label: string, width = 32): string {
  return label.length >= width ? label : label + " ".repeat(width - label.length);
}

let parserPass = 0;
let parserFail = 0;
console.log("── Parser cases ────────────────────────────────────────────");
for (const c of fixture.parser_cases) {
  const got = parseRawDate(c.raw_text);
  const ok = got === c.expected_iso;
  if (ok) parserPass++;
  else parserFail++;
  const verdict = ok ? "✓" : "✗";
  console.log(
    `  ${verdict} ${pad(c.id)} raw=${JSON.stringify(c.raw_text)}` +
      ` → ${got === null ? "null" : got}` +
      (ok ? "" : ` (expected ${c.expected_iso === null ? "null" : c.expected_iso})`),
  );
}

console.log("");
console.log("── Visit grouping ──────────────────────────────────────────");
const groupingRows: ParsedCardRow[] = fixture.grouping_case.rows.map((r) => ({
  antigen: r.antigen,
  date: r.iso_date,
  doseNumber: null,
  doseKind: "unknown",
  confidence: 0.95,
  imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
  source: "vision",
  sourceEvidenceFragmentId: r.source_evidence_fragment_id,
}));
const grouped = groupVisits(groupingRows);

let groupingFail = 0;
let groupingPass = 0;

if (grouped.dedupedRows.length === fixture.grouping_case.expected_total_rows_after_dedup) {
  groupingPass++;
  console.log(
    `  ✓ deduped rows = ${grouped.dedupedRows.length} (collapsed ${grouped.collapsedFragmentDuplicates})`,
  );
} else {
  groupingFail++;
  console.log(
    `  ✗ deduped rows = ${grouped.dedupedRows.length}, expected ` +
      `${fixture.grouping_case.expected_total_rows_after_dedup}`,
  );
}

const actualGroups = new Map<string, number>();
for (const g of grouped.groups) {
  if (g.isoDate) actualGroups.set(g.isoDate, g.count);
}
for (const expected of fixture.grouping_case.expected_groups) {
  const got = actualGroups.get(expected.iso_date);
  const ok = got === expected.count;
  if (ok) groupingPass++;
  else groupingFail++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${expected.iso_date} count=${got ?? "missing"}` +
      (ok ? "" : ` (expected ${expected.count})`),
  );
}

console.log("");
console.log("── Summary ────────────────────────────────────────────────");
console.log(`  parser:   ${parserPass} passed, ${parserFail} failed`);
console.log(`  grouping: ${groupingPass} passed, ${groupingFail} failed`);

if (parserFail > 0 || groupingFail > 0) {
  process.exit(1);
}
