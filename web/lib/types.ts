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
   * rows back to their source evidence.
   *
   * **DEPRECATED for predicted rows when PR 3 lands.** Use
   * `prediction_id` instead. Today PR 2 emits both for one cycle so
   * existing callers continue to work; PR 3 strips this field from
   * predicted rows. Vision rows continue to carry it. */
  sourceEvidenceFragmentId?: string | null;

  // ── PR 2 schema additions (see docs/hitl-ui-design.md §6.1) ──────────────

  /** Stable UUID v4 generated at parse time. The audit log keys off
   * this; React reconciliation keys off this. Indexes are not safe
   * keys because edits and re-renders shift positions. Optional in
   * the type so existing test fixtures compile without churn — the
   * wire boundary in /api/parse-card/route.ts populates it
   * unconditionally. */
  row_id?: string;

  /** Three-state discriminator the UI keys on. Computed
   * deterministically from `source` and confidence at parse time:
   *   - source === "vision" AND confidence >= 0.85 → "extracted"
   *   - source === "vision" or "vision_low_confidence" with
   *     confidence < 0.85 → "ambiguous"
   *   - source === "template_inferred" → "predicted"
   * Helper: `slotStateOf(row)` in `web/lib/slot-state.ts`. */
  slot_state?: "extracted" | "ambiguous" | "predicted";

  /** Sub-flavor of `slot_state="predicted"`. Discriminates between a
   * predicted slot on an otherwise-legible card and a predicted slot
   * on a card where vision returned nothing. The two get separate
   * visual treatments per design note §3.
   *
   * Rule: `predicted_zero_vision_template` iff total vision rows on
   * the parse output is zero AND this row is predicted.
   * `predicted_missing_visit` otherwise (when slot_state="predicted").
   *
   * Null for non-predicted rows. */
  predicted_subkind?:
    | "predicted_missing_visit"
    | "predicted_zero_vision_template"
    | null;

  /** Index into the recognized template's `row_specs[]`. Non-null
   * when the row is paired with a template age point: vision rows
   * via greedy antigen match, predicted rows by construction.
   * Null for vision rows whose antigen has no template spec. */
  template_spec_index?: number | null;

  /** What the clinician decided about this row. "none" until the
   * clinician acts; the audit log carries the full action history.
   *   - "confirmed" / "edited" → reaches reconciliation (engine wire)
   *   - "skipped"              → held back; visit treated as unreviewed
   *   - "rejected"             → routed to definitively_absent channel
   *
   * `clinician_reason` is required (non-null) when this is
   * "rejected" — schema-enforced via `assertClinicianAction(row)`
   * at the wire boundary. */
  clinician_action?: "none" | "confirmed" | "edited" | "skipped" | "rejected";

  /** ISO 8601 timestamp of the most recent clinician action on this
   * row. Cached from the audit log for cheap UI rendering. */
  clinician_action_at?: string | null;

  /** Free-text clinician note. Required (non-null) when
   * `clinician_action === "rejected"`. */
  clinician_reason?: string | null;

  /** Stable identity for predictions. Format:
   *   - "V:<fragment_id>"        for vision rows
   *   - "T:<template_spec_index>" for template-predicted rows
   * The structural prefix means downstream logs and FHIR exports can
   * tell predicted from vision rows without consulting copy.
   * (Limitation 3 fix from PR 1.) */
  prediction_id?: string | null;
}

/** A clinical visit at one age point. Egyptian MoHP cards have nine
 * age points (the template's row_specs); a visit groups every row
 * the parser produced for that age point — vision-extracted,
 * ambiguous, or predicted alike. PR 2 introduces this as the
 * visit-first schema; PR 3 builds the UI on top of it.
 *
 * Vision rows whose antigen has no template spec land in their own
 * Visit with `template_spec_index = null`. */
export interface Visit {
  visit_id: string;
  template_spec_index: number | null;
  /** Display label like "2 months / شهرين", carried verbatim from the
   * template row spec when known. Null for non-template visits. */
  age_label: string | null;
  rows: ParsedCardRow[];
}

/** Snapshot of a row's clinically load-bearing values at the moment
 * a clinician action was committed. Stored verbatim in the audit
 * log so the audit trail can reconstruct what the clinician saw. */
export interface SlotValueSnapshot {
  antigen: string;
  date: string | null;
  dose_number: number | null;
  dose_kind: DoseKind;
  lot_number: string | null;
  source: ParsedCardRow["source"];
  confidence: number;
  field_confidences?: ParsedCardRow["fieldConfidences"];
}

/** One immutable audit entry per clinician action. Append-only —
 * editing a previously-confirmed row appends a new entry; the most
 * recent per `row_id` is the authoritative state. See design note §5.
 *
 * `clinician_id = "demo-clinician"` is the sentinel value in
 * unauthenticated demo sessions per the resolved open question. */
export interface AuditEntry {
  audit_entry_id: string;
  row_id: string;
  clinician_id: string;
  clinician_display_name: string | null;
  timestamp: string;
  action: "confirm" | "edit" | "skip" | "reject";
  slot_state_at_action:
    | "extracted"
    | "ambiguous"
    | "predicted_missing_visit"
    | "predicted_zero_vision_template";
  predicted_value: SlotValueSnapshot;
  /** Null for `skip` and `reject` actions. */
  confirmed_value: SlotValueSnapshot | null;
  /** Required (non-null) for `reject`. Optional otherwise.
   * Enforced at the wire boundary by `assertAuditEntry()`. */
  reason: string | null;
  predicted_subkind:
    | "predicted_missing_visit"
    | "predicted_zero_vision_template"
    | null;
}

/** Sentinel clinician identity for unauthenticated demo sessions.
 * The audit log carries this so FHIR Provenance shape stays stable
 * when a real auth layer lands. */
export const DEMO_CLINICIAN_ID = "demo-clinician";

export interface ParsedCardOutput {
  /** **DERIVED ALIAS — removed when PR 3 lands.**
   *
   * Maintained for one cycle so existing consumers (ParsedResults,
   * the demo page, validation.ts) continue to compile while PR 3
   * migrates them to `visits[].rows[]`. After PR 3 merges, delete
   * this field from the interface and from the route handler's
   * response payload. The PR 2 commit message records the deletion
   * deadline, and the route's response is documented at
   * web/app/api/parse-card/route.ts. */
  rows: ParsedCardRow[];

  /** Visit-first schema (PR 2). One Visit per age point: rows are
   * grouped by `template_spec_index`, with vision rows that match no
   * spec landing in their own untyped visits at the end. The UI in
   * PR 3 renders this directly; `rows[]` above is a flattened alias
   * for backward compat only. */
  visits: Visit[];

  /** Card-level orientation acknowledgement (design note §7).
   * Defaults to `true` when `documentIntelligence?.orientation_warning`
   * is null; defaults to `false` otherwise. The trust gate refuses
   * to admit any row from a card with an unacknowledged orientation
   * warning. The clinician acknowledges via a full-card modal. */
  orientation_acknowledged: boolean;

  /** Append-only clinician action history. Never mutated; new
   * actions push new entries. The trust gate consults the latest
   * entry per `row_id` to determine `clinician_action`. */
  audit_log: AuditEntry[];

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

/** Wire-boundary validator. Throws if a row's clinician_action is
 * "rejected" without a non-empty clinician_reason. Pairs with the
 * Pydantic `model_validator` on the Python side
 * (`api/src/hathor/schemas/extraction.py`). */
export function assertClinicianAction(row: ParsedCardRow): void {
  if (row.clinician_action === "rejected") {
    if (!row.clinician_reason || row.clinician_reason.trim() === "") {
      throw new Error(
        `Row ${row.row_id ?? "(no row_id)"}: clinician_action="rejected" ` +
          `requires a non-empty clinician_reason.`,
      );
    }
  }
}

/** Wire-boundary validator for an AuditEntry. Throws if a `reject`
 * entry lacks a non-empty `reason`. */
export function assertAuditEntry(entry: AuditEntry): void {
  if (entry.action === "reject") {
    if (!entry.reason || entry.reason.trim() === "") {
      throw new Error(
        `Audit entry ${entry.audit_entry_id} (row ${entry.row_id}): ` +
          `action="reject" requires a non-empty reason.`,
      );
    }
  }
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

/** Codes covered by the demo's country selector.
 *
 * Phase 1 hackathon scope (per CLAUDE.md): EG is the partial-ready
 * destination schedule. SD/SS/ER/ET are needs_review countries surfaced
 * for the review-workflow demonstration only — their schedules remain
 * under verification and reconciliation is gated. NG is included as an
 * optional English-language demo source country; it is NOT presented as
 * a top-by-number migration group to Egypt. */
export type CountryCode = "EG" | "SD" | "SS" | "ER" | "ET" | "NG";
export type CardLanguage = "en" | "ar" | "fr" | "ti" | "am" | "mixed";
export type WritingDirection = "ltr" | "rtl";

/** Readiness of a country's schedule for AUTO reconciliation:
 *   - "partial_ready"  the schedule has been clinician-reviewed and the
 *                      validate-schedule engine may run against it.
 *                      Demo can produce due/overdue verdicts.
 *   - "needs_review"   the schedule and synonym map are NOT clinically
 *                      verified for this country. The demo extracts and
 *                      reviews the card but MUST NOT produce definitive
 *                      due/overdue clinical recommendations against this
 *                      country's schedule — the UI shows a
 *                      "Schedule under review" banner instead. */
export type CountryReadiness = "partial_ready" | "needs_review";
