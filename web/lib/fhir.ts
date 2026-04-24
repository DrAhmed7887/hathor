/**
 * FHIR R4 Immunization resource builder for HATHOR demo exports.
 *
 * Posture: FHIR R4 Immunization, IMMZ-aligned architecture, Phase 1.0 demo
 * scope. NOT IMMZ-conformant. Mirrors the posture documented in the Python
 * counterpart at api/src/hathor/fhir/provenance.py:
 *
 *   - We emit shapes that resemble the IMMZ CorePatientRecord / Immunization
 *     profile so a future Phase C step can swap this for an IMMZ-validated
 *     implementation without reshaping the UI data layer.
 *   - We do not claim conformance. Fields that have no clean IMMZ slot —
 *     most notably the per-row extraction confidence and the reasoning
 *     string from the vision pass — ride on local extensions flagged at
 *     the call site.
 *   - vaccineCode uses text-only CodeableConcept for the demo. CVX / ICD-11
 *     / SNOMED mappings are Phase 1.1 work per PRD §8.2.
 *
 * This module is pure: no I/O, no side effects. Take typed inputs, return
 * typed FHIR resources. The UI layer (ExportPanel in step 8) serializes.
 */

import type { ReconciledDose } from "./types";

// ── FHIR R4 resource shape fragments (hand-rolled, no SDK dep) ──────────────

export interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
}

export interface FhirReference {
  reference: string; // e.g., "Patient/abc-123"
  display?: string;
}

export interface FhirExtension {
  url: string;
  valueString?: string;
  valueDecimal?: number;
  valueBoolean?: boolean;
}

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  birthDate?: string; // YYYY-MM-DD
  gender?: "male" | "female" | "other" | "unknown";
  /** Redacted by design (PRD §5.4 payload minimization) — never include name
   * or identifier unless explicitly provided by the clinician after the
   * redaction canvas pass. */
}

export interface FhirImmunization {
  resourceType: "Immunization";
  id: string;
  status: "completed" | "entered-in-error" | "not-done";
  vaccineCode: FhirCodeableConcept;
  patient: FhirReference;
  occurrenceDateTime: string; // YYYY-MM-DD acceptable
  lotNumber?: string;
  protocolApplied?: Array<{
    doseNumberPositiveInt?: number;
    /** FHIR R4 string — HATHOR uses it to preserve booster / birth
     * classification from the source card so the letter and downstream
     * clinician can tell a primary dose from a booster. */
    series?: string;
    targetDisease?: FhirCodeableConcept[];
  }>;
  extension?: FhirExtension[];
}

export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  entry: Array<{ resource: FhirPatient | FhirImmunization }>;
}

// ── Extension URLs (local to HATHOR, not published) ─────────────────────────

/** Per-field OCR confidence from the vision pass, 0..1. No IMMZ slot. */
const EXT_EXTRACTION_CONFIDENCE =
  "http://hathor.health/fhir/StructureDefinition/extraction-confidence";

/** Plain-language reason for extraction uncertainty, rendered verbatim
 * to the clinician per PRD §5.6. No IMMZ slot. */
const EXT_EXTRACTION_REASONING =
  "http://hathor.health/fhir/StructureDefinition/extraction-reasoning";

// ── ID generation ───────────────────────────────────────────────────────────

function id(prefix: string): string {
  // `crypto.randomUUID` is available in Node 19+ and every supported browser
  // for this demo. No external dependency.
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${uuid}`;
}

// ── Builders ────────────────────────────────────────────────────────────────

export interface BuildPatientArgs {
  childDob: string; // YYYY-MM-DD
  gender?: FhirPatient["gender"];
}

export function buildPatient(args: BuildPatientArgs): FhirPatient {
  return {
    resourceType: "Patient",
    id: id("pat"),
    birthDate: args.childDob,
    ...(args.gender ? { gender: args.gender } : {}),
  };
}

/** protocolApplied[].series is a plain FHIR R4 string. We use it to
 * preserve whether a row was a primary, booster, birth, or unknown
 * dose class — the engine needs that to validate boosters, and the
 * letter reads it to label rows. No IMMZ slot change. */
export interface FhirProtocolApplied {
  doseNumberPositiveInt?: number;
  series?: string;
  targetDisease?: FhirCodeableConcept[];
}

/** Build a single Immunization resource from an engine-validated dose.
 *
 * Only called for doses where verdict.valid === true AND the engine
 * does not need clinician confirmation. PRD §5.6 Reasoning Safety
 * Loop: rows that are invalid OR that the engine deferred on stay in
 * the review UI / letter but are NOT written to the data bundle. */
export function buildImmunization(
  patient: FhirPatient,
  dose: ReconciledDose,
): FhirImmunization {
  if (!dose.verdict.valid) {
    throw new Error(
      `buildImmunization: refusing to emit resource for invalid dose ` +
        `(antigen=${dose.parsed.antigen}, dose_number=${dose.parsed.doseNumber}). ` +
        `PRD §5.6 — only engine-validated doses reach the FHIR bundle.`,
    );
  }

  if (dose.verdict.needs_clinician_confirmation) {
    throw new Error(
      `buildImmunization: refusing to emit resource for a dose the engine ` +
        `deferred on (antigen=${dose.parsed.antigen}, dose_kind=${dose.parsed.doseKind}). ` +
        `These rows stay in the clinician review surface until resolved.`,
    );
  }

  if (!dose.parsed.date) {
    throw new Error(
      `buildImmunization: dose has no date (antigen=${dose.parsed.antigen}). ` +
        `A date is required for FHIR occurrenceDateTime; this row should ` +
        `have been caught by the Vision Safety Loop.`,
    );
  }

  const ext: FhirExtension[] = [
    {
      url: EXT_EXTRACTION_CONFIDENCE,
      valueDecimal: dose.parsed.confidence,
    },
  ];
  if (dose.parsed.reasoningIfUncertain) {
    ext.push({
      url: EXT_EXTRACTION_REASONING,
      valueString: dose.parsed.reasoningIfUncertain,
    });
  }

  // Only emit protocolApplied when we have SOMETHING meaningful to put
  // in it — a numbered dose, a booster/birth class, or both. Empty
  // protocolApplied entries are valid FHIR but carry no information.
  const proto: FhirProtocolApplied = {};
  if (dose.parsed.doseNumber !== null) {
    proto.doseNumberPositiveInt = dose.parsed.doseNumber;
  }
  if (dose.parsed.doseKind === "booster" || dose.parsed.doseKind === "birth") {
    proto.series = dose.parsed.doseKind;
  }
  const hasProto =
    proto.doseNumberPositiveInt !== undefined ||
    proto.series !== undefined;

  return {
    resourceType: "Immunization",
    id: id("imm"),
    status: "completed",
    vaccineCode: { text: dose.parsed.antigen },
    patient: { reference: `Patient/${patient.id}` },
    occurrenceDateTime: dose.parsed.date,
    ...(dose.parsed.lotNumber ? { lotNumber: dose.parsed.lotNumber } : {}),
    ...(hasProto ? { protocolApplied: [proto] } : {}),
    extension: ext,
  };
}

/** Build a collection Bundle with one Patient + one Immunization per
 * engine-valid dose. Invalid doses and clinician-review-needed rows
 * are filtered out silently — see buildImmunization for the PRD §5.6
 * rationale. */
export function buildImmunizationBundle(
  patientArgs: BuildPatientArgs,
  doses: ReconciledDose[],
): FhirBundle {
  const patient = buildPatient(patientArgs);
  const immunizations = doses
    .filter(
      (d) =>
        d.verdict.valid &&
        !d.verdict.needs_clinician_confirmation &&
        d.parsed.date,
    )
    .map((d) => buildImmunization(patient, d));

  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      { resource: patient },
      ...immunizations.map((imm) => ({ resource: imm })),
    ],
  };
}
