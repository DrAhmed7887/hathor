/**
 * Shared types for the HATHOR demo flow.
 *
 * Existing types in lib/api.ts serve the agent-SSE reconcile-card path
 * (FieldExtraction, HITLQueueItem, ValidationResult, etc.). This file adds
 * the contracts for the NEW non-agent fast path:
 *
 *   chat intake → card parse (single vision call) → batch validate via
 *   /validate-schedule (from commit d2cccc7) → export.
 *
 * Keep these types aligned with:
 *   - api/src/hathor/server.py  — ValidateScheduleRequest / per-record
 *     engine output shape
 *   - /api/parse-card response schema (step 5 lands the actual route)
 */

// ── Chat intake (step 4) ─────────────────────────────────────────────────────

export type IntakeRole = "assistant" | "user";

export interface IntakeMessage {
  id: string;
  role: IntakeRole;
  content: string;
  /** True while the assistant's reply is still streaming in. */
  streaming?: boolean;
}

/** Structured prep answers distilled from the chat intake, passed forward
 * to parse-card and schedule views. Everything optional — the intake may
 * end early, and downstream code must tolerate missing hints. */
export interface IntakeContext {
  childDob?: string;             // ISO YYYY-MM-DD
  sourceCountry?: CountryCode;   // country that issued the card
  destinationCountry?: CountryCode; // country applying the schedule (Egypt)
  cardLanguage?: CardLanguage;   // hint for the vision pass
  priorDosesKnown?: "yes" | "no" | "partial";
  knownAllergiesOrContraindications?: string;
  rawTranscript?: IntakeMessage[]; // for auditability
}

// ── Card parse output (step 5) ───────────────────────────────────────────────

/** Image-space rectangle for the per-field crop required by PRD §5.6
 * ("cropped source region next to the extracted value"). All values are
 * normalized [0, 1] fractions of the full image width / height, so the
 * frontend does not need to know the pre-redaction source dimensions. */
export interface ImageCropRegion {
  x: number;       // left
  y: number;       // top
  width: number;
  height: number;
}

/** Clinical class of a vaccination card row. The primary/booster split
 * is load-bearing: Egyptian MoHP cards print booster (منشطة) rows
 * alongside the numbered primary series, and the schedule engine
 * validates booster doses by antigen + age + interval rather than by a
 * dose position it does not carry. "birth" flags BCG / HepB rows the
 * card explicitly marks as birth doses. "unknown" is the honest answer
 * when the card does not say. */
export type DoseKind = "primary" | "booster" | "birth" | "unknown";

/** One row extracted from a vaccination card by the single /api/parse-card
 * vision call. Confidence is per-row in aggregate; individual fields
 * (date vs. antigen vs. dose_number) can carry their own reasoning strings
 * when the model was uncertain about that specific cell. */
export interface ParsedCardRow {
  antigen: string;                        // canonical antigen code, e.g. "BCG", "DTP"
  date: string | null;                    // ISO YYYY-MM-DD, or null if unreadable
  doseNumber: number | null;              // 1, 2, 3, …; null if not on card (e.g. booster rows)
  /** Clinical class of the row. See DoseKind. Booster rows are not
   * forced into numbered primary slots — they carry doseKind="booster"
   * and doseNumber=null unless the card itself numbers them. */
  doseKind: DoseKind;
  lotNumber?: string | null;
  confidence: number;                     // 0..1, aggregate for the row
  reasoningIfUncertain?: string | null;   // plain-language reason — rendered verbatim per PRD §5.6
  imageCropRegion: ImageCropRegion;       // for the per-field crop UI
  /** Raw cell confidences where present, so the UI can sub-flag a date
   * on an otherwise-confident row. */
  fieldConfidences?: Partial<{
    antigen: number;
    date: number;
    doseNumber: number;
    lotNumber: number;
  }>;
  /** Where the row came from. Provenance for the audit trail and the
   * grouped-visit UI bucket.
   *
   *   - "vision" — high-confidence OCR/vision read off the card.
   *   - "vision_low_confidence" — vision saw the row but confidence
   *     fell below the AMBER threshold; clinician must confirm.
   *   - "template_inferred" — vision returned no rows but the card
   *     matched a known template; the row was synthesised from the
   *     template's row_spec + a date-cell evidence fragment.
   *   - "predicted_from_schedule" — RESERVED for a future commit.
   *     Will tag rows the system suggested from the destination
   *     country's schedule pattern when OCR missed an expected visit.
   *     No code in this commit produces these rows. The label exists
   *     so the UI bucket and audit pipeline can be built ahead of the
   *     generator.
   *
   * Anything that is not "vision" must NEVER reach the engine without
   * an explicit clinician confirmation. */
  source?:
    | "vision"
    | "vision_low_confidence"
    | "template_inferred"
    | "predicted_from_schedule";
  /** The EvidenceFragment.fragment_id that seeded a template-inferred
   * row. Null for vision rows. Lets the trace UI correlate inferred
   * rows back to their source evidence. */
  sourceEvidenceFragmentId?: string | null;
}

export interface ParsedCardOutput {
  rows: ParsedCardRow[];
  /** Lightweight, CrossBeam-inspired layout + evidence trace from the
   * staged extraction pipeline. Optional — if the model omits it or
   * returns a malformed object, the route falls back to direct parse
   * and the UI shows a "trace unavailable" banner. Fields use
   * snake_case to match the tool-call wire format verbatim; consumers
   * should import the typed shape from @/lib/document-intelligence. */
  documentIntelligence?: import("./document-intelligence").LayoutAnalysisResult;
  /** Model-level metadata for the agent-reasoning audit trail. */
  model: string;
  parsedAt: string; // ISO timestamp
}

// ── Redaction (bounding boxes drawn in the browser before upload) ─────────────

/** One rectangle the user dragged over PII on the card. Coordinates are
 * normalized [0, 1] fractions of the rendered image in the browser so the
 * mask travels with the image through any resize. */
export interface RedactionRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Author-entered label (e.g., "patient name", "national ID"). Optional
   * — purely for the audit trail, not load-bearing on the mask itself. */
  label?: string;
}

// ── /validate-schedule request + response (wraps d2cccc7 server) ─────────────

/** Must match api/src/hathor/server.py ValidateScheduleRecord exactly. */
export interface ValidateScheduleRecord {
  antigen: string;
  date: string;                    // ISO YYYY-MM-DD
  /** Dose position within the primary series. Null for booster rows
   * where the card does not number the booster — the engine validates
   * those by antigen + age + interval via dose_kind. */
  dose_number: number | null;
  /** Clinical class of the row (mirrors ParsedCardRow.doseKind over the
   * engine wire in snake_case). Defaults to "primary" server-side when
   * omitted, preserving backward compatibility with earlier payloads. */
  dose_kind?: DoseKind;
  prior_dose_age_days: number | null;
}

/** Must match api/src/hathor/server.py ValidateScheduleRequest exactly. */
export interface ValidateScheduleRequest {
  records: ValidateScheduleRecord[];
  child_dob: string;               // ISO YYYY-MM-DD
}

/** Engine's native per-record output as returned by /validate-schedule.
 * NOT reshaped — the server hands back exactly what validate_dose emits. */
export interface ValidateScheduleResult {
  antigen: string;
  /** Null when the row was a booster with no numbered position on the
   * card — the engine preserves what it received. */
  dose_number: number | null;
  dose_kind?: DoseKind;
  age_at_dose_days: number;
  target_country: string;
  prior_dose_age_days: number | null;
  valid: boolean;
  /** True when the engine cannot safely prove the dose valid or invalid
   * on its own (e.g., a booster against an antigen whose schedule rule
   * it does not encode). UI treats this as AMBER review-needed — the
   * row is NOT silently dropped, but it is NOT auto-approved either. */
  needs_clinician_confirmation?: boolean;
  reasons: string[];
  flags: string[];
}

// ── Reconciled view model (merges parsed row + engine verdict) ───────────────

/** What ScheduleView renders per dose: parsed row joined with the engine
 * verdict. The engine is authoritative; the UI surface only shows rows
 * the engine has seen. */
export interface ReconciledDose {
  parsed: ParsedCardRow;
  verdict: ValidateScheduleResult;
  /** True when the engine returned valid=false — drives RED channel per
   * PRD §6 point 3 ("this interval would harm a child"). */
  isClinicalSafetyViolation: boolean;
  /** True when parsed.confidence < 0.85 — drives AMBER channel per
   * PRD §5.6 Vision Safety Loop. */
  needsExtractionReview: boolean;
}

// ── Country metadata ─────────────────────────────────────────────────────────

export type CountryCode = "NG" | "EG";
export type CardLanguage = "en" | "ar" | "fr" | "mixed";
export type WritingDirection = "ltr" | "rtl";
