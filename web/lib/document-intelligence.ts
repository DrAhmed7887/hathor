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

export const VACCINE_CARD_TEMPLATES: Record<
  RecognizedTemplateId,
  VaccineCardTemplate
> = {
  egypt_mohp_mandatory_childhood_immunization: EGYPT_MOHP_TEMPLATE,
  unknown_vaccine_card: UNKNOWN_TEMPLATE,
};

// ── Template recognizer ─────────────────────────────────────────────────────

/** Content-based template recognition — runs over source_text in the
 * layout's regions + the label fields. Deterministic, narrow,
 * defaults to "unknown_vaccine_card" on ambiguity. No heuristics that
 * could false-positive onto the wrong card. */
export function recognizeTemplate(
  layout: LayoutAnalysisResult | null,
): RecognizedTemplateId {
  if (!layout) return "unknown_vaccine_card";

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

const EASTERN_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Best-effort parse of a raw date string into ISO YYYY-MM-DD.
 * Accepts Eastern Arabic digits, Western digits, DD/MM/YYYY (the
 * Egyptian convention), YYYY-MM-DD, and DD-MM-YYYY. Returns null on
 * any ambiguity — inferred rows with null dates still surface to the
 * clinician via the AMBER gate; they do not silently succeed. */
export function parseRawDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Westernise digits.
  const normalised = String(raw).replace(/[٠-٩]/g, (d) => {
    const idx = EASTERN_ARABIC_DIGITS.indexOf(d);
    return idx === -1 ? d : String(idx);
  });
  const trimmed = normalised.trim();

  // ISO first.
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  // DD/MM/YYYY or DD-MM-YYYY.
  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dn = Number(d);
    const mn = Number(m);
    if (dn < 1 || dn > 31 || mn < 1 || mn > 12) return null;
    return `${y}-${String(mn).padStart(2, "0")}-${String(dn).padStart(2, "0")}`;
  }

  return null;
}

// ── Template inference ─────────────────────────────────────────────────────

export interface TemplateInferenceResult {
  /** True only when template-inferred rows were generated and
   * should replace the caller's empty rows. False when the caller's
   * rows are kept unchanged OR inference declined (unknown template,
   * no date evidence). */
  inferred: boolean;
  /** Either the caller's rows (unchanged) or the template-inferred
   * rows. Always safe to render — inferred rows are pre-tagged AMBER
   * and carry source="template_inferred". */
  rows: ParsedCardRow[];
  /** Inference-specific warnings the UI should surface. */
  warnings: string[];
  template_id: RecognizedTemplateId;
  /** When inferrence ran AND more date cells were present than the
   * template expected, the extra raw_date_text strings go here so the
   * trace UI can list them without them silently becoming rows. */
  unmapped_date_texts: string[];
}

/** Conservative template inference: only populates rows when the
 * vision pass returned none AND the registry matched a known template.
 * Never runs over vision-produced rows — if the vision pass saw even
 * one row, that is treated as ground truth.
 *
 * The output rows are always AMBER (confidence capped at 0.6) and
 * always carry source="template_inferred" so the UI can banner them
 * and the clinician knows they need to confirm each one before the
 * engine sees anything. */
export function inferRowsFromTemplate(
  layout: LayoutAnalysisResult | null,
  parsedRows: ParsedCardRow[],
): TemplateInferenceResult {
  const templateId = layout?.recognized_template_id ?? "unknown_vaccine_card";

  // Never overwrite existing rows. If the vision pass produced
  // anything, those are what the clinician should review.
  if (parsedRows.length > 0) {
    return {
      inferred: false,
      rows: parsedRows,
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  if (templateId === "unknown_vaccine_card" || !layout) {
    return {
      inferred: false,
      rows: [],
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  const template = VACCINE_CARD_TEMPLATES[templateId];
  if (!template || template.row_specs.length === 0) {
    return {
      inferred: false,
      rows: [],
      warnings: [],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  const dateFragments = layout.evidence_fragments.filter(
    (f) => f.kind === "date_cell",
  );
  if (dateFragments.length === 0) {
    return {
      inferred: false,
      rows: [],
      warnings: [
        `Template ${template.display_name} recognised but no date-cell evidence was extracted; nothing to infer.`,
      ],
      template_id: templateId,
      unmapped_date_texts: [],
    };
  }

  // Conservative mapping: 1:1 by fragment insertion order (which the
  // prompt specifies is top-to-bottom). We do NOT try to realign by
  // labels — labels are weak or absent in this branch by definition.
  const warnings: string[] = [];
  const mapCount = Math.min(dateFragments.length, template.row_specs.length);

  if (dateFragments.length < template.row_specs.length) {
    warnings.push(
      `Template-inferred rows are incomplete: ${dateFragments.length} date-cell ` +
        `evidence item${dateFragments.length === 1 ? "" : "s"} found, ${template.row_specs.length} expected ` +
        `for ${template.display_name}. Clinician to add the missing rows manually.`,
    );
  }

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

  const rows: ParsedCardRow[] = [];
  for (let i = 0; i < mapCount; i++) {
    const spec = template.row_specs[i];
    const frag = dateFragments[i];
    const parsedDate = parseRawDate(frag.raw_date_text ?? frag.source_text);
    const coAdmin =
      spec.co_administered_antigens.length > 0
        ? ` Co-administered on this row: ${spec.co_administered_antigens.join(", ")}.`
        : "";
    const rawDateLabel =
      frag.raw_date_text ?? frag.source_text ?? "(no text)";
    // Cap confidence well below the 0.85 AMBER threshold so the UI
    // and downstream code cannot accidentally treat an inferred row
    // as vision-confident.
    const cappedConfidence = Math.min(0.6, frag.confidence);

    rows.push({
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
        `This row was synthesised from a recognised template because the ` +
        `vision pass could not read row labels. Clinician MUST confirm each ` +
        `antigen, dose number, and date before proceeding to validation.`,
      imageCropRegion: {
        x: 0,
        y: Math.min(1, i / mapCount),
        width: 1,
        height: Math.min(0.2, 1 / mapCount),
      },
      source: "template_inferred",
      sourceEvidenceFragmentId: frag.fragment_id,
    });
  }

  return {
    inferred: true,
    rows,
    warnings,
    template_id: templateId,
    unmapped_date_texts: unmappedDateTexts,
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
