/**
 * Tests for the Egyptian MoHP template loader and validator.
 *
 * The loader runs once at module load and caches; the validator
 * is exposed separately and tested with malformed payloads here
 * so we never touch the canonical JSON on disk during test runs.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  loadEgyptMohpTemplate,
  resetTemplateCache,
  validateTemplate,
  type VaccineCardTemplateJson,
} from "./egypt-mohp.ts";

// ── Loader: real canonical JSON on disk ─────────────────────────────────────

test("loader: parses the canonical template JSON committed at data/templates/", () => {
  resetTemplateCache();
  const t = loadEgyptMohpTemplate();
  assert.equal(t.template_id, "egypt_mohp_mandatory_childhood_immunization");
  assert.equal(t.country, "EG");
  assert.equal(t.is_synthetic_derived, true);
  assert.equal(t.coordinate_system.reference_canvas.width, 1600);
  assert.equal(t.coordinate_system.reference_canvas.height, 1050);
  assert.equal(t.row_specs.length, 9);
});

test("loader: row_specs cover the nine canonical Egyptian age points", () => {
  resetTemplateCache();
  const t = loadEgyptMohpTemplate();
  const expectedAntigens = [
    "HepB", // 0 birth
    "OPV", // 1 first week
    "BCG", // 2 first 15 days
    "DTP", // 3 2 months
    "DTP", // 4 4 months
    "DTP", // 5 6 months
    "OPV", // 6 9 months
    "MMR", // 7 12 months
    "DTP", // 8 18 months
  ];
  for (let i = 0; i < t.row_specs.length; i++) {
    assert.equal(t.row_specs[i].row_index, i);
    assert.equal(t.row_specs[i].primary_antigen, expectedAntigens[i]);
    // Date and antigen ROIs are non-empty rectangles inside [0,1].
    const dr = t.row_specs[i].date_roi;
    assert.ok(dr.width > 0 && dr.height > 0, `row ${i} date_roi has positive area`);
    assert.ok(
      dr.x + dr.width <= 1 + 1e-9 && dr.y + dr.height <= 1 + 1e-9,
      `row ${i} date_roi inside [0,1]`,
    );
    const ar = t.row_specs[i].antigen_roi;
    assert.ok(ar.width > 0 && ar.height > 0, `row ${i} antigen_roi has positive area`);
  }
});

test("loader: dose_kind invariants match document-intelligence.ts EGYPT_MOHP_TEMPLATE", () => {
  resetTemplateCache();
  const t = loadEgyptMohpTemplate();
  // Order mirrors the EGYPT_MOHP_TEMPLATE constant. If a future
  // canonical-template change reorders these, this test fails loud
  // and the wire boundary in document-intelligence.ts must be
  // updated together with the JSON.
  assert.equal(t.row_specs[0].dose_kind, "birth");
  assert.equal(t.row_specs[0].dose_number, 1);
  assert.equal(t.row_specs[1].dose_kind, "birth");
  assert.equal(t.row_specs[1].dose_number, null);
  assert.equal(t.row_specs[2].dose_kind, "birth");
  assert.equal(t.row_specs[2].dose_number, 1);
  assert.equal(t.row_specs[3].dose_kind, "primary");
  assert.equal(t.row_specs[3].dose_number, 1);
  assert.equal(t.row_specs[5].dose_kind, "primary");
  assert.equal(t.row_specs[5].dose_number, 3);
  assert.equal(t.row_specs[6].dose_kind, "primary");
  assert.equal(t.row_specs[6].dose_number, null);
  assert.equal(t.row_specs[8].dose_kind, "booster");
  assert.equal(t.row_specs[8].dose_number, null);
});

test("loader: cached — two calls return the same reference", () => {
  resetTemplateCache();
  const a = loadEgyptMohpTemplate();
  const b = loadEgyptMohpTemplate();
  assert.equal(a, b, "loader must cache the parsed object");
});

test("loader: resetTemplateCache forces a fresh load", () => {
  const a = loadEgyptMohpTemplate();
  resetTemplateCache();
  const b = loadEgyptMohpTemplate();
  // After reset, b is a fresh parse; structural equality holds but
  // identity does not.
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

// ── Validator: malformed payloads ───────────────────────────────────────────

function validBaseTemplate(): unknown {
  return {
    template_id: "egypt_mohp_mandatory_childhood_immunization",
    country: "EG",
    card_type: "mandatory_childhood_immunization",
    version: "1.0",
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
      {
        row_index: 0,
        age_label: "Birth",
        primary_antigen: "HepB",
        co_administered_antigens: [],
        dose_kind: "birth",
        dose_number: 1,
        date_roi: { x: 0.5, y: 0.3, width: 0.2, height: 0.05 },
        antigen_roi: { x: 0.2, y: 0.3, width: 0.2, height: 0.05 },
      },
    ],
  };
}

test("validator: accepts a minimal valid payload", () => {
  const out = validateTemplate(validBaseTemplate());
  assert.equal(out.template_id, "egypt_mohp_mandatory_childhood_immunization");
  assert.equal(out.row_specs.length, 1);
});

test("validator: rejects null", () => {
  assert.throws(() => validateTemplate(null), /must be an object/);
});

test("validator: rejects wrong template_id", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  t.template_id = "some_other_template";
  assert.throws(() => validateTemplate(t), /template_id must be/);
});

test("validator: rejects empty row_specs", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  t.row_specs = [];
  assert.throws(() => validateTemplate(t), /non-empty array/);
});

test("validator: rejects duplicate row_index", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const row = (t.row_specs as unknown[])[0] as Record<string, unknown>;
  t.row_specs = [row, { ...row }];
  assert.throws(() => validateTemplate(t), /duplicate row_index/);
});

test("validator: rejects non-canonical dose_kind", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const row = (t.row_specs as unknown[])[0] as Record<string, unknown>;
  row.dose_kind = "made_up";
  assert.throws(() => validateTemplate(t), /dose_kind must be one of/);
});

test("validator: rejects ROI box that extends beyond [0,1]", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const row = (t.row_specs as unknown[])[0] as Record<string, unknown>;
  row.date_roi = { x: 0.95, y: 0.5, width: 0.2, height: 0.05 };
  assert.throws(() => validateTemplate(t), /extends beyond \[0,1\]/);
});

test("validator: rejects ROI with zero or negative area", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const row = (t.row_specs as unknown[])[0] as Record<string, unknown>;
  row.date_roi = { x: 0.5, y: 0.5, width: 0, height: 0.05 };
  assert.throws(() => validateTemplate(t), /positive width and height/);
});

test("validator: rejects non-integer reference_canvas dimensions", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const cs = t.coordinate_system as Record<string, unknown>;
  cs.reference_canvas = { width: 1600.5, height: 1050 };
  assert.throws(() => validateTemplate(t), /must be an integer/);
});

test("validator: rejects missing required field with a path-prefixed error", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  delete t.country;
  assert.throws(() => validateTemplate(t), /\$\.country/);
});

test("validator: rejects non-array co_administered_antigens", () => {
  const t = validBaseTemplate() as Record<string, unknown>;
  const row = (t.row_specs as unknown[])[0] as Record<string, unknown>;
  row.co_administered_antigens = "OPV, IPV";
  assert.throws(() => validateTemplate(t), /array of strings/);
});

// ── Type-narrowing smoke test ───────────────────────────────────────────────
// If the type contract drifts in egypt-mohp.ts the assignment fails to
// compile, which the typecheck step catches.
test("validator: returned object satisfies VaccineCardTemplateJson", () => {
  const t: VaccineCardTemplateJson = validateTemplate(validBaseTemplate());
  assert.ok(t.row_specs[0].date_roi.x >= 0);
});
