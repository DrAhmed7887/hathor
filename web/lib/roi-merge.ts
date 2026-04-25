/**
 * Merge per-ROI vision reads into the whole-image extraction rows for
 * the Egyptian MoHP mandatory-immunizations card.
 *
 * Posture (mirrors PR design):
 *   - Pure module. No I/O, no Anthropic calls, no sharp imports.
 *   - Parse-card route owns "fire vision + run ROI"; this module owns
 *     "decide who wins per template slot."
 *   - Confident, dated whole-image rows are NEVER overwritten — that
 *     would lose calibration the model spent context on.
 *   - Existing inferRowsFromTemplate stays as the LAST-RESORT fallback:
 *     it fires only on slots that BOTH the whole-image pass and the
 *     ROI pass left empty. Egypt-specific ROI is the primary fill.
 */

import type { ParsedCardRow } from "./types.ts";
import type { VaccineCardTemplateJson } from "./templates/egypt-mohp.ts";
import { CONFIDENCE_THRESHOLD } from "./trust-gate.ts";

export const EGYPT_MOHP_TEMPLATE_ID =
  "egypt_mohp_mandatory_childhood_immunization" as const;

/** Trigger predicate for the Egypt MoHP ROI pass. Pure — separated from
 * the route so it can be unit-tested. The route only invokes
 * runRoiExtraction when this returns true; non-Egypt templates and an
 * absent / malformed trace fall through to the existing path. */
export function shouldRunEgyptMohpRoi(
  recognizedTemplateId: string | null | undefined,
): boolean {
  return recognizedTemplateId === EGYPT_MOHP_TEMPLATE_ID;
}

/** Same antigen-key normalisation inferRowsFromTemplate uses. Kept
 * private to this module so it stays in sync with the matcher. */
function antigenKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface MergeRoiInput {
  template: VaccineCardTemplateJson;
  /** Rows from the whole-image vision call. */
  visionRows: ParsedCardRow[];
  /** Rows from runRoiExtraction. Each carries a template_spec_index
   * set by the orchestrator. */
  roiRows: ParsedCardRow[];
}

export interface MergeRoiOutput {
  /** Final rows in template-spec order, then any vision rows that did
   * not claim a template spec (off-template antigens) appended. */
  rows: ParsedCardRow[];
  /** Audit trail strings the route folds into documentIntelligence
   * warnings — judges and clinicians can see WHICH slot the ROI
   * touched. */
  warnings: string[];
}

/**
 * Per-spec rules:
 *   1. Confident, dated whole-image row → preserved unchanged.
 *   2. Whole-image row with low confidence OR missing date AND a
 *      validated ROI read (source === "vision", date != null) at the
 *      same slot AND ROI confidence STRICTLY higher than whole-image
 *      → patch the date + confidence on the whole-image row.
 *   3. No whole-image row claims the slot AND ROI returned a dated
 *      read (any confidence) → adopt the ROI row.
 *   4. No whole-image row AND ROI returned blank → leave the slot
 *      empty so inferRowsFromTemplate fallback can fire.
 *
 * Rule 4 is the load-bearing reason inferRowsFromTemplate stays in
 * the pipeline: the merger never invents a date the ROI did not see.
 */
export function mergeRoiIntoVisionRows({
  template,
  visionRows,
  roiRows,
}: MergeRoiInput): MergeRoiOutput {
  const warnings: string[] = [];

  // Greedy left-to-right antigen matching, identical in shape to
  // inferRowsFromTemplate. Each whole-image row claims the first
  // unfilled spec whose antigen key matches.
  const claimedByVision = new Map<number, ParsedCardRow>();
  const unclaimedVision: ParsedCardRow[] = [];
  for (const row of visionRows) {
    const k = antigenKey(row.antigen);
    let assigned = -1;
    for (let i = 0; i < template.row_specs.length; i++) {
      if (claimedByVision.has(i)) continue;
      if (antigenKey(template.row_specs[i].primary_antigen) !== k) continue;
      assigned = i;
      break;
    }
    if (assigned === -1) {
      unclaimedVision.push(row);
    } else {
      claimedByVision.set(assigned, row);
    }
  }

  // Index ROI rows by their template_spec_index. The orchestrator
  // emits one row per spec; defensive guard against duplicates keeps
  // the merger total even if a future change loosens that.
  const roiByIdx = new Map<number, ParsedCardRow>();
  for (const r of roiRows) {
    if (r.template_spec_index == null) continue;
    if (roiByIdx.has(r.template_spec_index)) continue;
    roiByIdx.set(r.template_spec_index, r);
  }

  const mergedBySpec: ParsedCardRow[] = [];
  for (let i = 0; i < template.row_specs.length; i++) {
    const v = claimedByVision.get(i);
    const r = roiByIdx.get(i);
    const specAntigen = template.row_specs[i].primary_antigen;

    if (v != null) {
      const confidentDated =
        v.confidence >= CONFIDENCE_THRESHOLD && v.date != null;
      if (confidentDated) {
        // Rule 1.
        mergedBySpec.push({ ...v, template_spec_index: i });
        continue;
      }
      // Rule 2: only patch when ROI is a validated read AND strictly
      // more confident than the whole-image row. Equal-confidence ties
      // go to the whole-image row (it had more context).
      const roiValidated =
        r != null && r.source === "vision" && r.date != null;
      if (roiValidated && r!.confidence > v.confidence) {
        const noteSuffix = "(date upgraded from per-cell ROI read)";
        const patched: ParsedCardRow = {
          ...v,
          template_spec_index: i,
          date: r!.date,
          confidence: r!.confidence,
          fieldConfidences: {
            ...(v.fieldConfidences ?? {}),
            date: r!.confidence,
          },
          reasoningIfUncertain: v.reasoningIfUncertain
            ? `${v.reasoningIfUncertain} ${noteSuffix}`
            : `Date upgraded from per-cell ROI read (${r!.confidence.toFixed(2)} confidence).`,
        };
        mergedBySpec.push(patched);
        warnings.push(
          `Row ${i} (${specAntigen}): date upgraded from ROI re-read.`,
        );
      } else {
        mergedBySpec.push({ ...v, template_spec_index: i });
      }
      continue;
    }

    // Rule 3: no whole-image row at this slot. Adopt ROI when it has
    // a date — even at low confidence the row routes to AMBER review.
    if (r != null && r.date != null) {
      mergedBySpec.push({ ...r, template_spec_index: i });
      warnings.push(
        `Row ${i} (${specAntigen}): added from ROI read (whole-image missed).`,
      );
    }
    // Rule 4: ROI also blank → leave empty for inferRowsFromTemplate.
  }

  return {
    rows: [...mergedBySpec, ...unclaimedVision],
    warnings,
  };
}
