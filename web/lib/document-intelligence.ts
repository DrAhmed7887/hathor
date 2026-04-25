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

import type { DoseKind, ParsedCardRow } from "./types";

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

  // Registry verdict is authoritative. If the model did not recognise a
  // template, run the content-based recogniser over source_text — that
  // way the pipeline is consistent even when the model omits the hint.
  if (normalized.recognized_template_id === "unknown_vaccine_card") {
    const fallback = recognizeTemplate(normalized);
    normalized.recognized_template_id = fallback;
    if (normalized.document_type_guess === "unknown_vaccine_card") {
      normalized.document_type_guess = fallback;
    }
  }

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

// ── Template registry ───────────────────────────────────────────────────────

/** One printed row on a vaccination card template. Each row produces
 * at most ONE inferred ParsedCardRow — the primary antigen stands in
 * for the age point, and co-administered antigens are surfaced to the
 * clinician via the row's reasoning_if_uncertain text. The clinician
 * then splits or edits as needed.
 *
 * This is a hackathon-scope simplification: Egyptian MoHP cards
 * administer multiple antigens per age but our ParsedCardRow is
 * one-antigen-per-row. The alternative — inventing one row per
 * antigen — would produce ~30 rows and push guesswork downstream. The
 * chosen shape matches Ahmed's "9 AMBER rows from 9 date cells"
 * acceptance and keeps the clinician in the loop on composition. */
export interface TemplateRowSpec {
  row_index: number;
  age_label: string;
  primary_antigen: string;
  /** Antigens administered on the same visit as the primary; rendered
   * in the inferred row's reasoning so the clinician sees the full
   * composition without having to consult the schedule from memory. */
  co_administered_antigens: string[];
  dose_kind: DoseKind;
  dose_number: number | null;
}

export interface VaccineCardTemplate {
  template_id: RecognizedTemplateId;
  display_name: string;
  row_specs: TemplateRowSpec[];
}

const EGYPT_MOHP_TEMPLATE: VaccineCardTemplate = {
  template_id: "egypt_mohp_mandatory_childhood_immunization",
  display_name:
    'Egyptian MoHP mandatory childhood immunization (التطعيمات الإجبارية)',
  row_specs: [
    {
      row_index: 0,
      age_label: "Birth / first 24h",
      primary_antigen: "HepB",
      co_administered_antigens: [],
      dose_kind: "birth",
      dose_number: 1,
    },
    {
      row_index: 1,
      age_label: "First week",
      primary_antigen: "OPV",
      co_administered_antigens: [],
      dose_kind: "birth",
      dose_number: null,
    },
    {
      row_index: 2,
      age_label: "First 15 days",
      primary_antigen: "BCG",
      co_administered_antigens: [],
      dose_kind: "birth",
      dose_number: 1,
    },
    {
      row_index: 3,
      age_label: "2 months",
      primary_antigen: "DTP",
      co_administered_antigens: ["OPV", "IPV", "PCV", "Rotavirus"],
      dose_kind: "primary",
      dose_number: 1,
    },
    {
      row_index: 4,
      age_label: "4 months",
      primary_antigen: "DTP",
      co_administered_antigens: ["OPV", "PCV", "Rotavirus"],
      dose_kind: "primary",
      dose_number: 2,
    },
    {
      row_index: 5,
      age_label: "6 months",
      primary_antigen: "DTP",
      co_administered_antigens: ["OPV", "PCV", "Rotavirus"],
      dose_kind: "primary",
      dose_number: 3,
    },
    {
      row_index: 6,
      age_label: "9 months",
      primary_antigen: "OPV",
      co_administered_antigens: ["Vitamin A"],
      dose_kind: "primary",
      dose_number: null,
    },
    {
      row_index: 7,
      age_label: "12 months",
      primary_antigen: "MMR",
      co_administered_antigens: ["OPV"],
      dose_kind: "primary",
      dose_number: 1,
    },
    {
      row_index: 8,
      age_label: "18 months",
      primary_antigen: "DTP",
      co_administered_antigens: ["OPV", "Vitamin A", "MMR"],
      dose_kind: "booster",
      dose_number: null,
    },
  ],
};

const UNKNOWN_TEMPLATE: VaccineCardTemplate = {
  template_id: "unknown_vaccine_card",
  display_name: "Unknown vaccination card",
  row_specs: [],
};

/** WHO / IHR International Certificate of Vaccination or Prophylaxis.
 *
 * Deliberately empty row_specs — unlike the Egyptian MoHP childhood
 * card, the ICVP carries an unbounded list of traveller-vaccine entries
 * (yellow fever, polio, meningococcal, COVID-19, etc.) keyed by
 * disease and date rather than fixed age slots. There is no template
 * inference for missing rows; the card is whatever the traveller has
 * been given. The vision pass emits one row per filled vaccine entry,
 * the trust gate routes low-confidence rows to clinician review, and
 * unknown disease/vaccine names surface for review rather than being
 * mapped or dropped. */
const WHO_ICVP_TEMPLATE: VaccineCardTemplate = {
  template_id: "who_icvp_international_certificate",
  display_name:
    "WHO/IHR International Certificate of Vaccination or Prophylaxis (ICVP)",
  row_specs: [],
};

export const VACCINE_CARD_TEMPLATES: Record<
  RecognizedTemplateId,
  VaccineCardTemplate
> = {
  egypt_mohp_mandatory_childhood_immunization: EGYPT_MOHP_TEMPLATE,
  who_icvp_international_certificate: WHO_ICVP_TEMPLATE,
  unknown_vaccine_card: UNKNOWN_TEMPLATE,
};

// ── Template recognizer ─────────────────────────────────────────────────────

/** Content-based template recognition — runs over source_text in the
 * layout's regions + the label fields. Deterministic, narrow,
 * defaults to "unknown_vaccine_card" on ambiguity. No heuristics that
 * could false-positive onto the wrong card.
 *
 * Order matters: WHO/ICVP is checked FIRST because traveller cards
 * sometimes carry "vaccination" / "immunization" wording that could
 * coincidentally hit the Egyptian markers if relaxed. The WHO markers
 * are the official IHR title text in EN/FR/ES — a hard signal. */
export function recognizeTemplate(
  layout: LayoutAnalysisResult | null,
): RecognizedTemplateId {
  if (!layout) return "unknown_vaccine_card";

  // WHO / ICVP — official IHR (2005) title strings, in the three
  // working languages of the certificate. Stamps and disclosures the
  // synthetic generator places ("SYNTHETIC TEST RECORD — NOT VALID FOR
  // TRAVEL") also identify a WHO-shaped card.
  const whoIcvpMarkers = [
    "international certificate of vaccination or prophylaxis",
    "certificat international de vaccination ou de prophylaxie",
    "certificado internacional de vacunación o profilaxis",
    "icvp",
    "synthetic test record",
  ];
  for (const region of layout.regions) {
    const haystack = `${region.source_text ?? ""} ${region.label ?? ""}`.toLowerCase();
    for (const marker of whoIcvpMarkers) {
      if (haystack.includes(marker)) {
        return "who_icvp_international_certificate";
      }
    }
  }

  // The Egyptian MoHP card's mandatory-immunizations title is the most
  // reliable signal. It is printed, high-contrast, and unique.
  const egyptianTitleMarkers = [
    "التطعيمات الإجبارية", // Arabic title
    "mandatory immunization",
    "egyptian mohp",
    "egypt mohp",
  ];
  for (const region of layout.regions) {
    const haystack = `${region.source_text ?? ""} ${region.label ?? ""}`.toLowerCase();
    for (const marker of egyptianTitleMarkers) {
      if (haystack.includes(marker.toLowerCase())) {
        return "egypt_mohp_mandatory_childhood_immunization";
      }
    }
  }
  return "unknown_vaccine_card";
}

// ── Date parsing for inferred rows ──────────────────────────────────────────

/** Eastern Arabic-Indic digits (U+0660..U+0669) — the digit shapes most
 * Egyptian MoHP cards use. */
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

// ── Template inference ─────────────────────────────────────────────────────

export interface TemplateInferenceResult {
  /** True when the inference emitted at least one template-inferred
   * row. False when every template slot was already filled by a
   * parsed vision row (so the output is just parsedRows unchanged),
   * when the template is unknown, or when there is no template-row
   * spec to drive inference. */
  inferred: boolean;
  /** The UNION of the caller's parsed rows and any template-inferred
   * rows for unfilled template slots. Inferred rows are pre-tagged
   * AMBER (source="template_inferred", confidence capped below 0.85)
   * so no downstream consumer can treat them as vision-confident.
   *
   * PR 1 SEMANTICS CHANGE: before PR 1 this field was either
   * parsedRows (unchanged) OR the pure inferred rows; the caller
   * conditionally replaced parsedRows. Now it is always a union, so
   * a caller can unconditionally treat `rows` as the complete display
   * set. Any existing caller that did `finalRows = inference.rows`
   * keeps working because the union already includes parsedRows. */
  rows: ParsedCardRow[];
  /** Inference-specific warnings the UI should surface. */
  warnings: string[];
  template_id: RecognizedTemplateId;
  /** When more date cells were present than the template expected,
   * the extra raw_date_text strings go here so the trace UI can list
   * them without them silently becoming rows. */
  unmapped_date_texts: string[];
}

/** Antigen match key for pairing a parsed row to a template row spec.
 * Case-insensitive, trimmed. Matching ignores dose_kind and
 * dose_number because cards routinely mislabel a schedule position
 * (e.g. a 9-month OPV row is printed as "booster" in some Egyptian
 * cards and "primary" in the template). The clinician reconciles
 * those mislabels in the HITL review — the matcher only needs to
 * answer "does this age-point slot already have a vision row for
 * this antigen". */
function antigenKey(antigen: string): string {
  return antigen.trim().toLowerCase();
}

/** Conservative template inference with per-unfilled-row surfacing.
 *
 * For each template row_spec:
 *   - If a parsed row already claims the slot (greedy left-to-right
 *     antigen match), pass through unchanged.
 *   - Otherwise, emit an AMBER template_inferred row so the unfilled
 *     age point is visible to the clinician for confirm/edit/skip.
 *
 * Inferred rows carry confidence < 0.85 and source="template_inferred"
 * — they can never pre-pass the confirmation trust gate. Unknown
 * templates synthesize nothing. */
export function inferRowsFromTemplate(
  layout: LayoutAnalysisResult | null,
  parsedRows: ParsedCardRow[],
): TemplateInferenceResult {
  const templateId = layout?.recognized_template_id ?? "unknown_vaccine_card";

  // Template inference now fires per unfilled template row, not only
  // when all vision failed. The previous zero-rows guard suppressed
  // predictions exactly when a card was partially legible, which is
  // the Egyptian MoHP messy-card failure mode.

  if (templateId === "unknown_vaccine_card" || !layout) {
    return {
      inferred: false,
      rows: parsedRows,
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  const template = VACCINE_CARD_TEMPLATES[templateId];
  if (!template || template.row_specs.length === 0) {
    return {
      inferred: false,
      rows: parsedRows,
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  // Greedy left-to-right antigen matching: each parsed row claims
  // the first unfilled template spec with the same antigen key. A
  // row that matches nothing (antigen not in this template) stays
  // in parsedRows but claims no slot.
  //
  // PR 2: the matcher annotates each parsed row with its claimed
  // template_spec_index (or null for unmatched rows) so the
  // downstream visit-first grouping in slot-state.ts can group rows
  // by age point without re-running the matcher.
  const filledSpecIndices = new Set<number>();
  const visionRowSpecAssignments = new Map<ParsedCardRow, number | null>();
  for (const row of parsedRows) {
    const key = antigenKey(row.antigen);
    let assigned: number | null = null;
    for (let i = 0; i < template.row_specs.length; i++) {
      if (filledSpecIndices.has(i)) continue;
      if (antigenKey(template.row_specs[i].primary_antigen) !== key) continue;
      filledSpecIndices.add(i);
      assigned = i;
      break;
    }
    visionRowSpecAssignments.set(row, assigned);
  }

  // Annotate each vision row with its template_spec_index (or null)
  // and a vision prediction_id. We do not mutate the input; we copy.
  const annotatedVisionRows: ParsedCardRow[] = parsedRows.map((row) => {
    const idx = visionRowSpecAssignments.get(row) ?? null;
    const fragId = row.sourceEvidenceFragmentId ?? row.row_id ?? "(no-id)";
    return {
      ...row,
      template_spec_index: idx,
      prediction_id: row.prediction_id ?? `V:${fragId}`,
    };
  });

  const unfilledSpecIndices: number[] = [];
  for (let i = 0; i < template.row_specs.length; i++) {
    if (!filledSpecIndices.has(i)) unfilledSpecIndices.push(i);
  }

  // Predicted-subkind discriminator (design note §3): zero vision
  // rows means the whole schedule is template-inferred; otherwise
  // any predictions are gap-fills on an otherwise-legible card.
  const predictedSubkind:
    | "predicted_missing_visit"
    | "predicted_zero_vision_template" =
    parsedRows.length === 0
      ? "predicted_zero_vision_template"
      : "predicted_missing_visit";

  if (unfilledSpecIndices.length === 0) {
    return {
      inferred: false,
      rows: annotatedVisionRows,
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  const warnings: string[] = [];
  const dateFragments = layout.evidence_fragments.filter(
    (f) => f.kind === "date_cell",
  );

  // Unmapped date texts: fragments beyond template.row_specs.length
  // are extra evidence the clinician needs to see but never becomes
  // a row (unchanged from pre-PR-1 semantics).
  const unmappedDateTexts: string[] = [];
  if (dateFragments.length > template.row_specs.length) {
    for (let i = template.row_specs.length; i < dateFragments.length; i++) {
      const f = dateFragments[i];
      unmappedDateTexts.push(f.raw_date_text ?? f.source_text ?? "(no text)");
    }
    warnings.push(
      `More date cells (${dateFragments.length}) than the ${template.display_name} ` +
        `template expects (${template.row_specs.length}). Extras are listed in the ` +
        `trace; no row was fabricated for them.`,
    );
  }

  // Emit an AMBER row for every unfilled spec. Date evidence, when
  // a date_fragment exists at the same positional index as the spec,
  // seeds the row's date. Otherwise date=null and the UI surfaces
  // an explicit "visit needs confirmation" slot.
  const inferredRows: ParsedCardRow[] = [];
  let unfilledWithoutDate = 0;
  for (const specIdx of unfilledSpecIndices) {
    const spec = template.row_specs[specIdx];
    const frag = dateFragments[specIdx];
    const parsedDate = frag ? parseRawDate(frag.raw_date_text ?? frag.source_text) : null;
    const rawDateLabel =
      frag?.raw_date_text ?? frag?.source_text ?? "(no date cell evidence)";
    if (!frag) unfilledWithoutDate++;
    const coAdmin =
      spec.co_administered_antigens.length > 0
        ? ` Co-administered on this row: ${spec.co_administered_antigens.join(", ")}.`
        : "";
    // Cap confidence below the 0.85 AMBER threshold so downstream
    // code cannot treat an inferred row as vision-confident. Falls
    // to 0.4 when no date evidence exists — the slot still surfaces
    // for clinician review.
    const cappedConfidence = frag ? Math.min(0.6, frag.confidence) : 0.4;

    inferredRows.push({
      antigen: spec.primary_antigen,
      date: parsedDate,
      doseNumber: spec.dose_number,
      doseKind: spec.dose_kind,
      lotNumber: null,
      confidence: cappedConfidence,
      reasoningIfUncertain:
        `Template-inferred (${template.display_name} · ${spec.age_label}). ` +
        `Primary antigen: ${spec.primary_antigen}.${coAdmin} ` +
        `Raw date evidence: "${rawDateLabel}". ` +
        `This slot was synthesised because the vision pass did not ` +
        `produce a matching row for this age point. Clinician MUST ` +
        `confirm the antigen, dose number, and date before proceeding ` +
        `to validation.`,
      imageCropRegion: {
        x: 0,
        y: Math.min(1, specIdx / template.row_specs.length),
        width: 1,
        height: Math.min(0.2, 1 / template.row_specs.length),
      },
      source: "template_inferred",
      // Kept for one cycle for backward compat; PR 3 strips this from
      // predicted rows in favor of `prediction_id` exclusively.
      sourceEvidenceFragmentId: frag?.fragment_id ?? null,
      // PR 2 schema (design note §6.1):
      slot_state: "predicted",
      predicted_subkind: predictedSubkind,
      template_spec_index: specIdx,
      prediction_id: `T:${specIdx}`,
      clinician_action: "none",
    });
  }

  if (unfilledWithoutDate > 0) {
    warnings.push(
      `${unfilledWithoutDate} template row${unfilledWithoutDate === 1 ? "" : "s"} ` +
        `had no date-cell evidence; surfaced as AMBER slots with null dates ` +
        `for clinician confirmation. (${template.display_name})`,
    );
  }

  return {
    inferred: inferredRows.length > 0,
    rows: [...annotatedVisionRows, ...inferredRows],
    warnings,
    template_id: templateId,
    unmapped_date_texts: unmappedDateTexts,
  };
}

// ── Unknown-template fragment promotion ─────────────────────────────────────
//
// Why this exists:
//   When a card does not match a registered template
//   (`recognized_template_id === "unknown_vaccine_card"`), the registry-
//   driven `inferRowsFromTemplate` short-circuits and emits zero rows
//   even when the vision pass HAS read every cell into evidence
//   fragments — the staged extraction's "fragments" half does its job,
//   but the "rows" half is empty because no template anchors them.
//
//   On a Nigerian-style EPI card the visible failure is: the demo UI
//   renders "no rows extracted" while the trace shows fourteen perfectly
//   transcribed vaccine cells. The synthetic Amina Bello card is the
//   canonical reproducer.
//
// What this function does:
//   When (a) the caller's parsed rows are empty AND (b) the layout was
//   classified as `unknown_vaccine_card` AND (c) the trace contains at
//   least three `vaccine_cell` evidence fragments paired with vaccine
//   AND date text, promote each qualifying fragment to one
//   ParsedCardRow.
//
//   Promoted rows are AMBER. We use `source = "vision_low_confidence"`
//   with confidence capped well below `CONFIDENCE_THRESHOLD = 0.85`,
//   `clinician_action = "none"`, and `template_spec_index = null`.
//   That choice makes the trust gate (`filterConfirmedDoses`) drop
//   them automatically until the clinician confirms in HITL — exactly
//   the same posture as `template_inferred` rows on known templates,
//   minus the template anchor.
//
//   This is intentionally a narrow bridge, not a fallback agent:
//
//     - Footer notes (`kind === "note"`) are never promoted to rows.
//     - Fragments without BOTH `vaccine_text` and `raw_date_text` are
//       skipped; we do not invent a vaccine name from `source_text`.
//     - We do not normalise the antigen string. The clinician sees the
//       card's verbatim wording (e.g. "Pentavalent", "Yellow Fever")
//       and confirms before anything reaches the engine. The engine's
//       synonym layer is downstream.
//     - We never overwrite vision rows. If the vision pass produced
//       even one row, this function returns the input unchanged.
//
//   Promoted rows preserve provenance via `sourceEvidenceFragmentId`
//   so the trace UI can correlate each row back to its fragment, and
//   `prediction_id` is `V:<fragment_id>` (vision prefix — these were
//   read by vision, not synthesised from a template spec).

export interface UnknownTemplatePromotionResult {
  /** The full set of rows the route should hand to the finalisation
   * step: caller's rows when no promotion fired, otherwise the
   * promoted AMBER rows. Never partial — either we promoted all
   * qualifying fragments or none. */
  rows: ParsedCardRow[];
  /** True when at least one fragment was promoted. */
  promoted: boolean;
  /** Free-text trace warnings the route folds into
   * documentIntelligence.warnings so the trust panel surfaces them. */
  warnings: string[];
  /** Number of fragments that qualified (vaccine_cell with both
   * vaccine_text and raw_date_text). Reported in the warning so the
   * audit trail records what the bridge saw. */
  qualifyingFragmentCount: number;
}

/** Minimum number of qualifying vaccine fragments required before the
 * bridge fires. Three is the floor: a single fragment could be a
 * spurious read; three rows look like a vaccine table. */
const UNKNOWN_TEMPLATE_PROMOTION_MIN_FRAGMENTS = 3;

/** Confidence cap for promoted rows. Strictly below
 * `CONFIDENCE_THRESHOLD = 0.85` so the trust gate cannot admit a
 * promoted row without explicit clinician confirmation. The cap is a
 * structural decision (no template anchor), not a measure of OCR
 * quality — fragment confidences may have been ≥ 0.95. */
const UNKNOWN_TEMPLATE_PROMOTION_CONFIDENCE_CAP = 0.6;

/** Extract a small integer dose number from a fragment's source_text
 * by looking for the first integer token that follows the vaccine
 * label. Returns null when nothing parseable is present.
 *
 * Cards in this format have source_text like
 *   "10 Jan 2025 | Birth | BCG | 1 | scar seen"
 * or
 *   "21 Feb 2025 | 6 weeks | Pentavalent | 1 | given"
 * — the dose number is in the cell after the vaccine. The OPV birth
 * dose is conventionally numbered 0 ("OPV | 0 | birth dose"); 0 is a
 * legitimate value and must round-trip. Negative numbers are rejected
 * (no real dose number is negative); values above 9 are rejected as
 * implausible for any pediatric primary or booster series. */
function extractDoseNumberFromFragment(
  sourceText: string | null,
  vaccineText: string | null,
): number | null {
  if (!sourceText || !vaccineText) return null;
  const idx = sourceText.indexOf(vaccineText);
  if (idx === -1) return null;
  const after = sourceText.slice(idx + vaccineText.length);
  const m = after.match(/(?:^|[|,;\s])\s*(\d{1,2})\b/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isInteger(value) || value < 0 || value > 9) return null;
  return value;
}

/** Best-effort dose_kind from the fragment's row label. Cards label
 * birth doses explicitly ("Birth", "ولادة", "naissance"); anything
 * else falls through to `"primary"` because the unknown-template
 * fragments we promote here are children's primary-series rows in
 * practice. The clinician can correct in HITL. */
function inferDoseKindFromRowLabel(rowLabel: string | null): DoseKind {
  if (!rowLabel) return "primary";
  const lower = rowLabel.toLowerCase();
  if (lower.includes("birth") || lower.includes("ولادة") || lower.includes("naissance")) {
    return "birth";
  }
  return "primary";
}

/** Promote unknown-template `vaccine_cell` fragments to AMBER rows.
 * See module-level comment above for design rationale and constraints.
 * Pure: does not mutate `parsedRows` or `layout`.
 *
 * Returns `parsedRows` unchanged (with `promoted: false`) when any of
 * the preconditions fail. Otherwise returns a new array of promoted
 * rows. The route is responsible for splicing the result into the
 * pipeline and forwarding `warnings` into the trace. */
export function promoteUnknownTemplateFragments(
  layout: LayoutAnalysisResult | null,
  parsedRows: ParsedCardRow[],
): UnknownTemplatePromotionResult {
  // Vision rows always win — never replace them.
  if (parsedRows.length > 0) {
    return {
      rows: parsedRows,
      promoted: false,
      warnings: [],
      qualifyingFragmentCount: 0,
    };
  }
  // Bridge is unknown-template only. Known templates have their own
  // `inferRowsFromTemplate` path; running here would double-handle.
  if (!layout || layout.recognized_template_id !== "unknown_vaccine_card") {
    return {
      rows: parsedRows,
      promoted: false,
      warnings: [],
      qualifyingFragmentCount: 0,
    };
  }

  const qualifying = layout.evidence_fragments.filter(
    (f) =>
      f.kind === "vaccine_cell" &&
      typeof f.vaccine_text === "string" &&
      f.vaccine_text.trim().length > 0 &&
      typeof f.raw_date_text === "string" &&
      f.raw_date_text.trim().length > 0,
  );

  if (qualifying.length < UNKNOWN_TEMPLATE_PROMOTION_MIN_FRAGMENTS) {
    return {
      rows: parsedRows,
      promoted: false,
      warnings: [],
      qualifyingFragmentCount: qualifying.length,
    };
  }

  const total = qualifying.length;
  const promotedRows: ParsedCardRow[] = qualifying.map((frag, idx) => {
    const parsedDate = parseRawDate(frag.raw_date_text);
    const doseNumber = extractDoseNumberFromFragment(
      frag.source_text,
      frag.vaccine_text,
    );
    const doseKind = inferDoseKindFromRowLabel(frag.row_label);
    const ageHint = frag.row_label
      ? ` Card row label: "${frag.row_label}".`
      : "";
    const dateNote = parsedDate
      ? ""
      : ` Date "${frag.raw_date_text}" did not parse to ISO; clinician must confirm or enter manually.`;
    const cappedConfidence = Math.min(
      UNKNOWN_TEMPLATE_PROMOTION_CONFIDENCE_CAP,
      frag.confidence,
    );

    return {
      antigen: frag.vaccine_text!,
      date: parsedDate,
      doseNumber,
      doseKind,
      lotNumber: null,
      confidence: cappedConfidence,
      reasoningIfUncertain:
        `Promoted from unknown-template evidence fragment ${frag.fragment_id}. ` +
        `The card layout did not match a registered template (Egypt MoHP / WHO ICVP), ` +
        `so vision did not emit this row in the structured rows[] array; the bridge ` +
        `synthesised it from the trace's vaccine_cell fragment.${ageHint}${dateNote} ` +
        `Clinician MUST confirm the antigen, dose number, and date before reconciliation.`,
      imageCropRegion: {
        x: 0,
        y: Math.min(1, idx / Math.max(1, total)),
        width: 1,
        height: Math.min(0.2, 1 / Math.max(1, total)),
      },
      // Trust-gate posture: vision_low_confidence is dropped by
      // filterConfirmedDoses unless clinician_action escalates the
      // row. This is the AMBER-without-template-anchor posture.
      source: "vision_low_confidence",
      sourceEvidenceFragmentId: frag.fragment_id,
      // Slot-state for unknown-template promotion is "ambiguous" (HITL
      // table), not "predicted" (template-anchored visit panel).
      slot_state: "ambiguous",
      predicted_subkind: null,
      template_spec_index: null,
      prediction_id: `V:${frag.fragment_id}`,
      clinician_action: "none",
    };
  });

  return {
    rows: promotedRows,
    promoted: true,
    warnings: [
      `Unknown-template fragment promotion: vision returned 0 rows but the trace contained ` +
        `${qualifying.length} vaccine_cell fragments with paired vaccine + date evidence. ` +
        `Each was promoted to an AMBER row (source="vision_low_confidence", ` +
        `confidence ≤ ${UNKNOWN_TEMPLATE_PROMOTION_CONFIDENCE_CAP}); clinician must confirm ` +
        `before any row reaches the engine.`,
    ],
    qualifyingFragmentCount: qualifying.length,
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
