/**
 * Per-ROI extraction orchestrator.
 *
 * Iterates the canonical Egyptian MoHP template's row_specs,
 * crops each date ROI from the input image, and calls a per-ROI
 * vision read for that crop. Returns ParsedCardRow[] in row_index
 * order plus a per-row diagnostic trail the benchmark consumes.
 *
 * Posture (mirrors PR 4 plan §3, §6):
 *   - This module has TWO injected dependencies:
 *       Cropper      — slices a normalised pixel rect out of an image
 *       RoiVisionCall — runs a vision read against a single crop
 *     Both are injected so this module is testable WITHOUT sharp,
 *     WITHOUT any image library, and WITHOUT live Anthropic calls.
 *     PR 4 Commit 3 wires real implementations from the parse-card
 *     route.
 *
 *   - The CONFIDENCE_THRESHOLD invariant from web/lib/trust-gate.ts
 *     governs which rows can ever reach reconciliation. This module
 *     emits source="vision" only when an ROI confidently parses to
 *     a date AND clears that threshold. Anything else degrades to
 *     source="vision_low_confidence" — the trust gate then routes
 *     it to clinician review.
 *
 *   - blank_or_illegible from the per-ROI prompt is honoured: those
 *     ROIs become AMBER rows with date=null, confidence ≤ 0.4, and
 *     source="vision_low_confidence". They never pass the gate.
 *
 *   - parseRawDate (web/lib/document-intelligence.ts) cross-checks
 *     the model's normalized_date_candidate against the raw_text.
 *     Disagreement downgrades confidence — the model's normalisation
 *     is not trusted unless a deterministic parser agrees.
 *
 * Concurrency:
 *   Per-ROI calls run in parallel with a default cap of 4 in-flight
 *   to keep latency bounded without saturating the Anthropic API.
 *   The cap is configurable via input.concurrency.
 */

import type { ParsedCardRow } from "./types.ts";
import { parseRawDate } from "./document-intelligence.ts";
import { CONFIDENCE_THRESHOLD } from "./trust-gate.ts";
import {
  denormalizeBox,
  isUsableCrop,
  type ImageDimensions,
  type PixelRect,
} from "./image-crop.ts";
import type {
  TemplateRowSpec,
  VaccineCardTemplateJson,
} from "./templates/egypt-mohp.ts";

/** What the per-ROI vision call must return. Matches the
 * record_roi_read tool schema in roi-extraction-prompt.ts. */
export interface RoiReadResult {
  raw_text: string | null;
  normalized_date_candidate: string | null;
  confidence: number;
  blank_or_illegible: boolean;
  reasoning_if_uncertain: string | null;
}

/** Crop a pixel rect out of an image buffer. Implementations live
 * outside this module; tests inject a mock. PR 4 Commit 3 will pass
 * a sharp-backed implementation from the parse-card route. */
export type Cropper = (
  image: Buffer,
  rect: PixelRect,
) => Promise<Buffer>;

/** Run the per-ROI vision read against a single crop. Implementations
 * call Anthropic; tests inject a deterministic mock. */
export type RoiVisionCall = (
  cropBytes: Buffer,
  mimeType: string,
) => Promise<RoiReadResult>;

export interface RoiExtractionInput {
  imageBuffer: Buffer;
  mimeType: string;
  imageDimensions: ImageDimensions;
  template: VaccineCardTemplateJson;
  cropper: Cropper;
  roiVision: RoiVisionCall;
  /** Max concurrent per-ROI calls. Default 4. */
  concurrency?: number;
}

/** Per-row provenance trail. The benchmark surfaces these so a
 * judge can see what raw_text the model returned, whether the
 * cross-check agreed, and what the orchestrator's effective
 * confidence ended up being after that cross-check. */
export interface RoiDiagnostic {
  row_index: number;
  primary_antigen: string;
  raw_text: string | null;
  normalized_date_candidate: string | null;
  /** parseRawDate's verdict on raw_text. */
  parsed_date: string | null;
  blank_or_illegible: boolean;
  /** Whether the cropper produced a non-empty rectangle. */
  crop_usable: boolean;
  /** Confidence reported by the model. */
  model_confidence: number;
  /** Confidence after cross-check / blank handling. */
  effective_confidence: number;
  effective_source: ParsedCardRow["source"];
  cross_check:
    | "match" // candidate and parsed agree
    | "mismatch" // both present, disagree
    | "candidate_only" // model produced candidate, parser couldn't
    | "parsed_only" // parser succeeded, model returned null candidate
    | "neither" // neither side produced a date
    | "blank"; // blank_or_illegible flag set
}

export interface RoiExtractionResult {
  rows: ParsedCardRow[];
  diagnostics: RoiDiagnostic[];
}

/** Confidence cap when an ROI is flagged blank_or_illegible. The
 * exact value is below the AMBER threshold by construction; the
 * model's raw confidence is also clipped to this ceiling. */
const BLANK_CONFIDENCE_CAP = 0.4;

/** Confidence cap when the model and the deterministic parser
 * disagree on the date. Sits below the AMBER threshold so the
 * resulting row routes to clinician review. */
const MISMATCH_CONFIDENCE_CAP = 0.6;

/** Confidence cap when only one side (candidate vs parser) produced
 * a date. Below the AMBER threshold for the same reason. */
const SINGLE_SIDE_CONFIDENCE_CAP = 0.7;

export async function runRoiExtraction(
  input: RoiExtractionInput,
): Promise<RoiExtractionResult> {
  const {
    imageBuffer,
    mimeType,
    imageDimensions,
    template,
    cropper,
    roiVision,
  } = input;
  const concurrency = Math.max(1, input.concurrency ?? 4);

  const tasks = template.row_specs.map((spec) => async () => {
    const rect = denormalizeBox(spec.date_roi, imageDimensions);
    const cropUsable = isUsableCrop(rect, imageDimensions);
    if (!cropUsable) {
      // Defensive: the canonical synthetic template never produces
      // unusable rects, but a future template variant could. Emit a
      // blank row rather than throwing so the run completes.
      return buildPerRow(spec, blankResult("crop rect was empty or out of bounds"), false);
    }
    const cropBytes = await cropper(imageBuffer, rect);
    const result = await roiVision(cropBytes, mimeType);
    return buildPerRow(spec, result, cropUsable);
  });

  const completions = await runWithConcurrency(tasks, concurrency);
  // Stable order by template_spec_index. Output order is independent
  // of completion order; tests rely on this.
  completions.sort(
    (a, b) =>
      (a.row.template_spec_index ?? 0) - (b.row.template_spec_index ?? 0),
  );

  return {
    rows: completions.map((c) => c.row),
    diagnostics: completions.map((c) => c.diag),
  };
}

interface PerRow {
  row: ParsedCardRow;
  diag: RoiDiagnostic;
}

function blankResult(reason: string): RoiReadResult {
  return {
    raw_text: null,
    normalized_date_candidate: null,
    confidence: 0,
    blank_or_illegible: true,
    reasoning_if_uncertain: reason,
  };
}

function buildPerRow(
  spec: TemplateRowSpec,
  result: RoiReadResult,
  cropUsable: boolean,
): PerRow {
  const rawText = result.raw_text;
  const candidate = result.normalized_date_candidate;
  const parsed = parseRawDate(rawText);

  let crossCheck: RoiDiagnostic["cross_check"];
  if (result.blank_or_illegible) crossCheck = "blank";
  else if (candidate && parsed) crossCheck = candidate === parsed ? "match" : "mismatch";
  else if (candidate && !parsed) crossCheck = "candidate_only";
  else if (!candidate && parsed) crossCheck = "parsed_only";
  else crossCheck = "neither";

  let effectiveConfidence = clamp01(result.confidence);
  let effectiveDate: string | null;

  if (result.blank_or_illegible) {
    effectiveConfidence = Math.min(effectiveConfidence, BLANK_CONFIDENCE_CAP);
    effectiveDate = null;
  } else if (candidate && parsed) {
    if (candidate === parsed) {
      effectiveDate = parsed;
      // Match — keep model confidence as-is.
    } else {
      // Mismatch — prefer the deterministic parser, downgrade.
      effectiveDate = parsed;
      effectiveConfidence = Math.min(effectiveConfidence, MISMATCH_CONFIDENCE_CAP);
    }
  } else if (parsed) {
    effectiveDate = parsed;
    effectiveConfidence = Math.min(effectiveConfidence, SINGLE_SIDE_CONFIDENCE_CAP);
  } else if (candidate) {
    effectiveDate = candidate;
    effectiveConfidence = Math.min(effectiveConfidence, MISMATCH_CONFIDENCE_CAP);
  } else {
    // Neither side produced a date and blank_or_illegible was false.
    // Treat as a low-confidence non-blank read with date=null.
    effectiveDate = null;
    effectiveConfidence = Math.min(effectiveConfidence, BLANK_CONFIDENCE_CAP);
  }

  const source: ParsedCardRow["source"] =
    !result.blank_or_illegible &&
    effectiveDate !== null &&
    effectiveConfidence >= CONFIDENCE_THRESHOLD
      ? "vision"
      : "vision_low_confidence";

  const slotState: ParsedCardRow["slot_state"] =
    source === "vision" ? "extracted" : "ambiguous";

  const fragmentId = `roi-${spec.row_index}`;
  const predictionId = `V:${fragmentId}`;

  const row: ParsedCardRow = {
    antigen: spec.primary_antigen,
    date: effectiveDate,
    doseNumber: spec.dose_number,
    doseKind: spec.dose_kind,
    confidence: effectiveConfidence,
    reasoningIfUncertain: result.reasoning_if_uncertain,
    imageCropRegion: {
      x: spec.date_roi.x,
      y: spec.date_roi.y,
      width: spec.date_roi.width,
      height: spec.date_roi.height,
    },
    source,
    sourceEvidenceFragmentId: fragmentId,
    template_spec_index: spec.row_index,
    prediction_id: predictionId,
    slot_state: slotState,
    predicted_subkind: null,
    clinician_action: "none",
  };

  const diag: RoiDiagnostic = {
    row_index: spec.row_index,
    primary_antigen: spec.primary_antigen,
    raw_text: rawText,
    normalized_date_candidate: candidate,
    parsed_date: parsed,
    blank_or_illegible: result.blank_or_illegible,
    crop_usable: cropUsable,
    model_confidence: result.confidence,
    effective_confidence: effectiveConfidence,
    effective_source: source,
    cross_check: crossCheck,
  };

  return { row, diag };
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  cap: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;
  let inFlight = 0;
  let resolved = 0;
  return new Promise<T[]>((resolveAll, rejectAll) => {
    const launch = () => {
      while (inFlight < cap && nextIdx < tasks.length) {
        const i = nextIdx++;
        inFlight++;
        tasks[i]().then(
          (v) => {
            results[i] = v;
            inFlight--;
            resolved++;
            if (resolved === tasks.length) resolveAll(results);
            else launch();
          },
          (e) => rejectAll(e),
        );
      }
    };
    launch();
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
