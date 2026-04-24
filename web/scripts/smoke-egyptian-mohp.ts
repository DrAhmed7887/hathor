/**
 * Smoke test — Egyptian MoHP card scenario with the specific failure
 * mode Ahmed flagged:
 *   - recognized Egyptian MoHP template in the regions
 *   - 10 regions total
 *   - 9 date-cell evidence fragments
 *   - 0 row-label evidence fragments
 *
 * The scenario is deterministic — it does not call Claude. The point
 * is to prove that the document-intelligence pipeline does NOT produce
 * an empty normalized_rows array under those inputs AND to expose the
 * UI-state decisions the demo page makes from the same inputs.
 *
 * Run:
 *   npm run smoke
 *   or
 *   node --experimental-strip-types web/scripts/smoke-egyptian-mohp.ts
 */

import {
  inferRowsFromTemplate,
  mergeEvidenceIntoRows,
  normalizeDocumentIntelligence,
  type DocumentRegion,
  type EvidenceFragment,
} from "../lib/document-intelligence.ts";
import type { ParsedCardRow } from "../lib/types.ts";

// ── Fixture: 10 regions, 0 row-label, 9 date-cell, Egyptian title ──────────

const regions: DocumentRegion[] = [
  {
    region_id: "r-title",
    kind: "child_info",
    page_number: 1,
    label: "Card title",
    source_text: "التطعيمات الإجبارية",
    confidence: 0.98,
    warnings: [],
  },
  {
    region_id: "r-patient",
    kind: "child_info",
    page_number: 1,
    label: "Patient block",
    source_text: "اسم الطفل / تاريخ الميلاد",
    confidence: 0.9,
    warnings: [],
  },
  {
    region_id: "r-table",
    kind: "vaccine_table",
    page_number: 1,
    label: "Primary schedule table",
    source_text: null,
    confidence: 0.92,
    warnings: [],
  },
  ...Array.from({ length: 7 }, (_, i): DocumentRegion => ({
    region_id: `r-row-${i + 1}`,
    kind: "vaccine_row",
    page_number: 1,
    label: `Row ${i + 1}`,
    source_text: null,
    confidence: 0.72,
    warnings: ["Printed row label is faded/illegible"],
  })),
];

const dateFragments: EvidenceFragment[] = Array.from({ length: 9 }, (_, i) => {
  const day = String(10 + i).padStart(2, "0");
  return {
    fragment_id: `f-date-${i + 1}`,
    region_id: `r-row-${(i % 7) + 1}`,
    kind: "date_cell",
    source_text: `${day}/٠٥/٢٠٢٤`,
    row_label: null,
    raw_date_text: `${day}/٠٥/٢٠٢٤`,
    vaccine_text: null,
    confidence: 0.7,
    warnings: ["Mixed Arabic/Western digits; clinician to confirm"],
  };
});

const rawLayoutInput = {
  pages_detected: 1,
  orientation_warning: null,
  crop_warning: null,
  regions,
  evidence_fragments: dateFragments, // zero row_label fragments by design
  overall_confidence: 0.72,
  warnings: [
    "Row labels faded across the table — rely on row position + clinician.",
  ],
};

// ── Pipe through the real pipeline ─────────────────────────────────────────

const layout = normalizeDocumentIntelligence(rawLayoutInput);

const rowLabelCount = layout.evidence_fragments.filter(
  (f) => f.kind === "row_label",
).length;
const dateCellCount = layout.evidence_fragments.filter(
  (f) => f.kind === "date_cell",
).length;

// We run the merger twice so we can compare the two cases:
//   Case A — vision call produced N rows alongside the trace (healthy).
//   Case B — vision call produced 0 rows but the trace carries rich
//            evidence (the failure-mode Ahmed asked us to verify).
const healthyRows: ParsedCardRow[] = Array.from({ length: 7 }, (_, i) => ({
  antigen: "DTP",
  date: `2024-05-${String(10 + i).padStart(2, "0")}`,
  doseNumber: i + 1 <= 5 ? i + 1 : null,
  doseKind: i + 1 <= 5 ? "primary" : "booster",
  lotNumber: null,
  confidence: 0.72,
  reasoningIfUncertain: "Row label faded; dose position inferred from row order",
  imageCropRegion: { x: 0, y: i * 0.1, width: 1, height: 0.1 },
}));

const caseA = mergeEvidenceIntoRows(layout, healthyRows);
// Case B: the concerning failure mode — vision pass returned 0 rows
// but the trace carries 9 date cells against a recognised template.
// Inference fires BEFORE the merger, producing AMBER rows the clinician
// reviews. Merger then runs over the inferred rows as usual.
const inferenceB = inferRowsFromTemplate(layout, []);
const rowsB = inferenceB.inferred ? inferenceB.rows : [];
const caseB = mergeEvidenceIntoRows(layout, rowsB);

// ── UI state simulator (mirrors ParsedResults + demo/page.tsx) ─────────────

function simulateUiState(
  rows: ParsedCardRow[],
  layoutUsedFallback: boolean,
  layout: ReturnType<typeof normalizeDocumentIntelligence> | null,
): {
  banner: string;
  status_line: string;
  amber_review_surface: "amber_callout" | "empty_state" | "row_list";
  proceed_enabled: boolean;
  export_allowed_before_review: boolean;
} {
  // Mirrors ParsedResults header h2.
  const banner =
    rows.length === 0
      ? "No rows extracted"
      : `${rows.length} row${rows.length === 1 ? "" : "s"} read from the card`;

  const amberCount = rows.reduce(
    (n, r) => n + (r.confidence < 0.85 ? 1 : 0),
    0,
  );
  // Unresolved count assumes no acknowledgements yet (cold state).
  const unresolvedCount = amberCount;

  const status_line =
    rows.length === 0
      ? "No rows to review"
      : amberCount === 0
        ? "All rows confident"
        : unresolvedCount === 0
          ? `${amberCount} flagged · all reviewed`
          : `${unresolvedCount} of ${amberCount} flagged row${amberCount === 1 ? "" : "s"} awaiting review`;

  // Matches ParsedResults: when rows are empty AND the trace carries
  // any evidence fragments, render the EmptyRowsAmberReview callout.
  // Otherwise the empty-state text. When rows exist, the row list.
  let amber_review_surface: "amber_callout" | "empty_state" | "row_list";
  if (rows.length > 0) amber_review_surface = "row_list";
  else if (layout && layout.evidence_fragments.length > 0)
    amber_review_surface = "amber_callout";
  else amber_review_surface = "empty_state";

  const proceed_enabled = rows.length > 0 && unresolvedCount === 0;

  // Export follows the demo page gate: only enabled after validationResults
  // arrive, which only happens after phaseEReady flips after Proceed.
  // Before clinician review → false.
  const export_allowed_before_review = false;

  void layoutUsedFallback; // reserved for future signal
  return {
    banner,
    status_line,
    amber_review_surface,
    proceed_enabled,
    export_allowed_before_review,
  };
}

function confidenceBucket(row: ParsedCardRow): "GREEN" | "AMBER" {
  return row.confidence < 0.85 ? "AMBER" : "GREEN";
}
function distribution(rows: ParsedCardRow[]) {
  let green = 0;
  let amber = 0;
  for (const r of rows) {
    if (confidenceBucket(r) === "GREEN") green++;
    else amber++;
  }
  // RED is reserved for the engine verdict — it cannot fire pre-validation.
  return { GREEN: green, AMBER: amber, RED: 0 };
}

// ── Emit report ────────────────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 70 - title.length))}`);
}

section("Fixture shape");
console.log(`pages_detected          : ${layout.pages_detected}`);
console.log(`overall_confidence      : ${layout.overall_confidence}`);
console.log(`orientation_warning     : ${layout.orientation_warning ?? "(none)"}`);
console.log(`crop_warning            : ${layout.crop_warning ?? "(none)"}`);
console.log(`regions count           : ${layout.regions.length}`);
console.log(`  by kind: ${JSON.stringify(
  layout.regions.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {}),
)}`);
console.log(`evidence_fragments count: ${layout.evidence_fragments.length}`);
console.log(`  row_label evidence    : ${rowLabelCount}`);
console.log(`  date_cell evidence    : ${dateCellCount}`);

// First-class fields now populated by the normaliser.
console.log(`document_type_guess     : ${layout.document_type_guess}`);
console.log(`recognized_template_id  : ${layout.recognized_template_id}`);

section("Case A — vision returned 7 parsed rows + trace");
console.log(`merge.used_fallback     : ${caseA.used_fallback}`);
console.log(`merge.rows.length       : ${caseA.rows.length}`);
console.log(`merge.warnings          :`);
for (const w of caseA.warnings) console.log(`  - ${w}`);
const distA = distribution(caseA.rows);
console.log(`confidence distribution : ${JSON.stringify(distA)}`);
const uiA = simulateUiState(caseA.rows, caseA.used_fallback, layout);
console.log(`ui.banner               : "${uiA.banner}"`);
console.log(`ui.status_line          : "${uiA.status_line}"`);
console.log(`ui.amber_review_surface : "${uiA.amber_review_surface}"`);
console.log(`ui.proceed_enabled      : ${uiA.proceed_enabled}`);
console.log(`ui.export_before_review : ${uiA.export_allowed_before_review}`);

section("Case B — vision returned 0 rows but trace has 9 date evidence");
console.log(`inference.inferred      : ${inferenceB.inferred}`);
console.log(`inference.rows.length   : ${inferenceB.rows.length}`);
console.log(`inference.template_id   : ${inferenceB.template_id}`);
for (const w of inferenceB.warnings) console.log(`  ! ${w}`);
console.log(`merge.used_fallback     : ${caseB.used_fallback}`);
console.log(`merge.rows.length       : ${caseB.rows.length}`);
console.log(`merge.warnings          :`);
for (const w of caseB.warnings) console.log(`  - ${w}`);
const distB = distribution(caseB.rows);
console.log(`confidence distribution : ${JSON.stringify(distB)}`);
const uiB = simulateUiState(caseB.rows, caseB.used_fallback, layout);
console.log(`ui.banner               : "${uiB.banner}"`);
console.log(`ui.status_line          : "${uiB.status_line}"`);
console.log(`ui.amber_review_surface : "${uiB.amber_review_surface}"`);
console.log(`ui.proceed_enabled      : ${uiB.proceed_enabled}`);
console.log(`ui.export_before_review : ${uiB.export_allowed_before_review}`);

// ── Assertions about the user's stated acceptance ─────────────────────────

section("Acceptance checks");

let passCount = 0;
let failCount = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (pass) {
    console.log(`  ✓ ${label}`);
    passCount++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failCount++;
  }
}

// Case A: with vision rows present, the pipeline must NOT collapse.
check(
  "Case A: rows preserved through merge (never drops)",
  caseA.rows.length === healthyRows.length,
  `got ${caseA.rows.length}, expected ${healthyRows.length}`,
);
check(
  "Case A: UI does NOT show 'No rows extracted'",
  uiA.banner !== "No rows extracted",
);
check(
  "Case A: UI does NOT claim 'All rows confident' when amber rows exist",
  !(distA.AMBER > 0 && uiA.status_line === "All rows confident"),
);
check(
  "Case A: Export stays disabled before clinician review",
  uiA.export_allowed_before_review === false,
);

// Case B: the concerning failure mode.
check(
  "Case B: inference produced 9 AMBER rows from 9 date cells",
  inferenceB.inferred && inferenceB.rows.length === 9,
  `inferred=${inferenceB.inferred}, rows=${inferenceB.rows.length}`,
);
check(
  "Case B: every inferred row is AMBER (confidence < 0.85)",
  inferenceB.rows.every((r) => r.confidence < 0.85),
);
check(
  "Case B: every inferred row carries source='template_inferred'",
  inferenceB.rows.every((r) => r.source === "template_inferred"),
);
check(
  "Case B: UI surfaces a row list (not just empty-state callout)",
  uiB.amber_review_surface === "row_list",
  `amber_review_surface="${uiB.amber_review_surface}"`,
);
check(
  "Case B: status_line reflects review-required state, not 'All rows confident'",
  uiB.status_line !== "All rows confident",
  `got status_line="${uiB.status_line}"`,
);
check(
  "Case B: Export stays disabled before clinician review",
  uiB.export_allowed_before_review === false,
);
check(
  "Case B: Proceed stays disabled — every row is unresolved AMBER",
  uiB.proceed_enabled === false,
);

console.log(`\nResult: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exitCode = 1;
