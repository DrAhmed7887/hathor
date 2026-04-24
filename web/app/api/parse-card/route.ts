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
import type { ParsedCardOutput, ParsedCardRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const MODEL = process.env.HATHOR_CARD_MODEL ?? "claude-opus-4-7";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are HATHOR's card-extraction vision model. Your one job: read a paper vaccination card image and return every visible vaccination row as structured JSON via the record_card_extraction tool.

You are NOT interpreting the schedule. You are NOT recommending catch-up doses. You are NOT validating whether a dose is correct. Downstream code does that — your job ends at "what is on the paper."

EXTRACTION RULES — apply without exception:

1. One row per administered dose. If the card has a table with N filled rows, emit N rows. Blank rows are NOT emitted.

2. For each row, populate:
   - antigen: the canonical code. Prefer these labels where applicable:
       BCG, HepB, OPV, IPV, DTP (for any DTP / DTaP / DTwP / pentavalent
       DTP-containing product), Hib, PCV, Rotavirus, MMR, Measles, HepA,
       Varicella, MenACWY. If the card prints a brand name or local
       abbreviation, map it to the closest canonical code. If you cannot
       map it, emit the raw printed label verbatim.
   - date: the date of administration as YYYY-MM-DD. If the date is
     ambiguous, illegible, or missing, emit null — do NOT guess. If
     the card uses day/month/year order, convert; if the order itself
     is ambiguous (e.g., "05/04/24"), emit null and explain.
   - dose_number: the dose position within the series as shown on the
     card (1, 2, 3, …). If not indicated, emit null — do NOT infer
     from date order.
   - lot_number: the batch/lot number if legible; otherwise null.
   - confidence: your aggregate confidence for the row in [0,1].
     Calibrate honestly:
       >= 0.95  — printed text, clear contrast, no overlap
       0.85-0.94 — legible handwriting, standard format
       0.60-0.84 — partial occlusion, faded ink, ambiguous digit
       < 0.60   — significant doubt on a field that matters clinically
     Downstream will route anything below 0.85 to a clinician for review.
   - reasoning_if_uncertain: when confidence < 0.85, return a concise
     plain-language reason the physician can audit at a glance. Example:
     "Facility stamp overlaps the year digit; ambiguous between 2021
     and 2024." Do NOT return filler like "some uncertainty." The
     physician uses this to decide in one second whether to re-read.
     When confidence >= 0.85, you may return null.
   - image_crop_region: the rectangle on the card that this row occupies,
     in NORMALIZED coordinates where {x: 0, y: 0} is the top-left of
     the full image and {x: 1, y: 1} is the bottom-right. This drives
     the per-field crop UI required by PRD §5.6. Include the row's
     label and data cells — not just the date.
   - field_confidences: optional per-cell confidences for antigen,
     date, dose_number, lot_number. Include when a row is confident
     overall except for one specific cell.

3. Output order matches the card's row order (top-to-bottom as read).

4. Do not invent rows. If the card has scratched-out or crossed-through
   entries, skip them — they are not administered doses.

5. If the image is not a vaccination card at all (e.g., a photo of a
   landscape, an unrelated medical document), return an empty rows
   array. Do not fabricate.`;

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

function toParsedRow(row: ToolRow): ParsedCardRow {
  return {
    antigen: row.antigen,
    date: row.date,
    doseNumber: row.dose_number,
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
