/**
 * HATHOR card-parse — single vision call, structured output.
 *
 * PRD §5.6 Vision Safety Loop (the EXTRACTION half): one Claude Opus 4.7
 * vision call reads the entire card and emits per-row structured JSON with
 * confidence and plain-language reasoning_if_uncertain. Rows with
 * confidence < 0.85 route to HITL review downstream (ParsedResults +
 * HITLPanel — step 7). This route does NOT gate anything itself; its
 * contract is "extract and report honestly" — the UI owns the threshold.
 *
 * Wire:
 *   Request:  multipart/form-data
 *     - file                   (required)  image blob from RedactionCanvas
 *     - source_country         (optional)  ISO 3166 alpha-2 (hint only)
 *     - card_language          (optional)  "en" | "ar" | "fr" | "mixed"
 *     - child_dob              (optional)  YYYY-MM-DD (audit context only)
 *   Response: application/json matching lib/types.ts ParsedCardOutput.
 *
 * Structured output is enforced via a forced tool call (tool_choice:
 * {type: "tool"}). Tool use is more reliable than free-form JSON
 * post-processing — the model cannot return an object that violates
 * the input_schema and be accepted.
 *
 * Model: claude-opus-4-7 (per build spec). Opus 4.7 stays the default
 * for vision + reasoning; the Haiku 4.5 override applies to chat intake
 * only. HATHOR_CARD_MODEL env override for testing.
 *
 * Runtime + duration per CLAUDE.md Next 16 notes:
 *   - runtime = 'nodejs' (Edge breaks Cache Components; SDK needs Node).
 *   - maxDuration = 90 — vision calls on card-dense images can take
 *     15-30s; 90s gives headroom without being unbounded.
 *
 * Base64 size note: the Messages API has a ~5 MB ceiling for inline
 * image blocks. RedactionCanvas emits 92%-quality JPEGs which are
 * typically 1-3 MB; if a caller posts a larger file we surface 413
 * rather than silently truncating. A server-side resize path using
 * the Files API is Phase 1.1.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { DoseKind, ParsedCardOutput, ParsedCardRow } from "@/lib/types";
import { CARD_EXTRACTION_SYSTEM_PROMPT } from "@/lib/card-extraction-prompt";
import {
  inferRowsFromTemplate,
  normalizeDocumentIntelligence,
  VACCINE_CARD_TEMPLATES,
  type LayoutAnalysisResult,
} from "@/lib/document-intelligence";
import {
  buildVisits,
  predictedSubkindOf,
  predictionIdOf,
  slotStateOf,
} from "@/lib/slot-state";
import {
  mergeRoiIntoVisionRows,
  shouldRunEgyptMohpRoi,
} from "@/lib/roi-merge";
import {
  runRoiExtraction,
  type Cropper,
  type RoiExtractionResult,
  type RoiReadResult,
  type RoiVisionCall,
} from "@/lib/roi-extraction";
import {
  ROI_EXTRACTION_SYSTEM_PROMPT,
  ROI_EXTRACTION_TOOL,
  ROI_EXTRACTION_TOOL_NAME,
} from "@/lib/roi-extraction-prompt";
import { loadEgyptMohpTemplate } from "@/lib/templates/egypt-mohp";

export const runtime = "nodejs";
export const maxDuration = 90;

const MODEL = process.env.HATHOR_CARD_MODEL ?? "claude-opus-4-7";
const ROI_MODEL = process.env.HATHOR_ROI_MODEL ?? MODEL;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// System prompt lives in lib/card-extraction-prompt.ts so its rules can be
// snapshot-tested without spinning up the full Next route module.
const SYSTEM_PROMPT = CARD_EXTRACTION_SYSTEM_PROMPT;

const VALID_DOSE_KINDS: ReadonlySet<DoseKind> = new Set([
  "primary",
  "booster",
  "birth",
  "unknown",
]);

// ── Tool schema (structured output) ──────────────────────────────────────────

const CARD_EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: "record_card_extraction",
  description:
    "Report every vaccination row observed on the card image, with per-row confidence and reasoning for any uncertain fields.",
  input_schema: {
    type: "object",
    properties: {
      document_intelligence: {
        type: "object",
        description:
          "Layout + evidence trace: decompose the card into regions, then tie row-label and date-cell observations to their regions. Used for judge-facing transparency and conservative evidence merging. Populating this field is encouraged but NOT required — a missing or partial trace must not block the parse.",
        properties: {
          pages_detected: { type: "integer", minimum: 1 },
          orientation_warning: { type: ["string", "null"] },
          crop_warning: { type: ["string", "null"] },
          overall_confidence: { type: "number", minimum: 0, maximum: 1 },
          warnings: { type: "array", items: { type: "string" } },
          recognized_template_id: {
            type: "string",
            enum: [
              "egypt_mohp_mandatory_childhood_immunization",
              "who_icvp_international_certificate",
              "unknown_vaccine_card",
            ],
            description:
              "Which registry template the card matches. 'egypt_mohp_mandatory_childhood_immunization' for the Egyptian MoHP mandatory-immunizations card (التطعيمات الإجبارية); 'unknown_vaccine_card' when unsure. The server re-checks this against the region source_text — do NOT invent a template match.",
          },
          document_type_guess: {
            type: "string",
            enum: [
              "egypt_mohp_mandatory_childhood_immunization",
              "who_icvp_international_certificate",
              "unknown_vaccine_card",
            ],
            description:
              "Your first-pass document-type guess. Use the same enum as recognized_template_id. 'unknown_vaccine_card' is the honest default when the card does not clearly match a known template.",
          },
          regions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                region_id: { type: "string" },
                kind: {
                  type: "string",
                  enum: [
                    "child_info",
                    "vaccine_table",
                    "vaccine_row",
                    "dose_label",
                    "date_cell",
                    "stamp",
                    "notes",
                    "unknown",
                  ],
                },
                page_number: { type: "integer", minimum: 1 },
                label: { type: ["string", "null"] },
                source_text: { type: ["string", "null"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                warnings: { type: "array", items: { type: "string" } },
              },
              required: ["region_id", "kind", "page_number", "confidence"],
            },
          },
          evidence_fragments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fragment_id: { type: "string" },
                region_id: { type: ["string", "null"] },
                kind: {
                  type: "string",
                  enum: [
                    "row_label",
                    "date_cell",
                    "vaccine_cell",
                    "note",
                    "unknown",
                  ],
                },
                source_text: { type: ["string", "null"] },
                row_label: { type: ["string", "null"] },
                raw_date_text: { type: ["string", "null"] },
                vaccine_text: { type: ["string", "null"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                warnings: { type: "array", items: { type: "string" } },
              },
              required: ["fragment_id", "kind", "confidence"],
            },
          },
        },
      },
      rows: {
        type: "array",
        description: "One entry per administered dose row visible on the card.",
        items: {
          type: "object",
          properties: {
            antigen: {
              type: "string",
              description:
                "Canonical antigen code (BCG, HepB, OPV, IPV, DTP, Hib, PCV, Rotavirus, MMR, Measles, HepA, Varicella, MenACWY) or raw printed label when no mapping fits.",
            },
            date: {
              type: ["string", "null"],
              description:
                "YYYY-MM-DD, or null if the date is ambiguous, illegible, or absent.",
            },
            dose_number: {
              type: ["integer", "null"],
              description:
                "Dose position as written on the card. Null if not indicated — do NOT infer.",
            },
            dose_kind: {
              type: "string",
              enum: ["primary", "booster", "birth", "unknown"],
              description:
                "Clinical class of the row: 'primary' for a numbered primary-series row, 'booster' for a booster/منشطة row, 'birth' for an explicit birth dose, 'unknown' when the card does not indicate. Do NOT force a booster into a numbered primary slot.",
            },
            lot_number: {
              type: ["string", "null"],
              description: "Batch/lot number if legible, else null.",
            },
            confidence: {
              type: "number",
              description: "Row-aggregate confidence in [0,1].",
              minimum: 0,
              maximum: 1,
            },
            reasoning_if_uncertain: {
              type: ["string", "null"],
              description:
                "Concise plain-language reason when confidence < 0.85; null otherwise.",
            },
            image_crop_region: {
              type: "object",
              description:
                "Normalized [0,1] rectangle covering the row on the full image.",
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                width: { type: "number", minimum: 0, maximum: 1 },
                height: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["x", "y", "width", "height"],
            },
            field_confidences: {
              type: "object",
              description:
                "Optional per-cell confidences when one cell diverges from the row aggregate.",
              properties: {
                antigen: { type: "number", minimum: 0, maximum: 1 },
                date: { type: "number", minimum: 0, maximum: 1 },
                dose_number: { type: "number", minimum: 0, maximum: 1 },
                lot_number: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          required: [
            "antigen",
            "date",
            "dose_number",
            "dose_kind",
            "confidence",
            "reasoning_if_uncertain",
            "image_crop_region",
          ],
        },
      },
    },
    required: ["rows"],
  },
};

// ── Tool call output → typed ParsedCardRow ──────────────────────────────────

interface ToolRow {
  antigen: string;
  date: string | null;
  dose_number: number | null;
  dose_kind?: string | null;
  lot_number?: string | null;
  confidence: number;
  reasoning_if_uncertain: string | null;
  image_crop_region: { x: number; y: number; width: number; height: number };
  field_confidences?: Partial<{
    antigen: number;
    date: number;
    dose_number: number;
    lot_number: number;
  }>;
}

function coerceDoseKind(raw: unknown): DoseKind {
  if (typeof raw === "string" && VALID_DOSE_KINDS.has(raw as DoseKind)) {
    return raw as DoseKind;
  }
  return "unknown";
}

function toParsedRow(row: ToolRow): ParsedCardRow {
  return {
    antigen: row.antigen,
    date: row.date,
    doseNumber: row.dose_number,
    doseKind: coerceDoseKind(row.dose_kind),
    lotNumber: row.lot_number ?? null,
    confidence: row.confidence,
    reasoningIfUncertain: row.reasoning_if_uncertain,
    imageCropRegion: row.image_crop_region,
    fieldConfidences: row.field_confidences,
  };
}

// ── Egypt MoHP per-row ROI extraction ───────────────────────────────────────
//
// Fires only when the whole-image trace recognises the Egyptian MoHP
// mandatory-immunizations card. Crops each canonical date ROI with sharp
// and runs a tiny per-cell vision call against it. The deterministic
// cross-checks live in `runRoiExtraction`; this helper is the I/O side.
//
// The route catches any error this raises and falls back to the existing
// inferRowsFromTemplate path — ROI is an additive accuracy lift, never a
// hard dependency.

async function runEgyptMohpRoi(
  imageBuffer: Buffer,
  client: Anthropic,
): Promise<RoiExtractionResult> {
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("sharp could not read image dimensions");
  }
  const template = loadEgyptMohpTemplate();

  const cropper: Cropper = async (img, rect) => {
    return sharp(img)
      .extract({
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      })
      .jpeg({ quality: 92 })
      .toBuffer();
  };

  const roiVision: RoiVisionCall = async (cropBytes) => {
    const base64 = cropBytes.toString("base64");
    const response = await client.messages.create({
      model: ROI_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: ROI_EXTRACTION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          ...(ROI_EXTRACTION_TOOL as unknown as Anthropic.Messages.Tool),
          cache_control: { type: "ephemeral" },
        },
      ],
      tool_choice: { type: "tool", name: ROI_EXTRACTION_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64,
              },
            },
          ],
        },
      ],
    });
    const tu = response.content.find((b) => b.type === "tool_use");
    if (!tu || tu.type !== "tool_use") {
      // Treat a missing tool call as a blank cell — the merger will not
      // patch a confident whole-image row from a blank ROI read.
      return {
        raw_text: null,
        normalized_date_candidate: null,
        confidence: 0,
        blank_or_illegible: true,
        reasoning_if_uncertain: "ROI vision call returned no tool_use block",
      } satisfies RoiReadResult;
    }
    return tu.input as RoiReadResult;
  };

  return runRoiExtraction({
    imageBuffer,
    mimeType: "image/jpeg",
    imageDimensions: { width: meta.width, height: meta.height },
    template,
    cropper,
    roiVision,
    concurrency: 4,
  });
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not set on the server" },
      { status: 500 },
    );
  }

  // Parse multipart/form-data
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return Response.json(
      { error: "missing `file` field in form data" },
      { status: 400 },
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      {
        error: `image is ${(file.size / 1024 / 1024).toFixed(1)} MB; max ${MAX_IMAGE_BYTES / 1024 / 1024} MB for inline vision. Larger images require Phase 1.1 Files-API handling.`,
      },
      { status: 413 },
    );
  }

  const mediaType = (file.type || "image/jpeg").toLowerCase();
  if (
    mediaType !== "image/jpeg" &&
    mediaType !== "image/png" &&
    mediaType !== "image/webp" &&
    mediaType !== "image/gif"
  ) {
    return Response.json(
      { error: `unsupported image type: ${mediaType}` },
      { status: 415 },
    );
  }

  const sourceCountry = form.get("source_country");
  const cardLanguage = form.get("card_language");
  const childDob = form.get("child_dob");

  // Read the blob into a base64 string for the Messages API image block.
  const arrayBuf = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString("base64");

  // Compose the user turn — image + a compact hint block. Hints are
  // ADVISORY: the model ignores them when the card disagrees. This is
  // PRD-intended (card-origin context flags alignment errors downstream).
  const hintLines: string[] = [];
  if (sourceCountry) hintLines.push(`Card origin country: ${sourceCountry}`);
  if (cardLanguage) hintLines.push(`Primary card language: ${cardLanguage}`);
  if (childDob) hintLines.push(`Child DOB (for date-plausibility): ${childDob}`);
  const hintText = hintLines.length
    ? `Intake hints (advisory — ignore if the card contradicts):\n${hintLines.join("\n")}`
    : "No intake hints — read the card as shown.";

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Prompt caching — system prompt and the tool schema are stable
      // across every card-parse call and worth caching.
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        { ...CARD_EXTRACTION_TOOL, cache_control: { type: "ephemeral" } },
      ],
      tool_choice: { type: "tool", name: "record_card_extraction" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp"
                  | "image/gif",
                data: base64,
              },
            },
            { type: "text", text: hintText },
          ],
        },
      ],
    });

    // Find the tool_use block — tool_choice forced it, so it must exist.
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return Response.json(
        {
          error:
            "model did not call record_card_extraction — unexpected stop reason",
          stop_reason: response.stop_reason,
        },
        { status: 502 },
      );
    }

    const input = toolUse.input as
      | { rows?: ToolRow[]; document_intelligence?: unknown }
      | undefined;
    const rawRows = input?.rows ?? [];
    const parsedRows = rawRows.map(toParsedRow);

    // Tolerant: the trace is nice-to-have. A missing or malformed
    // document_intelligence object normalises to an empty trace
    // rather than failing the parse. The UI reads used_fallback to
    // decide whether to show the trace panel or the fallback banner.
    let documentIntelligence: LayoutAnalysisResult | undefined;
    if (input && "document_intelligence" in input) {
      try {
        documentIntelligence = normalizeDocumentIntelligence(
          input.document_intelligence,
        );
      } catch {
        documentIntelligence = undefined;
      }
    }

    // Egypt MoHP ROI pass — primary fill for blanks and low-confidence
    // dates on this template. Sequenced AFTER the whole-image pass so
    // we only spend ROI compute on cards that recognised as Egypt
    // MoHP. Errors here NEVER degrade the whole-image rows: a thrown
    // ROI call is caught and folded into trace warnings, then the
    // existing inferRowsFromTemplate fallback runs as today.
    let mergedRows = parsedRows;
    const roiWarnings: string[] = [];
    if (
      documentIntelligence &&
      shouldRunEgyptMohpRoi(documentIntelligence.recognized_template_id)
    ) {
      try {
        const arrayBufferForRoi = arrayBuf;
        const roiBuffer = Buffer.from(arrayBufferForRoi);
        const roiResult = await runEgyptMohpRoi(roiBuffer, client);
        const merged = mergeRoiIntoVisionRows({
          template: loadEgyptMohpTemplate(),
          visionRows: parsedRows,
          roiRows: roiResult.rows,
        });
        mergedRows = merged.rows;
        roiWarnings.push(...merged.warnings);
      } catch (roiErr) {
        // Safe fallback: ROI failure leaves whole-image rows intact and
        // surfaces the reason in the trace so the clinician/judge can
        // see why ROI did not contribute on this card.
        const reason =
          roiErr instanceof Error ? roiErr.message : String(roiErr);
        roiWarnings.push(`Egypt MoHP ROI extraction failed: ${reason}`);
      }
    }

    // Narrow, safe template inference. Runs only when (a) the vision
    // pass returned zero rows AND (b) the normaliser recognised a
    // known template AND (c) there is date-cell evidence to map.
    // Produces AMBER-tagged rows the clinician must review before the
    // engine sees anything. Existing vision rows are NEVER overwritten.
    let finalRows = mergedRows;
    if (documentIntelligence) {
      const inference = inferRowsFromTemplate(
        documentIntelligence,
        mergedRows,
      );
      if (inference.inferred) {
        finalRows = inference.rows;
      }
      // Fold inference warnings into the trace's warnings array so the
      // UI's existing trace panel surfaces them in one place.
      if (inference.warnings.length > 0) {
        documentIntelligence = {
          ...documentIntelligence,
          warnings: [...documentIntelligence.warnings, ...inference.warnings],
        };
      }
      // Fold ROI per-row decisions into the same warnings stream — the
      // trace panel already renders this list, so judges and clinicians
      // see "Row N: date upgraded from ROI re-read" alongside any
      // template-inference notes.
      if (roiWarnings.length > 0) {
        documentIntelligence = {
          ...documentIntelligence,
          warnings: [...documentIntelligence.warnings, ...roiWarnings],
        };
      }
      // Emit any unmapped date texts into the trace warnings as well —
      // the user asked for them to be "listed in the trace", not made
      // into rows.
      if (inference.unmapped_date_texts.length > 0) {
        documentIntelligence = {
          ...documentIntelligence,
          warnings: [
            ...documentIntelligence.warnings,
            `Unmapped date-cell text: ${inference.unmapped_date_texts
              .map((t) => `"${t}"`)
              .join(", ")}.`,
          ],
        };
      }
    }

    // PR 2 wire-boundary finalization (design note §6.1, §6.2):
    //   - generate row_id (UUID v4) per row
    //   - derive slot_state and predicted_subkind
    //   - generate prediction_id (V:<frag> | T:<spec_idx>)
    //   - default clinician_action to "none"
    //   - build visits[] grouped by template_spec_index
    //   - init audit_log to []
    //   - init orientation_acknowledged from layout's orientation_warning
    const totalVisionRows = finalRows.filter((r) => {
      const src = r.source ?? "vision";
      return src === "vision" || src === "vision_low_confidence";
    }).length;

    const finalizedRows: ParsedCardRow[] = finalRows.map((r) => {
      const withId: ParsedCardRow = {
        ...r,
        row_id: r.row_id ?? randomUUID(),
        clinician_action: r.clinician_action ?? "none",
      };
      const state = slotStateOf(withId);
      const subkind =
        state === "predicted"
          ? r.predicted_subkind ?? predictedSubkindOf(withId, totalVisionRows)
          : null;
      return {
        ...withId,
        slot_state: state,
        predicted_subkind: subkind,
        prediction_id: r.prediction_id ?? predictionIdOf(withId),
      };
    });

    const templateAgeLabels: Record<number, string> =
      documentIntelligence
        ? Object.fromEntries(
            VACCINE_CARD_TEMPLATES[
              documentIntelligence.recognized_template_id
            ].row_specs.map((spec) => [spec.row_index, spec.age_label]),
          )
        : {};

    const visits = buildVisits(finalizedRows, templateAgeLabels);

    const orientationWarning = documentIntelligence?.orientation_warning ?? null;
    const orientation_acknowledged = orientationWarning === null;

    const body: ParsedCardOutput = {
      rows: finalizedRows,
      visits,
      orientation_acknowledged,
      audit_log: [],
      ...(documentIntelligence ? { documentIntelligence } : {}),
      model: MODEL,
      parsedAt: new Date().toISOString(),
    };

    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json(
      { error: `vision call failed: ${message}` },
      { status: 502 },
    );
  }
}
