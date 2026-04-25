/**
 * Tests for the per-spec merger that joins whole-image vision rows
 * with per-ROI re-reads on the Egyptian MoHP card.
 *
 * Pure function under test — no Anthropic, no sharp, no I/O. Each test
 * builds a tiny template + row fixture and asserts the merger's
 * decision. Mirrors the spec's required test matrix:
 *
 *   - Egypt MoHP recognized template triggers ROI extraction
 *   - Unknown template does not trigger ROI extraction
 *   - ROI fills missing blank rows
 *   - Existing confident whole-image row is preserved
 *   - ROI invalid/empty result does not degrade output
 *   - Error in ROI extraction falls back safely to existing behavior
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  EGYPT_MOHP_TEMPLATE_ID,
  mergeRoiIntoVisionRows,
  shouldRunEgyptMohpRoi,
} from "./roi-merge.ts";
import type { ParsedCardRow } from "./types.ts";
import type {
  TemplateRowSpec,
  VaccineCardTemplateJson,
} from "./templates/egypt-mohp.ts";

// ── Fixture builders ────────────────────────────────────────────────────────

function spec(
  i: number,
  antigen: string,
  doseNumber: number | null = i + 1,
): TemplateRowSpec {
  return {
    row_index: i,
    age_label: `${i} months`,
    primary_antigen: antigen,
    co_administered_antigens: [],
    dose_kind: "primary",
    dose_number: doseNumber,
    date_roi: { x: 0.5, y: 0.05 + i * 0.07, width: 0.2, height: 0.05 },
    antigen_roi: { x: 0.25, y: 0.05 + i * 0.07, width: 0.2, height: 0.05 },
  };
}

function fixtureTemplate(): VaccineCardTemplateJson {
  return {
    template_id: EGYPT_MOHP_TEMPLATE_ID,
    country: "EG",
    card_type: "child",
    version: "test-1",
    is_synthetic_derived: true,
    source_notes: "test fixture",
    coordinate_system: {
      kind: "normalized",
      x_range: [0, 1],
      y_range: [0, 1],
      origin: "top-left",
      reference_canvas: { width: 1600, height: 1050 },
    },
    row_specs: [
      spec(0, "BCG"),
      spec(1, "OPV"),
      spec(2, "DTP"),
    ],
  };
}

function visionRow(over: Partial<ParsedCardRow> & { antigen: string }): ParsedCardRow {
  return {
    date: "2024-01-01",
    doseNumber: 1,
    doseKind: "primary",
    confidence: 0.95,
    reasoningIfUncertain: null,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    source: "vision",
    ...over,
  };
}

function roiRow(
  templateSpecIdx: number,
  over: Partial<ParsedCardRow> & { antigen: string },
): ParsedCardRow {
  return {
    ...visionRow(over),
    template_spec_index: templateSpecIdx,
  };
}

// ── shouldRunEgyptMohpRoi ───────────────────────────────────────────────────

test("trigger: Egypt MoHP recognized template enables ROI extraction", () => {
  assert.equal(
    shouldRunEgyptMohpRoi("egypt_mohp_mandatory_childhood_immunization"),
    true,
  );
});

test("trigger: unknown template does not enable ROI extraction", () => {
  assert.equal(shouldRunEgyptMohpRoi("unknown_vaccine_card"), false);
});

test("trigger: WHO/ICVP template does not enable ROI extraction", () => {
  assert.equal(
    shouldRunEgyptMohpRoi("who_icvp_international_certificate"),
    false,
  );
});

test("trigger: null / undefined / empty does not enable ROI extraction", () => {
  assert.equal(shouldRunEgyptMohpRoi(null), false);
  assert.equal(shouldRunEgyptMohpRoi(undefined), false);
  assert.equal(shouldRunEgyptMohpRoi(""), false);
});

// ── mergeRoiIntoVisionRows ──────────────────────────────────────────────────

test("merge: confident, dated whole-image row is preserved unchanged", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({ antigen: "BCG", date: "2024-02-01", confidence: 0.93 }),
  ];
  const roi = [
    // ROI claims a different (more confident) date — must be ignored
    // because the whole-image row is already confident & dated.
    roiRow(0, { antigen: "BCG", date: "2024-99-99", confidence: 0.99 }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].date, "2024-02-01");
  assert.equal(out.rows[0].confidence, 0.93);
  assert.equal(out.rows[0].template_spec_index, 0);
  assert.equal(out.warnings.length, 0);
});

test("merge: ROI fills a slot the whole-image pass missed entirely", () => {
  const t = fixtureTemplate();
  const vision: ParsedCardRow[] = []; // whole-image returned nothing
  const roi = [
    roiRow(0, {
      antigen: "BCG",
      date: "2024-02-01",
      confidence: 0.91,
      source: "vision",
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].antigen, "BCG");
  assert.equal(out.rows[0].date, "2024-02-01");
  assert.equal(out.rows[0].template_spec_index, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /BCG.*added from ROI read/);
});

test("merge: low-confidence whole-image row gets its date upgraded by a more confident ROI read", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({
      antigen: "DTP",
      date: null,
      confidence: 0.55,
      source: "vision_low_confidence",
      reasoningIfUncertain: "year digit illegible",
    }),
  ];
  const roi = [
    roiRow(2, {
      antigen: "DTP",
      date: "2024-09-15",
      confidence: 0.92,
      source: "vision",
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  assert.equal(row.date, "2024-09-15");
  assert.equal(row.confidence, 0.92);
  assert.equal(row.template_spec_index, 2);
  assert.equal(row.fieldConfidences?.date, 0.92);
  assert.match(row.reasoningIfUncertain ?? "", /year digit illegible/);
  assert.match(row.reasoningIfUncertain ?? "", /per-cell ROI read/);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /DTP.*upgraded/);
});

test("merge: low-confidence whole-image row is NOT overwritten when ROI is also low confidence", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({
      antigen: "DTP",
      date: "2024-09-99",
      confidence: 0.55,
      source: "vision_low_confidence",
    }),
  ];
  const roi = [
    roiRow(2, {
      antigen: "DTP",
      date: "2024-09-15",
      // Below the 0.85 threshold — source must be "vision_low_confidence"
      // in real callers; merger keys off `source`, not just confidence.
      confidence: 0.5,
      source: "vision_low_confidence",
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].date, "2024-09-99"); // whole-image kept
  assert.equal(out.rows[0].confidence, 0.55);
  assert.equal(out.warnings.length, 0);
});

test("merge: ROI blank read does NOT overwrite a low-confidence whole-image row", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({
      antigen: "OPV",
      date: "2024-04-01",
      confidence: 0.7,
    }),
  ];
  const roi = [
    roiRow(1, {
      antigen: "OPV",
      date: null,
      confidence: 0.05,
      source: "vision_low_confidence",
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].date, "2024-04-01");
  assert.equal(out.rows[0].confidence, 0.7);
});

test("merge: empty ROI input never degrades whole-image rows", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({ antigen: "BCG", confidence: 0.95 }),
    visionRow({ antigen: "OPV", date: null, confidence: 0.4 }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: [], // ROI extraction returned nothing (or threw upstream)
  });

  // Confident BCG preserved; OPV preserved as-is for the existing
  // template-inference fallback to handle if it can.
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].antigen, "BCG");
  assert.equal(out.rows[0].date, "2024-01-01");
  assert.equal(out.rows[1].antigen, "OPV");
  assert.equal(out.rows[1].date, null);
});

test("merge: vision rows whose antigen has no template spec stay unclaimed and append at the end", () => {
  const t = fixtureTemplate(); // BCG, OPV, DTP
  const vision = [
    visionRow({ antigen: "BCG", date: "2024-01-01", confidence: 0.95 }),
    visionRow({ antigen: "Varicella", date: "2024-12-01", confidence: 0.9 }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: [],
  });

  assert.equal(out.rows.length, 2);
  // BCG is in template → claims spec 0
  assert.equal(out.rows[0].antigen, "BCG");
  assert.equal(out.rows[0].template_spec_index, 0);
  // Varicella is not in template → unclaimed, appended last, no spec idx
  assert.equal(out.rows[1].antigen, "Varicella");
  assert.equal(out.rows[1].template_spec_index, undefined);
});

test("merge: ROI tie at confidence does NOT overwrite the whole-image row (whole-image wins ties)", () => {
  const t = fixtureTemplate();
  const vision = [
    visionRow({
      antigen: "DTP",
      date: "2024-09-01",
      confidence: 0.7,
      source: "vision_low_confidence",
    }),
  ];
  const roi = [
    roiRow(2, {
      antigen: "DTP",
      date: "2024-09-15", // disagrees, but same confidence
      confidence: 0.7,
      source: "vision",
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.rows[0].date, "2024-09-01");
  assert.equal(out.rows[0].confidence, 0.7);
});

test("merge: booster row does NOT claim a primary slot of the same antigen", () => {
  // Egyptian MoHP card has separate slots: DTP primary 1/2/3 (rows 3-5)
  // and a DTP booster row ("جرعة منشطة"). Without dose_kind gating, the
  // greedy matcher would let a booster row claim primary-1 (masking a
  // missing primary). Asserts the gate works.
  const t: VaccineCardTemplateJson = {
    ...fixtureTemplate(),
    row_specs: [
      { ...spec(0, "DTP", 1), dose_kind: "primary" },
      { ...spec(1, "DTP", 2), dose_kind: "primary" },
      { ...spec(2, "DTP", null), dose_kind: "booster" },
    ],
  };

  const vision = [
    visionRow({
      antigen: "DTP",
      date: "2025-06-01",
      doseKind: "booster",
      doseNumber: null,
      confidence: 0.92,
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: [],
  });

  // The single DTP-booster vision row must end up at template_spec_index 2,
  // not at 0 or 1. Both primary slots stay empty (no row at those indices
  // means no DTP-primary in the merged output).
  const merged = out.rows.find((r) => r.template_spec_index === 2);
  assert.ok(merged, "booster row should claim the booster slot (idx 2)");
  assert.equal(merged?.doseKind, "booster");
  assert.equal(merged?.date, "2025-06-01");
  // The primary slots must NOT have been claimed by the booster row.
  assert.equal(
    out.rows.find((r) => r.template_spec_index === 0),
    undefined,
  );
  assert.equal(
    out.rows.find((r) => r.template_spec_index === 1),
    undefined,
  );
});

test("merge: primary row does NOT claim the booster slot of the same antigen", () => {
  // Symmetric guard: a primary-DTP row must not slip into the DTP-booster
  // slot just because it happens to be the only unclaimed DTP spec left.
  const t: VaccineCardTemplateJson = {
    ...fixtureTemplate(),
    row_specs: [
      { ...spec(0, "DTP", 1), dose_kind: "primary" },
      { ...spec(1, "DTP", null), dose_kind: "booster" },
    ],
  };

  // Two primary DTP rows. The first claims idx 0; the second has no
  // primary slot left and must NOT claim the booster slot.
  const vision = [
    visionRow({ antigen: "DTP", date: "2024-03-01", doseNumber: 1 }),
    visionRow({ antigen: "DTP", date: "2024-05-01", doseNumber: 2 }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: [],
  });

  const atZero = out.rows.find((r) => r.template_spec_index === 0);
  const atOne = out.rows.find((r) => r.template_spec_index === 1);
  assert.equal(atZero?.date, "2024-03-01");
  assert.equal(atOne, undefined);
  // The unclaimed primary row is appended at the end (off-template).
  const offTemplate = out.rows.filter((r) => r.template_spec_index == null);
  assert.equal(offTemplate.length, 1);
  assert.equal(offTemplate[0].date, "2024-05-01");
});

test("merge: unknown dose_kind is permitted into any slot (forgiveness)", () => {
  // A vision row whose dose_kind is "unknown" should still match a
  // typed slot — the gate only blocks KNOWN mismatches. This protects
  // model uncertainty cases from being silently dropped.
  const t: VaccineCardTemplateJson = {
    ...fixtureTemplate(),
    row_specs: [{ ...spec(0, "MMR", 1), dose_kind: "primary" }],
  };

  const vision = [
    visionRow({
      antigen: "MMR",
      date: "2025-01-15",
      doseKind: "unknown",
      confidence: 0.92,
    }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: [],
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].template_spec_index, 0);
});

test("merge: warnings are emitted in template_spec_index order (audit-trail readability)", () => {
  const t = fixtureTemplate();
  // Whole-image missed BCG (idx 0) and DTP (idx 2); ROI fills both.
  const vision = [
    visionRow({ antigen: "OPV", date: "2024-04-01", confidence: 0.95 }),
  ];
  const roi = [
    roiRow(0, { antigen: "BCG", date: "2024-01-01", confidence: 0.9 }),
    roiRow(2, { antigen: "DTP", date: "2024-09-01", confidence: 0.9 }),
  ];

  const out = mergeRoiIntoVisionRows({
    template: t,
    visionRows: vision,
    roiRows: roi,
  });

  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings[0], /Row 0/);
  assert.match(out.warnings[1], /Row 2/);
});
