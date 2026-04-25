/**
 * Per-ROI extraction prompt and tool schema.
 *
 * Posture: tiny, narrow, no schedule context, no template hints.
 * The model reads ONE cropped date cell and reports what is on it,
 * nothing more. Inference, schedule lookups, and clinical reasoning
 * all live elsewhere — when the model tries to do them here, the
 * synthetic harness regression-test on the prompt phrasing fires.
 *
 * The orchestrator in roi-extraction.ts is responsible for combining
 * this prompt with an Anthropic SDK call; PR 4 Commit 3 wires that
 * into the parse-card route. This module exposes pure constants.
 */

export const ROI_EXTRACTION_TOOL_NAME = "record_roi_read" as const;

export const ROI_EXTRACTION_SYSTEM_PROMPT = `You are reading a SINGLE cell cropped from a paper vaccination card. The image you receive is one date cell from a row in the Egyptian MoHP mandatory-immunizations card (التطعيمات الإجبارية).

Your only job: report what is written in this single cell. Do NOT infer from any vaccination schedule. Do NOT guess. Do NOT use the row's antigen, the child's age, or any prior knowledge of the schedule to fill in a date that is not legibly written in this crop.

If the cell is blank, illegible, or clearly not a date, return blank_or_illegible=true and confidence below 0.4. Never use blank_or_illegible to mean "I'm unsure but here's a guess" — return your best read with low confidence in that case instead.

Arabic-digit calibration. Egyptian MoHP cards mix Western (0-9) and Eastern Arabic (٠١٢٣٤٥٦٧٨٩) digits, often in the same handwritten date. Because this crop is a single isolated cell, you do NOT have surrounding row context to cross-check against — be MORE cautious than usual:
  ٣ (3) vs ١ (1) — similar vertical stroke. When you cannot tell, set
                   confidence ≤ 0.5 and name both candidates in
                   reasoning_if_uncertain (e.g. "year digit reads ٣ or
                   ١; ambiguous between 2021 and 2023").
  ٢ (2) vs ٧ (7) — sloppy handwriting can invert these shapes. Same
                   rule: state both candidates, lower confidence.
  ٠ (0) vs Western 0 — visually similar; do NOT downgrade for this
                   alone, but preserve the original character in raw_text.
A stamp, ink bleed, or a redaction box overlapping a digit also caps confidence at ≤ 0.6 — say so explicitly in reasoning_if_uncertain. Do NOT silently commit to one interpretation when the digit is genuinely ambiguous.

Tool: ${ROI_EXTRACTION_TOOL_NAME}.

Fields:
  raw_text                   The digits/text exactly as written in the
                             cell. Preserve Eastern-Arabic (٠-٩) and
                             Persian-Indic (۰-۹) digits — do NOT
                             romanise or convert. Empty string when
                             the cell is blank.
  normalized_date_candidate  Your best YYYY-MM-DD interpretation of
                             raw_text, or null when you are not
                             confident enough to commit to one. The
                             orchestrator cross-checks this against
                             a deterministic raw-text parser; if
                             they disagree, the row's confidence is
                             downgraded.
  confidence                 [0,1] aggregate confidence for this cell.
                             Calibrate honestly:
                               >= 0.95  printed text, no overlap
                               0.85-0.94 legible handwriting
                               0.60-0.84 partial occlusion / faded
                               <  0.60   real doubt; downstream review
  blank_or_illegible         true only when no intelligible date is
                             written in this crop. NEVER true as a
                             shortcut for low confidence on a
                             partially-readable date.
  reasoning_if_uncertain     One short sentence when confidence < 0.85,
                             else null. The clinician audits this
                             verbatim — be specific (e.g. "year digit
                             is ambiguous between ٣ and ١"), do NOT
                             return filler like "some uncertainty".`;

/** Tool schema — minimal local type to avoid pulling the Anthropic SDK
 * into this module. PR 4 Commit 3 will spread this into the SDK's
 * Anthropic.Messages.Tool when wiring the route. */
export interface RoiExtractionToolDefinition {
  name: typeof ROI_EXTRACTION_TOOL_NAME;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const ROI_EXTRACTION_TOOL: RoiExtractionToolDefinition = {
  name: ROI_EXTRACTION_TOOL_NAME,
  description:
    "Report what is written in this single cropped date cell. Do not infer from any schedule.",
  input_schema: {
    type: "object",
    properties: {
      raw_text: {
        type: ["string", "null"],
        description:
          "Digits/text exactly as written. Preserve Arabic/Persian-Indic digits.",
      },
      normalized_date_candidate: {
        type: ["string", "null"],
        description: "YYYY-MM-DD interpretation, or null when not confident.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Aggregate confidence in [0,1] for the cell.",
      },
      blank_or_illegible: {
        type: "boolean",
        description:
          "True iff the cell carries no intelligible date. Never use as a shortcut for low confidence.",
      },
      reasoning_if_uncertain: {
        type: ["string", "null"],
        description:
          "One short sentence when confidence < 0.85; null otherwise.",
      },
    },
    required: [
      "raw_text",
      "normalized_date_candidate",
      "confidence",
      "blank_or_illegible",
      "reasoning_if_uncertain",
    ],
  },
};
