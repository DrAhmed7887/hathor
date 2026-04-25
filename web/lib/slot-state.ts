/**
 * Deterministic slot-state derivation and prediction-id formatting.
 *
 * The wire boundary in /api/parse-card/route.ts populates
 * ParsedCardRow.slot_state and prediction_id using these helpers so
 * every consumer sees a consistent shape. The trust gate falls back
 * to derive-on-demand when a row arrives without these fields set
 * (existing test fixtures and pre-PR-2 callers).
 *
 * See docs/hitl-ui-design.md §1, §3, §6.1.
 */

import { CONFIDENCE_THRESHOLD } from "./trust-gate.ts";
import type { ParsedCardRow, Visit } from "./types";

/** Derive the slot state from source + confidence. Pure. */
export function slotStateOf(
  row: ParsedCardRow,
): "extracted" | "ambiguous" | "predicted" {
  if (row.slot_state) return row.slot_state;
  const source = row.source ?? "vision";
  if (source === "template_inferred" || source === "predicted_from_schedule") {
    return "predicted";
  }
  if (source === "vision_low_confidence") return "ambiguous";
  // source === "vision" — gate on confidence (row aggregate AND
  // per-field if present).
  if (row.confidence < CONFIDENCE_THRESHOLD) return "ambiguous";
  if (row.fieldConfidences) {
    const fa = row.fieldConfidences.antigen;
    const fd = row.fieldConfidences.date;
    if (fa !== undefined && fa < CONFIDENCE_THRESHOLD) return "ambiguous";
    if (fd !== undefined && fd < CONFIDENCE_THRESHOLD) return "ambiguous";
  }
  return "extracted";
}

/** Derive the predicted sub-flavor for a row given the total count of
 * vision-source rows on the same parse output. The discriminator is
 * binary at zero (design note §3): zero vision rows → entire
 * schedule is template-inferred; otherwise → a missed visit on an
 * otherwise-legible card.
 *
 * Returns null for non-predicted rows. */
export function predictedSubkindOf(
  row: ParsedCardRow,
  totalVisionRows: number,
):
  | "predicted_missing_visit"
  | "predicted_zero_vision_template"
  | null {
  if (slotStateOf(row) !== "predicted") return null;
  return totalVisionRows === 0
    ? "predicted_zero_vision_template"
    : "predicted_missing_visit";
}

/** Map slot state + sub-flavor to the audit-log slot_state_at_action
 * enum. The audit log keeps the predicted sub-flavor flat in one
 * field so post-hoc audits don't need to re-derive. */
export function slotStateForAudit(
  row: ParsedCardRow,
):
  | "extracted"
  | "ambiguous"
  | "predicted_missing_visit"
  | "predicted_zero_vision_template" {
  const state = slotStateOf(row);
  if (state !== "predicted") return state;
  return row.predicted_subkind ?? "predicted_missing_visit";
}

/** Build a prediction_id for a row.
 *   - vision rows: "V:<sourceEvidenceFragmentId>" when present,
 *     else "V:<row_id>" as a stable fallback.
 *   - predicted rows: "T:<template_spec_index>".
 *
 * The structural prefix is the contract — downstream logs and FHIR
 * exports tell predicted from vision rows by the prefix, never by
 * copy. (Limitation 3 fix from PR 1.) */
export function predictionIdOf(row: ParsedCardRow): string {
  if (row.prediction_id) return row.prediction_id;
  if (slotStateOf(row) === "predicted") {
    if (row.template_spec_index === null || row.template_spec_index === undefined) {
      throw new Error(
        `Row ${row.row_id ?? "(no row_id)"}: predicted rows must carry ` +
          `template_spec_index — cannot generate prediction_id.`,
      );
    }
    return `T:${row.template_spec_index}`;
  }
  const fragId = row.sourceEvidenceFragmentId ?? row.row_id ?? "(no-id)";
  return `V:${fragId}`;
}

/** Group rows into Visit objects. Egyptian MoHP cards have nine age
 * points; predicted rows carry their template_spec_index by
 * construction, vision rows carry it from the greedy matcher in
 * inferRowsFromTemplate. Vision rows whose antigen has no template
 * spec land in their own Visits with `template_spec_index: null` at
 * the end of the list (visit_id format: `V:<row_id>`).
 *
 * Visit ordering: template-aligned visits first, in
 * template_spec_index ascending order; non-template visits after,
 * in input order. */
export function buildVisits(
  rows: ParsedCardRow[],
  templateAgeLabels: Record<number, string>,
): Visit[] {
  const byIdx = new Map<number, ParsedCardRow[]>();
  const noIdx: ParsedCardRow[] = [];
  for (const r of rows) {
    const idx = r.template_spec_index;
    if (idx === undefined || idx === null) {
      noIdx.push(r);
      continue;
    }
    const bucket = byIdx.get(idx);
    if (bucket) bucket.push(r);
    else byIdx.set(idx, [r]);
  }
  const visits: Visit[] = [];
  for (const idx of [...byIdx.keys()].sort((a, b) => a - b)) {
    const visitRows = byIdx.get(idx) ?? [];
    visits.push({
      visit_id: `visit-spec-${idx}`,
      template_spec_index: idx,
      age_label: templateAgeLabels[idx] ?? null,
      rows: visitRows,
    });
  }
  for (const r of noIdx) {
    visits.push({
      visit_id: `visit-row-${r.row_id ?? "anon"}`,
      template_spec_index: null,
      age_label: null,
      rows: [r],
    });
  }
  return visits;
}
