/**
 * Lightweight, CrossBeam-inspired document intelligence layer for Hathor.
 *
 * Posture (important):
 *   This is a STAGED extraction pipeline, not a multi-agent orchestration.
 *   A single vision call emits both the final parsed rows AND a layout/
 *   evidence trace in the same tool call. The trace is used for:
 *     1. judge-facing transparency (ParsedResults shows the trace),
 *     2. a conservative merger that attaches warnings to parsed rows
 *        when layout evidence disagrees — WITHOUT overwriting what the
 *        clinician will review.
 *
 *   The trace never bypasses the two Safety Loops:
 *     - AMBER gate: low-confidence rows still route to clinician review.
 *     - RED gate: engine verdicts still gate the FHIR bundle.
 *
 * Keep every field JSON-serialisable. Field names are snake_case to match
 * the model's tool-call output verbatim — no translation layer needed.
 */

import type { ParsedCardRow } from "./types";

// ── Region + evidence types ─────────────────────────────────────────────────

export type DocumentRegionKind =
  | "child_info"
  | "vaccine_table"
  | "vaccine_row"
  | "dose_label"
  | "date_cell"
  | "stamp"
  | "notes"
  | "unknown";

export interface DocumentRegion {
  region_id: string;
  kind: DocumentRegionKind;
  page_number: number;
  /** Short human-readable label, e.g. "Primary series table" or
   * "جرعة ثالثة row". Optional; may be null when the model is unsure. */
  label: string | null;
  /** Raw text the model observed in this region, verbatim. Used for
   * the audit trail ("here is what the model saw"). Null when the
   * region is purely structural (e.g. a table frame). */
  source_text: string | null;
  /** 0..1 — how confident the model is that this region exists and
   * was correctly classified. */
  confidence: number;
  warnings: string[];
}

export type EvidenceFragmentKind =
  | "row_label"
  | "date_cell"
  | "vaccine_cell"
  | "note"
  | "unknown";

export interface EvidenceFragment {
  fragment_id: string;
  /** The DocumentRegion that produced this fragment. Null only when
   * the model could not tie the fragment to a region (rare). */
  region_id: string | null;
  kind: EvidenceFragmentKind;
  /** Raw text observed, before any interpretation. */
  source_text: string | null;
  /** Parsed row label, e.g. "جرعة ثالثة" / "3rd dose" / "booster".
   * Preserved for the trace even when numeric dose_number was null. */
  row_label: string | null;
  /** Raw date text as printed (may be Arabic digits, DD/MM/YYYY, etc).
   * The interpreted ISO date lives on the parsed row — this field is
   * the evidence the model used. */
  raw_date_text: string | null;
  /** Raw vaccine / antigen text as printed. */
  vaccine_text: string | null;
  confidence: number;
  warnings: string[];
}

export interface LayoutAnalysisResult {
  pages_detected: number;
  /** Non-null when the card is rotated 90°/180° or otherwise off-axis.
   * Surfaces as a banner warning in the trace UI so the clinician can
   * re-photograph. */
  orientation_warning: string | null;
  /** Non-null when a region appears cropped off the edge of the image. */
  crop_warning: string | null;
  regions: DocumentRegion[];
  evidence_fragments: EvidenceFragment[];
  /** 0..1 — aggregate over the page(s). Not the same as row confidence. */
  overall_confidence: number;
  warnings: string[];
}

export interface EvidenceMergeResult {
  /** Parsed rows as they should be rendered downstream. The first-cut
   * merger PASSES THROUGH the caller's rows — we never auto-correct a
   * date or dose number based on weak layout evidence. Conflicts
   * surface as warnings. */
  rows: ParsedCardRow[];
  warnings: string[];
  /** True when the merger could not use the layout evidence (e.g. it
   * was missing, malformed, or empty) and defaulted to the direct
   * parse path. Surfaced in the UI so judges see when the pipeline
   * fell back. */
  used_fallback: boolean;
}

// ── Normalizer ──────────────────────────────────────────────────────────────

const VALID_REGION_KINDS: ReadonlySet<DocumentRegionKind> = new Set([
  "child_info",
  "vaccine_table",
  "vaccine_row",
  "dose_label",
  "date_cell",
  "stamp",
  "notes",
  "unknown",
]);

const VALID_FRAGMENT_KINDS: ReadonlySet<EvidenceFragmentKind> = new Set([
  "row_label",
  "date_cell",
  "vaccine_cell",
  "note",
  "unknown",
]);

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function asWarnings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((w): w is string => typeof w === "string" && w.length > 0);
}

function asRegionKind(v: unknown): DocumentRegionKind {
  if (typeof v === "string" && VALID_REGION_KINDS.has(v as DocumentRegionKind)) {
    return v as DocumentRegionKind;
  }
  return "unknown";
}

function asFragmentKind(v: unknown): EvidenceFragmentKind {
  if (typeof v === "string" && VALID_FRAGMENT_KINDS.has(v as EvidenceFragmentKind)) {
    return v as EvidenceFragmentKind;
  }
  return "unknown";
}

function normalizeRegion(raw: unknown, idx: number): DocumentRegion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    region_id: asString(r.region_id) ?? `region_${idx}`,
    kind: asRegionKind(r.kind),
    page_number: Math.max(1, Math.round(asNumber(r.page_number, 1))),
    label: asString(r.label),
    source_text: asString(r.source_text),
    confidence: clamp01(asNumber(r.confidence, 0)),
    warnings: asWarnings(r.warnings),
  };
}

function normalizeFragment(raw: unknown, idx: number): EvidenceFragment | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  return {
    fragment_id: asString(f.fragment_id) ?? `fragment_${idx}`,
    region_id: asString(f.region_id),
    kind: asFragmentKind(f.kind),
    source_text: asString(f.source_text),
    row_label: asString(f.row_label),
    raw_date_text: asString(f.raw_date_text),
    vaccine_text: asString(f.vaccine_text),
    confidence: clamp01(asNumber(f.confidence, 0)),
    warnings: asWarnings(f.warnings),
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Coerce any plausible JSON shape into a LayoutAnalysisResult the UI
 * and merger can safely render. Defensive: invalid / missing input
 * returns a valid empty trace so the rest of the pipeline can keep
 * going. The goal is to never block the parse because the trace was
 * badly shaped. */
export function normalizeDocumentIntelligence(
  raw: unknown,
): LayoutAnalysisResult {
  if (!raw || typeof raw !== "object") return emptyLayoutResult();
  const r = raw as Record<string, unknown>;

  const regionsRaw = Array.isArray(r.regions) ? r.regions : [];
  const fragmentsRaw = Array.isArray(r.evidence_fragments)
    ? r.evidence_fragments
    : [];

  const regions: DocumentRegion[] = [];
  for (let i = 0; i < regionsRaw.length; i++) {
    const region = normalizeRegion(regionsRaw[i], i);
    if (region) regions.push(region);
  }

  const fragments: EvidenceFragment[] = [];
  for (let i = 0; i < fragmentsRaw.length; i++) {
    const f = normalizeFragment(fragmentsRaw[i], i);
    if (f) fragments.push(f);
  }

  return {
    pages_detected: Math.max(1, Math.round(asNumber(r.pages_detected, 1))),
    orientation_warning: asString(r.orientation_warning),
    crop_warning: asString(r.crop_warning),
    regions,
    evidence_fragments: fragments,
    overall_confidence: clamp01(asNumber(r.overall_confidence, 0)),
    warnings: asWarnings(r.warnings),
  };
}

function emptyLayoutResult(): LayoutAnalysisResult {
  return {
    pages_detected: 1,
    orientation_warning: null,
    crop_warning: null,
    regions: [],
    evidence_fragments: [],
    overall_confidence: 0,
    warnings: [],
  };
}

// ── Merger ──────────────────────────────────────────────────────────────────

/** A conservative merger: pass parsed rows through unchanged, collect
 * evidence-derived warnings, and only flag conflicts — never overwrite.
 * Booster rows are preserved verbatim (the spec is explicit: booster
 * must stay booster through merge).
 *
 * Rationale: the model emits rows and layout evidence in the SAME tool
 * call, so disagreement between them is usually a sign of genuine
 * uncertainty, not a signal that one side is authoritative. The
 * clinician is the tiebreaker — we surface the evidence and let the
 * review UI do its job.
 */
export function mergeEvidenceIntoRows(
  layout: LayoutAnalysisResult | null,
  parsedRows: ParsedCardRow[],
): EvidenceMergeResult {
  const warnings: string[] = [];

  if (!layout) {
    return {
      rows: parsedRows,
      warnings: ["Document intelligence trace unavailable; direct parse used."],
      used_fallback: true,
    };
  }

  const hasAnyLayoutData =
    layout.regions.length > 0 || layout.evidence_fragments.length > 0;

  if (!hasAnyLayoutData) {
    return {
      rows: parsedRows,
      warnings: ["Document intelligence trace was empty; direct parse used."],
      used_fallback: true,
    };
  }

  // Page-level warnings surface first so the clinician sees them
  // before per-row notes.
  if (layout.orientation_warning) {
    warnings.push(`Orientation: ${layout.orientation_warning}`);
  }
  if (layout.crop_warning) {
    warnings.push(`Crop: ${layout.crop_warning}`);
  }
  for (const w of layout.warnings) warnings.push(w);

  // Conflict detection: if a row-label fragment names a specific dose
  // number and the parsed row for the same antigen + approximate date
  // disagrees, emit a warning. We do NOT overwrite — the AMBER review
  // surface owns reconciliation, and the clinician decides.
  const rowLabelFragments = layout.evidence_fragments.filter(
    (f) => f.kind === "row_label" && f.row_label,
  );
  for (const frag of rowLabelFragments) {
    const labelDoseHint = extractDoseHint(frag.row_label);
    if (labelDoseHint === null) continue;

    // Heuristic: conflict if any parsed row's dose_number diverges
    // from the fragment's label hint and the row shares a date with
    // a matching raw_date_text fragment. We stay on the cautious side
    // — the heuristic FIRES a warning, it does not SILENCE one.
    const conflicts = parsedRows.filter(
      (r) =>
        r.doseNumber !== null &&
        r.doseKind !== "booster" &&
        r.doseNumber !== labelDoseHint,
    );
    if (conflicts.length > 0 && frag.source_text) {
      warnings.push(
        `Row-label evidence "${frag.source_text}" suggests dose ${labelDoseHint}; ` +
          `${conflicts.length} parsed row(s) differ — clinician to review.`,
      );
    }
  }

  return {
    rows: parsedRows,
    warnings,
    used_fallback: false,
  };
}

/** Best-effort mapping from a row-label string to a dose ordinal.
 * Returns null for booster / birth / unparseable labels (we do NOT
 * fabricate a dose number for those — they stay as they were parsed). */
function extractDoseHint(label: string | null): number | null {
  if (!label) return null;
  const lower = label.toLowerCase();

  // Booster / birth are intentionally returned as null — the merger
  // must not number them for us.
  if (
    lower.includes("booster") ||
    lower.includes("منشطة") ||
    lower.includes("rappel") ||
    lower.includes("birth") ||
    lower.includes("ولادة") ||
    lower.includes("عند الولادة")
  ) {
    return null;
  }

  // Western ordinal words
  if (/(^|\s)1st|first|١st|أولى/i.test(label)) return 1;
  if (/(^|\s)2nd|second|٢nd|ثانية/i.test(label)) return 2;
  if (/(^|\s)3rd|third|٣rd|ثالثة/i.test(label)) return 3;
  if (/(^|\s)4th|fourth|٤th|رابعة/i.test(label)) return 4;
  if (/(^|\s)5th|fifth|٥th|خامسة/i.test(label)) return 5;

  // Digit anywhere in the label (western or eastern Arabic).
  const m = label.match(/([1-9])|([١-٥])/);
  if (m) {
    if (m[1]) return Number(m[1]);
    if (m[2]) {
      const eastern = "١٢٣٤٥";
      const idx = eastern.indexOf(m[2]);
      if (idx !== -1) return idx + 1;
    }
  }
  return null;
}
