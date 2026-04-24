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
import type { DoseKind, ParsedCardOutput, ParsedCardRow } from "@/lib/types";
import { CARD_EXTRACTION_SYSTEM_PROMPT } from "@/lib/card-extraction-prompt";

export const runtime = "nodejs";
export const maxDuration = 90;

const MODEL = process.env.HATHOR_CARD_MODEL ?? "claude-opus-4-7";
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

    const input = toolUse.input as { rows?: ToolRow[] } | undefined;
    const rawRows = input?.rows ?? [];
    const parsedRows = rawRows.map(toParsedRow);

    const body: ParsedCardOutput = {
      rows: parsedRows,
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
