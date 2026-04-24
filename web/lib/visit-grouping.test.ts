import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dedupeFragmentDuplicates, formatVisitDate, groupVisits } from "./visit-grouping.ts";
import type { ParsedCardRow } from "./types.ts";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "cards",
  "fixtures",
  "synthetic_egypt_handwritten.json",
);

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
}

interface Fixture {
  grouping_case: {
    rows: GroupingRow[];
    expected_groups: ExpectedGroup[];
    expected_total_rows_after_dedup: number;
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

function row(partial: Partial<ParsedCardRow>): ParsedCardRow {
  return {
    antigen: "DTP",
    date: "2024-01-01",
    doseNumber: null,
    doseKind: "unknown",
    confidence: 0.95,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    source: "vision",
    ...partial,
  };
}

function rowsFromFixture(): ParsedCardRow[] {
  return fixture.grouping_case.rows.map((r) =>
    row({
      antigen: r.antigen,
      date: r.iso_date,
      sourceEvidenceFragmentId: r.source_evidence_fragment_id,
    }),
  );
}

test("dedupe: rows without a fragment id pass through unchanged", () => {
  const input = [
    row({ date: "2024-03-21", antigen: "DTP" }),
    row({ date: "2024-03-21", antigen: "OPV" }),
  ];
  const result = dedupeFragmentDuplicates(input);
  assert.equal(result.collapsed, 0);
  assert.equal(result.rows.length, 2);
});

test("dedupe: two rows with the same fragment id collapse to one", () => {
  const input = [
    row({ sourceEvidenceFragmentId: "frag-A", confidence: 0.6 }),
    row({ sourceEvidenceFragmentId: "frag-A", confidence: 0.9 }),
  ];
  const result = dedupeFragmentDuplicates(input);
  assert.equal(result.collapsed, 1);
  assert.equal(result.rows.length, 1);
  // Higher-confidence row wins.
  assert.equal(result.rows[0].confidence, 0.9);
});

test("dedupe: rows with different fragment ids are preserved", () => {
  const input = [
    row({ sourceEvidenceFragmentId: "frag-A" }),
    row({ sourceEvidenceFragmentId: "frag-B" }),
  ];
  const result = dedupeFragmentDuplicates(input);
  assert.equal(result.collapsed, 0);
  assert.equal(result.rows.length, 2);
});

test("group: medically distinct same-date rows are preserved", () => {
  // The fixture's clinical case: two rows on 2023-03-21 from
  // different fragments must NOT collapse.
  const input = [
    row({
      date: "2023-03-21",
      antigen: "DTP",
      sourceEvidenceFragmentId: "frag-A",
    }),
    row({
      date: "2023-03-21",
      antigen: "OPV",
      sourceEvidenceFragmentId: "frag-B",
    }),
  ];
  const grouped = groupVisits(input);
  assert.equal(grouped.groups.length, 1);
  assert.equal(grouped.groups[0].count, 2);
  assert.equal(grouped.groups[0].isoDate, "2023-03-21");
});

test("group: synthetic fixture grouping case round-trips", () => {
  const grouped = groupVisits(rowsFromFixture());

  assert.equal(
    grouped.dedupedRows.length,
    fixture.grouping_case.expected_total_rows_after_dedup,
  );

  const seen = new Map<string, number>();
  for (const g of grouped.groups) {
    if (g.isoDate) seen.set(g.isoDate, g.count);
  }
  for (const expected of fixture.grouping_case.expected_groups) {
    assert.equal(
      seen.get(expected.iso_date),
      expected.count,
      `expected ${expected.count} dose(s) on ${expected.iso_date}`,
    );
  }
});

test("group: sorts visits ascending by date", () => {
  const input = [
    row({ date: "2024-09-19", sourceEvidenceFragmentId: "frag-1" }),
    row({ date: "2023-03-18", sourceEvidenceFragmentId: "frag-2" }),
    row({ date: "2024-03-18", sourceEvidenceFragmentId: "frag-3" }),
  ];
  const grouped = groupVisits(input);
  assert.deepEqual(
    grouped.groups.map((g) => g.isoDate),
    ["2023-03-18", "2024-03-18", "2024-09-19"],
  );
});

test("group: null-date rows sink to the end and are flagged needsReview", () => {
  const input = [
    row({ date: "2024-03-18", sourceEvidenceFragmentId: "frag-1" }),
    row({ date: null, sourceEvidenceFragmentId: "frag-2" }),
  ];
  const grouped = groupVisits(input);
  const last = grouped.groups[grouped.groups.length - 1];
  assert.equal(last.isoDate, null);
  assert.equal(last.needsReview, true);
});

test("group: low-confidence and template_inferred groups are needsReview=true", () => {
  const grouped = groupVisits([
    row({
      date: "2024-03-18",
      source: "vision_low_confidence",
      sourceEvidenceFragmentId: "frag-1",
    }),
    row({
      date: "2024-04-18",
      source: "template_inferred",
      sourceEvidenceFragmentId: "frag-2",
    }),
    row({
      date: "2024-05-18",
      source: "vision",
      sourceEvidenceFragmentId: "frag-3",
    }),
  ]);
  const byDate = Object.fromEntries(
    grouped.groups.map((g) => [g.isoDate, g.needsReview]),
  );
  assert.equal(byDate["2024-03-18"], true);
  assert.equal(byDate["2024-04-18"], true);
  assert.equal(byDate["2024-05-18"], false);
});

test("formatVisitDate: ISO date renders as long-form English", () => {
  const grouped = groupVisits([row({ date: "2023-03-21" })]);
  assert.equal(formatVisitDate(grouped.groups[0]), "21 Mar 2023");
});

test("formatVisitDate: null date renders as 'Date needs review'", () => {
  const grouped = groupVisits([row({ date: null })]);
  assert.equal(formatVisitDate(grouped.groups[0]), "Date needs review");
});
