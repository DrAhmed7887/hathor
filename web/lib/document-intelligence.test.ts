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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  mergeEvidenceIntoRows,
  normalizeDocumentIntelligence,
  parseRawDate,
  type DocumentRegion,
  type EvidenceFragment,
  type LayoutAnalysisResult,
} from "./document-intelligence.ts";
import type { ParsedCardRow } from "./types.ts";

const SYNTHETIC_FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "cards",
  "fixtures",
  "synthetic_egypt_handwritten.json",
);

interface ParserCase {
  id: string;
  raw_text: string;
  expected_iso: string | null;
  kind: "parse" | "reject";
  reason?: string;
  comment?: string;
}

interface SyntheticFixture {
  parser_cases: ParserCase[];
}

const syntheticFixture = JSON.parse(
  readFileSync(SYNTHETIC_FIXTURE_PATH, "utf8"),
) as SyntheticFixture;

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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
  };
  const out = mergeEvidenceIntoRows(layout, rows);
  assert.ok(out.warnings.some((w) => /Rotated 180/.test(w)));
  assert.ok(out.warnings.some((w) => /Right edge cut off/.test(w)));
  assert.ok(out.warnings.some((w) => /Low contrast/.test(w)));
});


test("normalizer: promotes model-supplied template_id when valid", () => {
  const out = normalizeDocumentIntelligence({
    recognized_template_id: "egypt_mohp_mandatory_childhood_immunization",
    document_type_guess: "egypt_mohp_mandatory_childhood_immunization",
    regions: [],
    evidence_fragments: [],
  });
  assert.equal(
    out.recognized_template_id,
    "egypt_mohp_mandatory_childhood_immunization",
  );
  assert.equal(
    out.document_type_guess,
    "egypt_mohp_mandatory_childhood_immunization",
  );
});


test("normalizer: default template_id when nothing recognised", () => {
  const out = normalizeDocumentIntelligence({});
  assert.equal(out.recognized_template_id, "unknown_vaccine_card");
  assert.equal(out.document_type_guess, "unknown_vaccine_card");
});

test("parseRawDate: Arabic digits DD/MM/YYYY", () => {
  assert.equal(parseRawDate("١٠/٠٥/٢٠٢٤"), "2024-05-10");
});
test("parseRawDate: Western DD/MM/YYYY and DD-MM-YYYY", () => {
  assert.equal(parseRawDate("05/05/2023"), "2023-05-05");
  assert.equal(parseRawDate("05-05-2023"), "2023-05-05");
});
test("parseRawDate: ISO already", () => {
  assert.equal(parseRawDate("2024-05-10"), "2024-05-10");
});
test("parseRawDate: rejects ambiguous/unrecognised text", () => {
  assert.equal(parseRawDate("May 10, 2024"), null);
  assert.equal(parseRawDate(null), null);
  assert.equal(parseRawDate(undefined), null);
});

test("parseRawDate: 'DD Mmm YYYY' English-month form (Nigerian-style card)", () => {
  // The synthetic Amina Bello card (cards/synthetic-amina-bello-nigeria-
  // handwritten.jpg) uses "10 Jan 2025"-style dates throughout. The
  // parser must round-trip both 3-letter and full English month names,
  // case-insensitively, with single- or double-digit days.
  assert.equal(parseRawDate("10 Jan 2025"), "2025-01-10");
  assert.equal(parseRawDate("21 Feb 2025"), "2025-02-21");
  assert.equal(parseRawDate("21 Mar 2025"), "2025-03-21");
  assert.equal(parseRawDate("18 Apr 2025"), "2025-04-18");
  assert.equal(parseRawDate("10 Oct 2025"), "2025-10-10");
  assert.equal(parseRawDate("9 May 2024"), "2024-05-09");
  assert.equal(parseRawDate("10 January 2025"), "2025-01-10");
  assert.equal(parseRawDate("1 September 2025"), "2025-09-01");
  assert.equal(parseRawDate("1 Sept 2025"), "2025-09-01");
  // Case-insensitive month name.
  assert.equal(parseRawDate("10 JAN 2025"), "2025-01-10");
  assert.equal(parseRawDate("10 january 2025"), "2025-01-10");
});

test("parseRawDate: 'Mmm DD, YYYY' English-month form is NOT supported (US-style)", () => {
  // We deliberately keep US-style month-first parsing OFF — adding it
  // would conflict with DD/MM/YYYY in cards where the month and day
  // are both ≤ 12. Cards that need month-first should be handled at
  // the card-template layer, not the date parser.
  assert.equal(parseRawDate("May 10, 2024"), null);
  assert.equal(parseRawDate("Jan 10 2025"), null);
});

test("parseRawDate: rejects unknown month name in 'DD Mmm YYYY' shape", () => {
  // The shape is regexp-correct but the month name is gibberish — the
  // parser must return null rather than throwing or guessing.
  assert.equal(parseRawDate("10 Foo 2025"), null);
  assert.equal(parseRawDate("10 Decmber 2025"), null);
});

// Drive every synthetic_egypt_handwritten case through the parser. The
// Python parity test (api/tests/test_date_parser.py) walks the same
// JSON, so the two implementations stay aligned by construction.
for (const c of syntheticFixture.parser_cases) {
  test(`parseRawDate (synthetic fixture): ${c.id}`, () => {
    assert.equal(parseRawDate(c.raw_text), c.expected_iso);
  });
}

test("parseRawDate (negative): does not throw on hostile inputs", () => {
  // Anything weird should resolve to null without raising. The parser
  // is on a hot path during card review — a thrown error would crash
  // the page.
  const hostile: unknown[] = [
    "",
    "   ",
    "21/?/2023",                        // underdetermined
    "abc",                              // bare text
    "{}",                               // junk
    "21//2023",                         // missing field
    "21..2023",                         // missing field with separators
    "0123456",                          // bare digit run
    "2023",                             // year-only
    "2023-13-01",                       // bad month
    "2023-02-30",                       // impossible day
    "32/01/2023",                       // bad day
    "9/3/24/extra",                     // trailing junk
    "9/3/2024 extra",                   // trailing junk
    null,
    undefined,
    {},
    [],
    42,
  ];
  for (const h of hostile) {
    assert.doesNotThrow(() => parseRawDate(h as string | null | undefined));
    assert.equal(parseRawDate(h as string | null | undefined), null);
  }
});

test("parseRawDate (negative): bare digit runs never become dates", () => {
  // A vision pass might OCR something like "0123456" off a numeric
  // field that is not a date (lot number, batch id, child ID). The
  // parser must not coerce that into a date.
  for (const s of ["0123456", "1234567", "20230318", "230318", "2305"]) {
    assert.equal(parseRawDate(s), null, `bare digit run ${s} must reject`);
  }
});

test("parseRawDate: pediatric two-digit year window — 23 → 2023, not 1923", () => {
  // Load-bearing rule from the fixture's `two-digit-year-pediatric-window`
  // case. Asserted directly here so a rationale change is loud.
  assert.equal(parseRawDate("20/07/23"), "2023-07-20");
  // A date that COULD plausibly mean 1923 is still reachable in
  // practice only via two-digit years; the parser maps to 2099 max
  // (which then fails the plausibility window anyway, returning null).
  // We assert it does not silently keep an old century.
  const old = parseRawDate("01/01/30"); // 30 → 2030 today, would later flip
  assert.notEqual(old, "1930-01-01");
});

