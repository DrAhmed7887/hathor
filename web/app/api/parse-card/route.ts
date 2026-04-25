/**
 * HATHOR card-parse — single vision call, structured output.
 *
 * Posture: TRUST THE MODEL. One Claude Opus 4.7 vision call reads the
 * entire card and emits per-row structured JSON with confidence and
 * plain-language reasoning. Row emission is unconditional on template
 * recognition — Opus reads any vaccination card, in any country, in
 * any layout. Rows with confidence < 0.85 route to HITL review
 * downstream (Phase D safety loop); this route does NOT gate anything
 * itself, its contract is "extract and report honestly."
 *
 * No template-anchored ROI cascade, no rescue paths, no fragment
 * promotion bridges. Those were workarounds for an over-cautious
 * prompt. The prompt was rewritten to emit rows unconditionally; the
 * scaffolding is gone.
 *
 * Wire:
 *   Request:  multipart/form-data
 *     - file                   (required)  image blob from RedactionCanvas
 *     - source_country         (optional)  free-text country name or
 *                                          ISO code (hint only)
 *     - card_language          (optional)  "en" | "ar" | "fr" | "mixed"
 *     - child_dob              (optional)  YYYY-MM-DD (audit context only)
 *   Response: application/json matching lib/types.ts ParsedCardOutput.
 *
 * Structured output is enforced via a forced tool call (tool_choice:
 * {type: "tool"}). Tool use is more reliable than free-form JSON
 * post-processing — the model cannot return an object that violates
 * the input_schema and be accepted.
 *
 * Model: claude-opus-4-7 (per build spec). HATHOR_CARD_MODEL env
 * override for testing.
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
import type { DoseKind, ParsedCardOutput, ParsedCardRow } from "@/lib/types";
import { CARD_EXTRACTION_SYSTEM_PROMPT } from "@/lib/card-extraction-prompt";
import {
  normalizeDocumentIntelligence,
  type LayoutAnalysisResult,
} from "@/lib/document-intelligence";
import {
  buildVisits,
  predictedSubkindOf,
  predictionIdOf,
  slotStateOf,
} from "@/lib/slot-state";
import {
  applyNormalizationsToRows,
  normalizeAntigens,
} from "@/lib/antigen-normalizer";

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
              type: ["object", "null"],
              description:
                "Optional normalized [0,1] rectangle covering the row on the full image. Null when you cannot confidently place a bounding box (e.g. dense table with row-level coordinates you cannot estimate). Do NOT skip a row because you cannot supply this field.",
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
  image_crop_region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
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

// Whole-card fallback crop when the model omits image_crop_region. The
// HITL UI uses this rect to render the row's image; an over-broad
// fallback is fine — better than dropping the row.
const DEFAULT_CROP_REGION = { x: 0, y: 0, width: 1, height: 1 } as const;

function toParsedRow(row: ToolRow): ParsedCardRow {
  return {
    antigen: row.antigen,
    date: row.date,
    doseNumber: row.dose_number,
    doseKind: coerceDoseKind(row.dose_kind),
    lotNumber: row.lot_number ?? null,
    confidence: row.confidence,
    reasoningIfUncertain: row.reasoning_if_uncertain,
    imageCropRegion: row.image_crop_region ?? { ...DEFAULT_CROP_REGION },
    fieldConfidences: row.field_confidences,
  };
}

// ── Route handler ────────────────────────────────────────────────────────────

/** Progress event emitted to the SSE stream. The /scan UI renders these as
 * the live agent-thinking trail. JSON-only payload — keep keys stable. */
type ProgressEvent =
  | { kind: "status"; label: string; detail?: string }
  | { kind: "vision_start"; bytes: number; mediaType: string }
  | { kind: "vision_done"; rows: number }
  | { kind: "template"; id: string }
  | { kind: "normalize_start"; labels: number; model: string }
  | { kind: "normalize_done"; mapped: number; ms: number }
  | { kind: "result"; body: ParsedCardOutput }
  | { kind: "error"; message: string };

type Emit = (event: ProgressEvent) => void;

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

  // ?stream=1 returns SSE progress events ending in `event: result`. The
  // /scan UI uses this; legacy /demo POSTs without it and gets JSON.
  // Antigen normalizer (Haiku-4.5 sub-agent that maps trade names to
  // canonical antigens) is ON by default. Disable per-deployment with
  // HATHOR_ANTIGEN_NORMALIZER=0 or per-request with ?normalize=0. The
  // normalizer is purely additive: it attaches canonicalAntigens hints
  // to rows without changing antigen text, confidence, source, or any
  // AMBER / clinician-confirmation behavior. On any failure the route
  // falls back to the un-normalized rows.
  const url = new URL(request.url);
  const wantStream = url.searchParams.get("stream") === "1";
  const normalizeMode =
    url.searchParams.get("normalize") !== "0" &&
    process.env.HATHOR_ANTIGEN_NORMALIZER !== "0";

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

  // Inner work: takes an emitter that reports progress. Returns the final
  // ParsedCardOutput. Used by both the JSON path (collect-then-respond)
  // and the SSE path (emit-as-you-go).
  const doWork = async (emit: Emit): Promise<ParsedCardOutput> => {
    emit({
      kind: "vision_start",
      bytes: file.size,
      mediaType,
    });

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
      throw new Error(
        `model did not call record_card_extraction — stop_reason=${response.stop_reason}`,
      );
    }

    const input = toolUse.input as
      | { rows?: ToolRow[]; document_intelligence?: unknown }
      | undefined;
    const rawRows = input?.rows ?? [];
    const parsedRows = rawRows.map(toParsedRow);
    emit({ kind: "vision_done", rows: parsedRows.length });

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

    if (documentIntelligence?.recognized_template_id) {
      emit({
        kind: "template",
        id: documentIntelligence.recognized_template_id,
      });
    }

    // Vision rows are the final rows. No template-anchored ROI pass,
    // no template-inference rescue, no unknown-template fragment
    // bridge. The model emits every readable row in one call; per-row
    // confidence routes uncertain rows to AMBER review downstream.
    const finalRows = parsedRows;

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

    // Without template-anchored inference there are no template
    // age-labels to thread through; visits[] still groups by date and
    // co-administered antigens, just without the "2 months" / "4
    // months" pretty-print labels.
    const templateAgeLabels: Record<number, string> = {};

    // Haiku-4.5 antigen normalizer — CrossBeam-style sub-agent. Runs
    // on every row's transcribed antigen and attaches `canonicalAntigens`.
    // Opt-in (?normalize=1 or HATHOR_ANTIGEN_NORMALIZER=1) so a flaky
    // Haiku call cannot break the demo path. Failures are caught and
    // ignored — rows still flow downstream without the field.
    let rowsWithCanonical = finalizedRows;
    if (normalizeMode && finalizedRows.length > 0) {
      const labels = Array.from(
        new Set(finalizedRows.map((r) => r.antigen).filter((a) => !!a)),
      );
      if (labels.length > 0) {
        emit({
          kind: "normalize_start",
          labels: labels.length,
          model:
            process.env.HATHOR_NORMALIZER_MODEL ?? "claude-haiku-4-5-20251001",
        });
        const t0 = Date.now();
        try {
          const normalizations = await normalizeAntigens({
            labels,
            client,
          });
          rowsWithCanonical = applyNormalizationsToRows(
            finalizedRows,
            normalizations,
          );
          const mapped = normalizations.filter(
            (n) => n.canonical_antigens.length > 0,
          ).length;
          emit({
            kind: "normalize_done",
            mapped,
            ms: Date.now() - t0,
          });
        } catch (normErr) {
          const reason =
            normErr instanceof Error ? normErr.message : String(normErr);
          emit({
            kind: "status",
            label: "Antigen normalizer fallback",
            detail: reason,
          });
        }
      }
    }

    const visits = buildVisits(rowsWithCanonical, templateAgeLabels);

    const orientationWarning = documentIntelligence?.orientation_warning ?? null;
    const orientation_acknowledged = orientationWarning === null;

    const body: ParsedCardOutput = {
      rows: rowsWithCanonical,
      visits,
      orientation_acknowledged,
      audit_log: [],
      ...(documentIntelligence ? { documentIntelligence } : {}),
      model: MODEL,
      parsedAt: new Date().toISOString(),
    };

    // Diagnostic log — single line per upload so we can see at a glance
    // what came back without scraping the SSE stream. Vision rows ARE
    // the final rows now; the count is one number.
    const finalRowCount = finalizedRows.length;
    const di = documentIntelligence;
    const warningPreview = di
      ? di.warnings.slice(0, 3).map((w) => w.slice(0, 80)).join(" | ")
      : "";
    console.log(
      `[parse-card] rows=${finalRowCount} ` +
        `template=${di?.recognized_template_id ?? "none"} ` +
        `regions=${di?.regions.length ?? 0} fragments=${di?.evidence_fragments?.length ?? 0} ` +
        `orientation_warning=${di?.orientation_warning ? "yes" : "no"} ` +
        `warnings_preview="${warningPreview}"`,
    );

    emit({ kind: "result", body });
    return body;
  };

  // ── Stream dispatch ──
  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ProgressEvent) => {
          const payload = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        };
        try {
          await doWork(send);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "unknown error";
          send({ kind: "error", message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Buffered JSON dispatch (legacy /demo path) ──
  try {
    // No-op emitter — collect everything, return only the final body.
    const body = await doWork(() => {});
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json(
      { error: `vision call failed: ${message}` },
      { status: 502 },
    );
  }
}
