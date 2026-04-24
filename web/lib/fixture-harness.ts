/**
 * E2E synthetic-fixture harness for the card-extraction pipeline.
 *
 * PURPOSE (PR 0, pre–template-inference fix):
 *   Establish a deterministic, measurable baseline of the deterministic
 *   portion of the pipeline (layout normalization → template inference
 *   → visit grouping → confirmation-gate preview) across every
 *   committed synthetic fixture in
 *   cards/fixtures/synthetic_vaccination_cards/manifest.json.
 *
 *   The upcoming PR 1 change (lifting the zero-rows guard so template
 *   inference fires per unfilled template row) will flip specific
 *   counts on the `partial_vision` scenario. PR 0's assertions freeze
 *   the PRE-FIX numbers so PR 1's diff is mechanical rather than
 *   eyeballed.
 *
 *   The harness does NOT call the Anthropic vision API. It translates
 *   manifest `expected_rows` into a synthetic tool_use payload shape
 *   and feeds it through the pure-TS downstream pipeline. This keeps
 *   every run deterministic and free, which is what "measurable" in
 *   Ahmed's sequencing note asks for.
 *
 * Drop modes simulate realistic vision states:
 *   - "full_vision"    — every expected row surfaces; vision perfect.
 *   - "partial_vision" — every OTHER expected row surfaces, simulating
 *                        the Egyptian MoHP messy-card failure mode
 *                        where vision reads some rows legibly and
 *                        others it cannot. This is the mode PR 1 will
 *                        re-shape by surfacing AMBER template_inferred
 *                        slots for the unread rows.
 *   - "zero_vision"    — no rows surface; vision total failure. This
 *                        is the ONLY mode the current zero-rows guard
 *                        permits template inference on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  inferRowsFromTemplate,
  type DocumentRegion,
  type EvidenceFragment,
  type LayoutAnalysisResult,
  type RecognizedTemplateId,
} from "./document-intelligence.ts";
import { groupVisits, type GroupedVisits } from "./visit-grouping.ts";
import type { DoseKind, ParsedCardRow } from "./types.ts";

// ── Manifest types (mirror manifest.json exactly) ───────────────────────────

export interface ManifestRow {
  row_id: string;
  visit: string;
  antigen: string;
  dose_number: string | number | null;
  dose_kind: DoseKind;
  date: string | null;
  raw_date_text: string | null;
  lot_number: string | null;
  expected_confidence_ceiling: number;
  reasoning_if_uncertain: string | null;
  preserve_duplicate: boolean;
}

export interface ManifestFixture {
  id: string;
  filename: string;
  source_type: string;
  contains_real_child_record: boolean;
  template: string;
  language: string;
  digit_system: string;
  visual_conditions: Record<string, boolean>;
  expected_template_id: RecognizedTemplateId;
  expected_rows: ManifestRow[];
  negative_controls: unknown[];
  expected_warnings: string[];
}

interface Manifest {
  dataset_id: string;
  fixtures: ManifestFixture[];
}

const MANIFEST_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "cards",
  "fixtures",
  "synthetic_vaccination_cards",
  "manifest.json",
);

let cachedManifest: Manifest | null = null;

export function loadManifest(): Manifest {
  if (cachedManifest) return cachedManifest;
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  cachedManifest = JSON.parse(raw) as Manifest;
  return cachedManifest;
}

// ── Drop modes ──────────────────────────────────────────────────────────────

export type DropMode = "full_vision" | "partial_vision" | "zero_vision";

function dropIndicesFor(mode: DropMode, total: number): Set<number> {
  if (mode === "full_vision") return new Set();
  if (mode === "zero_vision") {
    const all = new Set<number>();
    for (let i = 0; i < total; i++) all.add(i);
    return all;
  }
  // partial_vision: drop every ODD index (keep 0, 2, 4, ...). This
  // keeps the deterministic split stable across runs — the specific
  // parity does not matter for the test, only that some rows survive
  // and some do not.
  const dropped = new Set<number>();
  for (let i = 1; i < total; i += 2) dropped.add(i);
  return dropped;
}

// ── Synthesis: manifest row → ParsedCardRow ─────────────────────────────────

function coerceDoseNumber(raw: ManifestRow["dose_number"]): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return raw;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function manifestRowToParsed(
  row: ManifestRow,
  index: number,
): ParsedCardRow {
  const confidence = row.expected_confidence_ceiling;
  return {
    antigen: row.antigen,
    date: row.date,
    doseNumber: coerceDoseNumber(row.dose_number),
    doseKind: row.dose_kind,
    lotNumber: row.lot_number,
    confidence,
    reasoningIfUncertain: row.reasoning_if_uncertain,
    imageCropRegion: {
      x: 0,
      y: Math.min(0.95, index * 0.1),
      width: 1,
      height: 0.1,
    },
    source: "vision",
    sourceEvidenceFragmentId: `f-vision-${index}`,
  };
}

// ── Synthesis: manifest fixture → LayoutAnalysisResult ──────────────────────

function synthesizeLayout(
  fixture: ManifestFixture,
  keptIndices: Set<number>,
): LayoutAnalysisResult {
  const regions: DocumentRegion[] = [
    {
      region_id: "r-title",
      kind: "child_info",
      page_number: 1,
      label: "Card title",
      source_text:
        fixture.expected_template_id ===
        "egypt_mohp_mandatory_childhood_immunization"
          ? "التطعيمات الإجبارية"
          : null,
      confidence: 0.97,
      warnings: [],
    },
    {
      region_id: "r-table",
      kind: "vaccine_table",
      page_number: 1,
      label: "Primary schedule table",
      source_text: null,
      confidence: 0.9,
      warnings: [],
    },
  ];

  // One date-cell evidence fragment per expected_row. The layout
  // always carries the full set of date cells the model "saw" — even
  // when the parsed-rows array drops some. This mirrors the real
  // Egyptian MoHP failure mode where vision observes a date cell but
  // cannot produce a parsed row for it.
  const evidence_fragments: EvidenceFragment[] = fixture.expected_rows.map(
    (row, i) => ({
      fragment_id: `f-date-${i}`,
      region_id: "r-table",
      kind: "date_cell",
      source_text: row.raw_date_text,
      row_label: row.visit,
      raw_date_text: row.raw_date_text,
      vaccine_text: row.antigen,
      confidence: keptIndices.has(i)
        ? row.expected_confidence_ceiling
        : Math.min(0.6, row.expected_confidence_ceiling),
      warnings: [],
    }),
  );

  return {
    pages_detected: 1,
    orientation_warning: fixture.visual_conditions.rotated_or_skewed
      ? "Mock card is skewed and rotated."
      : null,
    crop_warning: null,
    regions,
    evidence_fragments,
    overall_confidence: 0.85,
    warnings: [...fixture.expected_warnings],
    recognized_template_id: fixture.expected_template_id,
    document_type_guess: fixture.expected_template_id,
  };
}

// ── Pipeline run result ─────────────────────────────────────────────────────

export interface PipelineRun {
  fixture_id: string;
  drop_mode: DropMode;
  template_id: RecognizedTemplateId;

  /** Vision rows fed into the pipeline after the drop strategy. */
  rows_in: number;

  /** Vision rows whose confidence >= 0.85 (the AMBER threshold). */
  rows_in_high_confidence: number;

  /** Total rows after template inference. For the current
   * implementation this equals rows_in unless rows_in was 0. */
  rows_out: number;

  /** Count of rows with source === "vision" in the final output. */
  vision_rows: number;

  /** Vision rows with confidence < 0.85 — these need clinician review
   * but are NOT template-predicted. */
  vision_ambiguous_rows: number;

  /** Count of rows with source === "template_inferred" in the final
   * output — AMBER predictions. */
  template_inferred_rows: number;

  /** Preview of what Step 4's `filter_confirmed_doses()` (lands in
   * PR 1) would admit today: source === "vision" && confidence >= 0.85.
   * Template-inferred rows never count — they require explicit
   * clinician confirmation before they reach reconciliation. */
  would_pass_confirmation_gate: number;

  /** Did `inferRowsFromTemplate` actually produce synthetic rows? */
  inference_fired: boolean;

  /** Visit groups the HITL UI would render. */
  visit_groups: number;

  /** Warnings the UI would surface. */
  warnings: string[];
}

// ── Harness entry point ─────────────────────────────────────────────────────

export function runScenario(
  fixture: ManifestFixture,
  mode: DropMode,
): PipelineRun {
  const dropped = dropIndicesFor(mode, fixture.expected_rows.length);
  const keptIndices = new Set<number>();
  for (let i = 0; i < fixture.expected_rows.length; i++) {
    if (!dropped.has(i)) keptIndices.add(i);
  }

  const visionRows: ParsedCardRow[] = [];
  fixture.expected_rows.forEach((row, i) => {
    if (keptIndices.has(i)) visionRows.push(manifestRowToParsed(row, i));
  });

  const layout = synthesizeLayout(fixture, keptIndices);
  const inference = inferRowsFromTemplate(layout, visionRows);
  const rowsAfterInference = inference.rows;

  const grouped: GroupedVisits = groupVisits(rowsAfterInference);

  const visionFinal = rowsAfterInference.filter(
    (r) => r.source === "vision" || r.source === undefined,
  );
  const visionHighConf = visionRows.filter((r) => r.confidence >= 0.85).length;
  const visionAmbiguous = visionFinal.filter((r) => r.confidence < 0.85).length;
  const templateInferred = rowsAfterInference.filter(
    (r) => r.source === "template_inferred",
  ).length;

  // Preview of the upcoming Step 4 filter: source === "vision" AND
  // confidence >= 0.85. Template-predicted rows MUST NOT be counted —
  // they require clinician confirmation.
  const wouldPass = rowsAfterInference.filter(
    (r) =>
      (r.source === "vision" || r.source === undefined) &&
      r.confidence >= 0.85,
  ).length;

  return {
    fixture_id: fixture.id,
    drop_mode: mode,
    template_id: fixture.expected_template_id,
    rows_in: visionRows.length,
    rows_in_high_confidence: visionHighConf,
    rows_out: rowsAfterInference.length,
    vision_rows: visionFinal.length,
    vision_ambiguous_rows: visionAmbiguous,
    template_inferred_rows: templateInferred,
    would_pass_confirmation_gate: wouldPass,
    inference_fired: inference.inferred,
    visit_groups: grouped.groups.length,
    warnings: [...layout.warnings, ...inference.warnings],
  };
}

/** Convenience: run every committed fixture × every drop mode. */
export function runAllScenarios(): PipelineRun[] {
  const { fixtures } = loadManifest();
  const modes: DropMode[] = ["full_vision", "partial_vision", "zero_vision"];
  const runs: PipelineRun[] = [];
  for (const fixture of fixtures) {
    for (const mode of modes) {
      runs.push(runScenario(fixture, mode));
    }
  }
  return runs;
}
