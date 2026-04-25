/**
 * Loader + types for the canonical Egyptian MoHP card template that
 * lives at data/templates/egypt_mohp_child_card.json.
 *
 * The JSON is the single source of truth for both the per-fixture
 * `template_roi_boxes` echoed in
 * cards/fixtures/synthetic_vaccination_cards/manifest.json and the
 * row_specs the ROI orchestrator iterates over. The synthetic-card
 * generator at
 * cards/fixtures/synthetic_vaccination_cards/generate_synthetic_vaccination_cards.py
 * refuses to run when the JSON drifts from its own constants — this
 * loader trusts that drift check and only validates the JSON
 * structurally.
 *
 * The loader is read-once-and-cache. Tests can call resetTemplateCache()
 * to force a fresh load, e.g. when testing a malformed payload via
 * validateTemplate() directly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DoseKind } from "../types.ts";

export interface RoiBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateRowSpec {
  row_index: number;
  age_label: string;
  primary_antigen: string;
  co_administered_antigens: string[];
  dose_kind: DoseKind;
  dose_number: number | null;
  date_roi: RoiBox;
  antigen_roi: RoiBox;
}

export interface VaccineCardTemplateJson {
  template_id: string;
  country: string;
  card_type: string;
  version: string;
  is_synthetic_derived: boolean;
  source_notes: string;
  coordinate_system: {
    kind: string;
    x_range: [number, number];
    y_range: [number, number];
    origin: string;
    reference_canvas: { width: number; height: number };
  };
  row_specs: TemplateRowSpec[];
}

// Under bare Node ESM (the package.json `test` script), import.meta.dirname
// resolves to web/lib/templates. Under Next 16 + Turbopack route bundling
// it is undefined, so we fall back to process.cwd() — which is `web/` for
// both `next dev` and the test script.
const TEMPLATE_PATH = import.meta.dirname
  ? join(
      import.meta.dirname,
      "..", // web/lib/templates → web/lib
      "..", // web/lib → web
      "..", // web → repo root
      "data",
      "templates",
      "egypt_mohp_child_card.json",
    )
  : join(
      process.cwd(),
      "..", // web → repo root
      "data",
      "templates",
      "egypt_mohp_child_card.json",
    );

let cached: VaccineCardTemplateJson | null = null;

/** Read + validate the canonical Egyptian MoHP template. Cached after
 * the first call. Throws on missing file or malformed JSON. */
export function loadEgyptMohpTemplate(): VaccineCardTemplateJson {
  if (cached) return cached;
  const raw = readFileSync(TEMPLATE_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadEgyptMohpTemplate: ${TEMPLATE_PATH} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  cached = validateTemplate(parsed);
  return cached;
}

/** Drop the cached template. Test-only — production code never needs
 * this. The loader is otherwise a pure read of a committed JSON. */
export function resetTemplateCache(): void {
  cached = null;
}

/** Structural validator. Pure function — exposed so tests can drive
 * malformed payloads through it without touching the filesystem.
 *
 * Loud failure is the goal: if a field is missing, throws with a
 * specific path, so a future schema change is mechanical. The
 * validator does NOT fix or coerce; it asserts. */
export function validateTemplate(raw: unknown): VaccineCardTemplateJson {
  const t = expectObject(raw, "$");
  const id = expectString(t.template_id, "$.template_id");
  if (id !== "egypt_mohp_mandatory_childhood_immunization") {
    throw new Error(
      `validateTemplate: $.template_id must be ` +
        `"egypt_mohp_mandatory_childhood_immunization", got "${id}"`,
    );
  }
  const country = expectString(t.country, "$.country");
  const cardType = expectString(t.card_type, "$.card_type");
  const version = expectString(t.version, "$.version");
  const isSynth = expectBoolean(t.is_synthetic_derived, "$.is_synthetic_derived");
  const sourceNotes = expectString(t.source_notes, "$.source_notes");
  const coords = expectObject(t.coordinate_system, "$.coordinate_system");
  const coordsKind = expectString(coords.kind, "$.coordinate_system.kind");
  const xRange = expectNumberPair(coords.x_range, "$.coordinate_system.x_range");
  const yRange = expectNumberPair(coords.y_range, "$.coordinate_system.y_range");
  const origin = expectString(coords.origin, "$.coordinate_system.origin");
  const canvas = expectObject(
    coords.reference_canvas,
    "$.coordinate_system.reference_canvas",
  );
  const canvasW = expectInt(
    canvas.width,
    "$.coordinate_system.reference_canvas.width",
  );
  const canvasH = expectInt(
    canvas.height,
    "$.coordinate_system.reference_canvas.height",
  );
  if (canvasW <= 0 || canvasH <= 0) {
    throw new Error(
      `validateTemplate: reference_canvas dimensions must be positive ` +
        `(got width=${canvasW}, height=${canvasH})`,
    );
  }

  const rowSpecsRaw = t.row_specs;
  if (!Array.isArray(rowSpecsRaw) || rowSpecsRaw.length === 0) {
    throw new Error(
      `validateTemplate: $.row_specs must be a non-empty array (got ${
        Array.isArray(rowSpecsRaw) ? "empty array" : typeof rowSpecsRaw
      })`,
    );
  }

  const seenIndices = new Set<number>();
  const rowSpecs: TemplateRowSpec[] = rowSpecsRaw.map((rawSpec, i) => {
    const path = `$.row_specs[${i}]`;
    const s = expectObject(rawSpec, path);
    const rowIndex = expectInt(s.row_index, `${path}.row_index`);
    if (seenIndices.has(rowIndex)) {
      throw new Error(
        `validateTemplate: duplicate row_index ${rowIndex} at ${path}`,
      );
    }
    seenIndices.add(rowIndex);
    const ageLabel = expectString(s.age_label, `${path}.age_label`);
    const primaryAntigen = expectString(
      s.primary_antigen,
      `${path}.primary_antigen`,
    );
    const coAdmin = expectStringArray(
      s.co_administered_antigens,
      `${path}.co_administered_antigens`,
    );
    const doseKind = expectDoseKind(s.dose_kind, `${path}.dose_kind`);
    const doseNumber = expectIntOrNull(s.dose_number, `${path}.dose_number`);
    const dateRoi = expectRoi(s.date_roi, `${path}.date_roi`);
    const antigenRoi = expectRoi(s.antigen_roi, `${path}.antigen_roi`);
    return {
      row_index: rowIndex,
      age_label: ageLabel,
      primary_antigen: primaryAntigen,
      co_administered_antigens: coAdmin,
      dose_kind: doseKind,
      dose_number: doseNumber,
      date_roi: dateRoi,
      antigen_roi: antigenRoi,
    };
  });

  return {
    template_id: id,
    country,
    card_type: cardType,
    version,
    is_synthetic_derived: isSynth,
    source_notes: sourceNotes,
    coordinate_system: {
      kind: coordsKind,
      x_range: xRange,
      y_range: yRange,
      origin,
      reference_canvas: { width: canvasW, height: canvasH },
    },
    row_specs: rowSpecs,
  };
}

// ── Field helpers — narrow + raise with a descriptive path ──────────────────

function expectObject(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`validateTemplate: ${path} must be an object`);
  }
  return v as Record<string, unknown>;
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      `validateTemplate: ${path} must be a non-empty string (got ${typeof v})`,
    );
  }
  return v;
}

function expectBoolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") {
    throw new Error(`validateTemplate: ${path} must be a boolean (got ${typeof v})`);
  }
  return v;
}

function expectInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(
      `validateTemplate: ${path} must be an integer (got ${typeof v} ${v})`,
    );
  }
  return v;
}

function expectIntOrNull(v: unknown, path: string): number | null {
  if (v === null) return null;
  return expectInt(v, path);
}

function expectNumberPair(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new Error(
      `validateTemplate: ${path} must be a length-2 array of numbers`,
    );
  }
  const [a, b] = v;
  if (typeof a !== "number" || typeof b !== "number") {
    throw new Error(`validateTemplate: ${path} entries must be numbers`);
  }
  return [a, b];
}

function expectStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) {
    throw new Error(`validateTemplate: ${path} must be an array of strings`);
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      throw new Error(
        `validateTemplate: ${path}[${i}] must be a string (got ${typeof v[i]})`,
      );
    }
  }
  return v as string[];
}

const VALID_DOSE_KINDS: ReadonlySet<DoseKind> = new Set([
  "primary",
  "booster",
  "birth",
  "unknown",
]);

function expectDoseKind(v: unknown, path: string): DoseKind {
  if (typeof v !== "string" || !VALID_DOSE_KINDS.has(v as DoseKind)) {
    throw new Error(
      `validateTemplate: ${path} must be one of primary|booster|birth|unknown ` +
        `(got ${typeof v} ${JSON.stringify(v)})`,
    );
  }
  return v as DoseKind;
}

function expectRoi(v: unknown, path: string): RoiBox {
  const o = expectObject(v, path);
  const x = expectNormalized(o.x, `${path}.x`);
  const y = expectNormalized(o.y, `${path}.y`);
  const width = expectNormalized(o.width, `${path}.width`);
  const height = expectNormalized(o.height, `${path}.height`);
  if (width <= 0 || height <= 0) {
    throw new Error(
      `validateTemplate: ${path} must have positive width and height ` +
        `(got width=${width}, height=${height})`,
    );
  }
  if (x + width > 1.0000001 || y + height > 1.0000001) {
    throw new Error(
      `validateTemplate: ${path} extends beyond [0,1] (x+w=${x + width}, ` +
        `y+h=${y + height})`,
    );
  }
  return { x, y, width, height };
}

function expectNormalized(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(
      `validateTemplate: ${path} must be a finite number in [0,1] (got ${v})`,
    );
  }
  return v;
}
