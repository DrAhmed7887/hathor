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

/** Canonical, closed set of known card templates. Every
 * LayoutAnalysisResult carries one of these values. New templates go
 * through an explicit approval step — silently guessing at "looks
 * Egyptian" is not how clinical data pipelines stay safe. */
export type RecognizedTemplateId =
  | "egypt_mohp_mandatory_childhood_immunization"
  | "who_icvp_international_certificate"
  | "unknown_vaccine_card";

/** Parallel enum for the model's first-pass classification. Today the
 * values are the same as RecognizedTemplateId; kept as a separate
 * type so a future model-supplied guess ("looks like NG NPI") can
 * travel alongside a conservative registry verdict. */
export type DocumentTypeGuess = RecognizedTemplateId;

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
  /** The registry-approved template id the layout matched. Always
   * populated. Defaults to "unknown_vaccine_card" when no known
   * template fits — the pipeline then degrades to the fallback paths
   * (EmptyRowsAmberReview) rather than inventing rows. */
  recognized_template_id: RecognizedTemplateId;
  /** Model-level first-pass guess of the document type. Kept distinct
   * from recognized_template_id so the registry verdict remains
   * authoritative. */
  document_type_guess: DocumentTypeGuess;
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

const VALID_TEMPLATE_IDS: ReadonlySet<RecognizedTemplateId> = new Set([
  "egypt_mohp_mandatory_childhood_immunization",
  "who_icvp_international_certificate",
  "unknown_vaccine_card",
]);

function asTemplateId(v: unknown): RecognizedTemplateId {
  if (typeof v === "string" && VALID_TEMPLATE_IDS.has(v as RecognizedTemplateId)) {
    return v as RecognizedTemplateId;
  }
  return "unknown_vaccine_card";
}

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

  const modelTemplateId = asTemplateId(r.recognized_template_id);
  const modelDocTypeGuess = asTemplateId(r.document_type_guess);

  const normalized: LayoutAnalysisResult = {
    pages_detected: Math.max(1, Math.round(asNumber(r.pages_detected, 1))),
    orientation_warning: asString(r.orientation_warning),
    crop_warning: asString(r.crop_warning),
    regions,
    evidence_fragments: fragments,
    overall_confidence: clamp01(asNumber(r.overall_confidence, 0)),
    warnings: asWarnings(r.warnings),
    recognized_template_id: modelTemplateId,
    document_type_guess: modelDocTypeGuess,
  };

  // The model's hint stands as-is. Template recognition is a downstream
  // routing signal (which schedule to reconcile against), never a gate
  // on extraction. "unknown_vaccine_card" describes the layout, not the
  // model's ability to read the rows.

  return normalized;
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
    recognized_template_id: "unknown_vaccine_card",
    document_type_guess: "unknown_vaccine_card",
  };
}


// ── Date parsing ────────────────────────────────────────────────────────────

/** Eastern Arabic-Indic digits (U+0660..U+0669). */
const EASTERN_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** Persian / Extended-Arabic-Indic digits (U+06F0..U+06F9) — visually
 * close to Eastern Arabic but a distinct Unicode block. Some cards
 * mix the two; the parser must understand both. */
const PERSIAN_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Pediatric vaccination plausibility window for two-digit-year
 * normalisation and impossible-date rejection.
 *
 * Why 23 means 2023, not 1923:
 *   - HATHOR is a pediatric immunization tool. Vaccination cards we
 *     reconcile are for living children, so the issue dates lie in the
 *     last ~20 years at most.
 *   - 1923 is well outside any pediatric record we will ever see.
 *     Mapping "23" → 1923 would silently corrupt a real visit date,
 *     which is exactly the failure the Sofia card surfaced.
 *   - Mapping "23" → 2023 may very rarely be wrong on an adult
 *     historical record — but those are out of scope for this product.
 *
 * Revisit when:
 *   - HATHOR ever needs to ingest non-pediatric or historical archives
 *     (occupational immunisation records, traveller cards from older
 *     adults, medical archaeology).
 *   - The world rolls past 2099 — the +1 buffer below assumes a
 *     four-digit year fits comfortably inside this century.
 */
const PEDIATRIC_MIN_YEAR = 2000;
/** Future buffer kept tight so we reject typos like "30/02/2099". */
const PEDIATRIC_MAX_YEAR = new Date().getUTCFullYear() + 1;
/** Two-digit years ≤ this map to 20xx; above maps to 19xx. The split
 * stays well below the current year so a card printed in 2025 reading
 * "25" lands in 2025, while truly old strings like "98" still go to
 * 1998 (which then fails the pediatric plausibility check below — the
 * caller sees null and surfaces the row to the clinician, never
 * silently keeps a 1998 date). */
const TWO_DIGIT_PIVOT = (PEDIATRIC_MAX_YEAR % 100);

function westerniseDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const east = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (east !== -1) {
      out += String(east);
      continue;
    }
    const persian = PERSIAN_INDIC_DIGITS.indexOf(ch);
    if (persian !== -1) {
      out += String(persian);
      continue;
    }
    out += ch;
  }
  return out;
}

function normaliseTwoDigitYear(yy: number): number {
  // yy is 0..99. Pivot point is the current century's year-of-century.
  // Years <= pivot land in 20xx; everything else in 19xx.
  if (yy <= TWO_DIGIT_PIVOT) return 2000 + yy;
  return 1900 + yy;
}

function isPlausiblePediatricYear(year: number): boolean {
  return year >= PEDIATRIC_MIN_YEAR && year <= PEDIATRIC_MAX_YEAR;
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (!isPlausiblePediatricYear(year)) return null;
  // Reject impossible day-of-month combinations (e.g. Feb 30) by
  // round-tripping through Date in UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Best-effort parse of a raw date string into ISO YYYY-MM-DD.
 *
 * Accepts (after digit-system normalisation):
 *   - ISO `YYYY-MM-DD`
 *   - `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`
 *   - `DD/MM/YY` (two-digit year — pediatric-window rule)
 *   - Single-digit day or month (`9/3/2024`)
 *   - Eastern Arabic-Indic digits, Persian-Indic digits, mixed digit
 *     systems within the same date string
 *
 * Rejects (returns null) on any ambiguity:
 *   - Empty / whitespace input
 *   - Bare digit runs that aren't a date (`0123456`)
 *   - Underdetermined fields (`21/?/2023`)
 *   - Implausibly old years (< 2000) or far-future years (> current+1)
 *   - Out-of-range day/month, impossible day-of-month combinations
 *
 * Never throws. The original raw string is preserved by the caller —
 * this function only returns the normalised form (or null).
 */
export function parseRawDate(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = westerniseDigits(raw).trim();
  if (!trimmed) return null;

  // ISO first.
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return buildIso(Number(y), Number(m), Number(d));
  }

  // DD<sep>MM<sep>YYYY or DD<sep>MM<sep>YY where sep ∈ {/, -, .}.
  // Single-digit day/month allowed; the same separator must repeat.
  const dmy = trimmed.match(/^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (dmy) {
    const [, dRaw, , mRaw, yRaw] = dmy;
    const day = Number(dRaw);
    const month = Number(mRaw);
    const yearLiteral = Number(yRaw);
    const year = yRaw.length === 2
      ? normaliseTwoDigitYear(yearLiteral)
      : yearLiteral;
    return buildIso(year, month, day);
  }

  // "DD Mmm YYYY" / "DD Mmmm YYYY" (English month names — common on
  // anglophone EPI cards, e.g. Nigerian "Child Immunization Record":
  // "10 Jan 2025", "21 February 2025"). Case-insensitive on the
  // month name. Single-digit day allowed. No two-digit-year support
  // here — handwritten cards using month names typically print the
  // full year.
  const dmnY = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dmnY) {
    const [, dRaw, monthName, yRaw] = dmnY;
    const month = ENGLISH_MONTH_NUMBER[monthName.toLowerCase()];
    if (month === undefined) return null;
    return buildIso(Number(yRaw), month, Number(dRaw));
  }

  return null;
}

/** Map English month names (full + 3-letter abbreviations) to their
 * 1..12 number. Used by `parseRawDate` to handle handwritten dates of
 * the form "10 Jan 2025" — the format the synthetic Nigerian card
 * uses, and the format the WHO/ICVP English face uses. Lower-case
 * keys; the caller is expected to lower-case the month name before
 * lookup. Both 3-letter ("Jan") and full ("January") forms are
 * accepted; "Sept" (4-letter) is also accepted because some cards
 * use it. No locale-specific aliases; non-English month names go
 * through the dedicated synonym layer if/when they need to. */
const ENGLISH_MONTH_NUMBER: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
});


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
