/**
 * Haiku-4.5 antigen normalizer — CrossBeam-style task-specific sub-agent.
 *
 * Runs AFTER the Opus-4.7 vision pass and the ROI cascade have produced
 * `ParsedCardRow[]`. Takes each row's `transcribed_antigen` (trade name,
 * abbreviation, or transliterated label) and returns the canonical
 * antigens that row covers — e.g. "Hexyon" → ["DTP", "HepB", "Hib", "IPV"].
 *
 * Why a separate sub-agent:
 *   - Trade-name → antigen lookup is a deterministic perception task;
 *     it does not need Opus 4.7's reasoning depth.
 *   - Pre-resolving on parse means the downstream Opus agent (or the
 *     fast-path `/validate-schedule` engine) skips the obvious cases and
 *     reserves its tool budget for clinical decisions.
 *   - Mirrors CrossBeam's "fastest model for each subtask" pattern:
 *     Haiku 4.5 here, Opus 4.7 on synthesis.
 *
 * Safety posture:
 *   - This module is ADDITIVE, never authoritative. The deterministic
 *     `lookup_vaccine_equivalence` MCP tool in
 *     `api/src/hathor/tools/vaccine_lookup.py` remains the source of
 *     truth for clinical decisions.
 *   - On any failure (no API key, timeout, malformed response), this
 *     returns the input rows unchanged — never throws into the parse
 *     pipeline. The /api/parse-card route catches and ignores errors.
 *   - Disabled by default. Opt in with HATHOR_ANTIGEN_NORMALIZER=1 or
 *     query string ?normalize=1 on parse-card. Last-day demo flag.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ParsedCardRow } from "./types.ts";

export const DEFAULT_NORMALIZER_MODEL = "claude-haiku-4-5-20251001";

/** Canonical antigen codes the rest of Hathor speaks. The Haiku sub-agent
 * is constrained to emit only these strings — anything else is dropped
 * by `coerceCanonicalAntigens`. Keeping the set narrow is the safety
 * tradeoff for using a fast model: Haiku's job is to MATCH, not to
 * propose new categories. */
export const CANONICAL_ANTIGENS = [
  "BCG",
  "HepB",
  "OPV",
  "IPV",
  "DTP",
  "Hib",
  "PCV",
  "Rotavirus",
  "MMR",
  "Measles",
  "Mumps",
  "Rubella",
  "HepA",
  "Varicella",
  "MenACWY",
  "MenB",
  "YellowFever",
  "Cholera",
  "Typhoid",
  "Influenza",
  "HPV",
  "COVID-19",
] as const;

export type CanonicalAntigen = (typeof CANONICAL_ANTIGENS)[number];

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_ANTIGENS);

/** Tool schema enforced via tool_choice. The model cannot return an
 * object that violates input_schema, so the canonical-set constraint is
 * load-bearing. */
const NORMALIZER_TOOL: Anthropic.Messages.Tool = {
  name: "record_canonical_antigens",
  description:
    "For each input label (a trade name or abbreviation transcribed from a vaccination card), report the canonical antigens it covers using ONLY codes from the allowed enum.",
  input_schema: {
    type: "object",
    properties: {
      mappings: {
        type: "array",
        description:
          "One entry per input label, in the same order as the input. Empty `canonical_antigens` when the label cannot be mapped.",
        items: {
          type: "object",
          properties: {
            input: { type: "string" },
            canonical_antigens: {
              type: "array",
              items: {
                type: "string",
                enum: [...CANONICAL_ANTIGENS],
              },
            },
          },
          required: ["input", "canonical_antigens"],
        },
      },
    },
    required: ["mappings"],
  },
};

const SYSTEM_PROMPT = `You are a precise vaccine-label normalizer. The user gives you transcribed labels from a child's vaccination card — trade names ("Hexyon", "Pentavac"), abbreviations ("BCG", "OPV"), Arabic labels ("شلل أطفال", "حصبة"), or French/English mixes. Your job is to map each label to the canonical antigens it covers.

Rules:
- Use ONLY codes from the provided enum. Do not invent codes.
- Combination products expand to every antigen they contain. Examples:
  - "Hexyon" / "Hexavalent" → DTP, HepB, Hib, IPV
  - "Pentavac" / "Pentavalent" → DTP, HepB, Hib (no IPV)
  - "MMR" / "ROR" → Measles, Mumps, Rubella, MMR (include the combined code)
  - "MMRV" → Measles, Mumps, Rubella, MMR, Varicella
  - "Tdap" / "DTaP" / "DTwP" → DTP
  - "Td" → DTP (tetanus + diphtheria; emit DTP and let downstream rules decide)
- Standalone antigens map to themselves: "BCG" → BCG, "OPV" → OPV, "Yellow Fever" / "حمى صفراء" → YellowFever.
- If you cannot identify the label confidently, emit an empty canonical_antigens array — do NOT guess.
- Preserve the exact "input" string from the request in your response.

Return one mapping per input label, in the same order. No prose, no markdown — call the tool only.`;

export interface NormalizeAntigensInput {
  /** Raw labels from the card, in row order. Duplicates are allowed
   * and preserved; the caller is responsible for de-duping if it
   * matters for cost. */
  labels: string[];
  /** Defaults to claude-haiku-4-5-20251001. Override via the
   * HATHOR_NORMALIZER_MODEL env var or this argument. */
  model?: string;
  /** Anthropic SDK client. Tests inject a mock; the route reuses the
   * same client it built for the whole-image vision call. */
  client: Anthropic;
}

export interface NormalizedAntigen {
  input: string;
  canonical_antigens: CanonicalAntigen[];
}

/** Drop any string the tool emitted that is not in CANONICAL_SET. The
 * tool schema's enum guards against this, but it is cheap and explicit
 * to also re-validate at runtime — the schema can drift. */
function coerceCanonicalAntigens(values: unknown): CanonicalAntigen[] {
  if (!Array.isArray(values)) return [];
  const out: CanonicalAntigen[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    if (!CANONICAL_SET.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as CanonicalAntigen);
  }
  return out;
}

/** Call Haiku to normalize a batch of labels. Returns one entry per
 * input label, in the same order. Throws on transport / API failures —
 * caller (parse-card route) catches and degrades gracefully. */
export async function normalizeAntigens({
  labels,
  model,
  client,
}: NormalizeAntigensInput): Promise<NormalizedAntigen[]> {
  if (labels.length === 0) return [];

  const useModel =
    model ?? process.env.HATHOR_NORMALIZER_MODEL ?? DEFAULT_NORMALIZER_MODEL;

  const response = await client.messages.create({
    model: useModel,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [{ ...NORMALIZER_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: NORMALIZER_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Normalize these labels (in order):\n${labels
              .map((l, i) => `${i + 1}. ${JSON.stringify(l)}`)
              .join("\n")}`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `normalizer did not call ${NORMALIZER_TOOL.name} — stop_reason=${response.stop_reason}`,
    );
  }

  const input = toolUse.input as
    | { mappings?: Array<{ input?: unknown; canonical_antigens?: unknown }> }
    | undefined;
  const rawMappings = input?.mappings ?? [];

  // Build a map keyed by input string so we can preserve the caller's
  // ordering even if the model reorders or drops entries. Last write
  // wins on duplicates.
  const byInput = new Map<string, CanonicalAntigen[]>();
  for (const m of rawMappings) {
    if (typeof m.input !== "string") continue;
    byInput.set(m.input, coerceCanonicalAntigens(m.canonical_antigens));
  }

  return labels.map((label) => ({
    input: label,
    canonical_antigens: byInput.get(label) ?? [],
  }));
}

/** Attach normalized antigens to each row by matching on `antigen`.
 * Rows whose label was not in the normalizer's response (or whose
 * mapping came back empty) get `canonicalAntigens` left undefined —
 * downstream code treats absence as "use the deterministic tool." */
export function applyNormalizationsToRows(
  rows: ParsedCardRow[],
  normalizations: NormalizedAntigen[],
): ParsedCardRow[] {
  if (normalizations.length === 0) return rows;
  const byInput = new Map<string, CanonicalAntigen[]>();
  for (const n of normalizations) {
    if (n.canonical_antigens.length > 0) {
      byInput.set(n.input, n.canonical_antigens);
    }
  }
  return rows.map((row) => {
    const canonical = byInput.get(row.antigen);
    return canonical ? { ...row, canonicalAntigens: [...canonical] } : row;
  });
}
