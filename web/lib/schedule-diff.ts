/**
 * Light client-side reconciliation helpers used by the /scan flow.
 *
 * The authoritative WHO-DAK rules engine lives in the Python service —
 * see api/src/hathor/server.py /validate-schedule. This module is a
 * narrower, schedule-aware diff that runs without spinning up Python:
 * it answers two questions the /scan UI needs immediately after a
 * card parses:
 *
 *   nextAction(rows, schedule, dobISO, today)
 *     → the most clinically urgent action: an overdue uncovered
 *       compulsory dose if one exists (catch-up framing), otherwise
 *       the next routine compulsory dose that is upcoming.
 *
 *   coverage(rows, schedule, dobISO, today)
 *     → per-destination-dose breakdown: which component antigens
 *       the source card covered, and which are still missing.
 *
 * Per-component matching (the load-bearing rule):
 *   A destination dose carries a `components` array (e.g. Egypt's
 *   Hexavalent → ["DPT","Hib","HepB","IPV"]). The engine asks, for
 *   each component, whether any card row delivered it at a
 *   sufficient dose number. A card row delivers the antigens that
 *   its trade name expands to (Pentavalent → DPT+Hib+HepB; Hexavalent
 *   → DPT+Hib+HepB+IPV; standalones deliver themselves).
 *
 *   Result: Pentavalent dose 1 from a Nigerian card *partially*
 *   covers Egypt's Hexavalent dose 1 — three of four components are
 *   delivered, IPV is still missing. The old name-only matcher would
 *   have flagged the whole Hexavalent dose as missing, over-counting
 *   gaps and hiding the partial overlap from the clinician.
 *
 * THIS IS NOT THE CLINICAL RULES ENGINE. It does no interval
 * checking, no contraindication logic, no birth-dose vs primary
 * disambiguation, no minimum-age enforcement. The /scan UI surfaces
 * it as "preliminary — clinician must confirm" copy.
 */

import type { ParsedCardRow } from "./types";

export interface ScheduleDose {
  antigen: string;
  dose_number: number;
  category: "compulsory" | "recommended";
  recommended_age_months?: number;
  recommended_age_weeks?: number;
  minimum_age_months?: number;
  minimum_age_weeks?: number;
  components?: string[];
  notes?: string;
  /** Marks a dose that must be given on day 1 of life (e.g. Egypt's
   * HepB birth dose). The engine only credits it when a card row
   * carries `doseKind === "birth"` for the same antigen — later
   * combination doses (e.g. Pentavalent at 6 weeks containing HepB)
   * do NOT satisfy a birth dose. The clinical reason is vertical
   * HBV transmission, which the birth-window dose specifically
   * targets and which a 6-week-old combination cannot rescue. */
  birth_dose?: boolean;
}

export interface CountrySchedule {
  country: string;
  country_code: string;
  source: string;
  source_urls?: string[];
  source_notes?: string;
  scope?: string;
  version?: string;
  last_updated?: string;
  key_features?: string[];
  key_differences_vs_egypt?: string[];
  doses: ScheduleDose[];
}

/** Combination product → component antigens it delivers. The card
 * carries a trade-name string (`row.antigen`); this table expands it
 * to the canonical components the destination schedule speaks. The
 * Haiku normalizer (`web/lib/antigen-normalizer.ts`) writes the same
 * expansion to `row.canonicalAntigens` when the demo flag is on; this
 * table is the always-on fallback so the engine works even when the
 * normalizer didn't run. Conservative — only widely-accepted
 * equivalences. */
const COMBO_COVERS: Record<string, string[]> = {
  Hexavalent: ["DPT", "DTaP", "DTP", "Hib", "HepB", "IPV"],
  Pentavalent: ["DPT", "DTaP", "DTP", "Hib", "HepB"],
  DTP: ["DPT", "DTaP"],
  DTaP: ["DPT", "DTP"],
  MMR: ["Measles", "Mumps", "Rubella"],
  MMRV: ["MMR", "Measles", "Mumps", "Rubella", "Varicella"],
};

/** Canonical-ize an antigen label so card text + schedule labels can
 * be compared. Maps common variants to a single key. */
function canon(raw: string): string {
  const t = raw.trim();
  const m = t.toLowerCase();
  if (m.startsWith("opv")) return "OPV";
  if (m.startsWith("ipv")) return "IPV";
  if (m === "bcg") return "BCG";
  if (m.startsWith("hep b") || m.startsWith("hepb") || m === "hbv") return "HepB";
  if (m.startsWith("hep a") || m.startsWith("hepa")) return "HepA";
  if (m.startsWith("hexa") || m === "hexyon" || m === "infanrix hexa")
    return "Hexavalent";
  if (m.startsWith("penta") || m === "pentavac" || m === "easyfive")
    return "Pentavalent";
  if (m === "mmr") return "MMR";
  if (m === "mmrv") return "MMRV";
  if (m.startsWith("measles")) return "Measles";
  if (m.startsWith("rota")) return "Rotavirus";
  if (m.startsWith("pcv")) return "PCV";
  if (m.startsWith("dtap")) return "DTaP";
  if (m.startsWith("dtp") || m.startsWith("dpt")) return "DTP";
  if (m === "dt") return "DT";
  if (m.startsWith("var")) return "Varicella";
  if (m.startsWith("yellow")) return "YellowFever";
  if (m.startsWith("men")) return "MenACWY";
  return t.replace(/\s+/g, "");
}

/** Components the row delivered, in canonical form. Prefers the
 * normalizer's `canonicalAntigens` if present; otherwise falls back
 * to the local COMBO_COVERS table. The row's own canonicalized
 * antigen is always included so standalones (e.g. "BCG") map to
 * themselves. */
function rowDeliversComponents(row: ParsedCardRow): Set<string> {
  const out = new Set<string>();
  if (row.canonicalAntigens && row.canonicalAntigens.length > 0) {
    for (const a of row.canonicalAntigens) out.add(canon(a));
  }
  const c = canon(row.antigen);
  out.add(c);
  for (const comp of COMBO_COVERS[c] ?? []) out.add(comp);
  return out;
}

/** Components a destination dose requires. Falls back to the dose's
 * own antigen when no `components` array is declared (standalone
 * doses like MMR or BCG). */
function doseRequiresComponents(dose: ScheduleDose): string[] {
  if (dose.components && dose.components.length > 0) {
    return dose.components.map(canon);
  }
  return [canon(dose.antigen)];
}

export function ageMonthsOn(dobISO: string, on: Date): number {
  const dob = new Date(`${dobISO}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return 0;
  const ms = on.getTime() - dob.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}

function recommendedAgeMonths(dose: ScheduleDose): number {
  if (typeof dose.recommended_age_months === "number")
    return dose.recommended_age_months;
  if (typeof dose.recommended_age_weeks === "number")
    return dose.recommended_age_weeks / 4.345;
  return 0;
}

/** A row that delivered a particular component for a particular
 * destination dose. The UI uses this to render "Hexavalent #1: DPT,
 * Hib, HepB delivered by Pentavalent #1 (24-04-2023)". */
export interface ComponentDelivery {
  component: string;
  rowAntigen: string;
  rowDoseNumber: number | null;
  rowDate: string | null;
}

export interface DoseCoverage {
  dose: ScheduleDose;
  /** Status across all required components. */
  status: "covered" | "partial" | "missing";
  /** All components this destination dose requires (canonical). */
  requiredComponents: string[];
  /** Components delivered by some card row, with provenance. */
  delivered: ComponentDelivery[];
  /** Components with no delivering row. */
  missingComponents: string[];
  /** Set when the dose carries a clinical nuance the UI must
   * surface — currently only for `birth_dose` doses where the engine
   * refused to credit a later combination row that DID carry the
   * antigen. Example: HepB birth dose missing on the card, but
   * Pentavalent #1/2/3 are present — the note explains that the
   * series doses do not retroactively satisfy a birth dose. Null
   * when no contextual note is needed (the standard "missing"
   * framing is enough). */
  clinicalNote?: string | null;
}

/** Find a card row that delivers `component` at a dose number ≥ the
 * destination dose's dose_number. Booster rows (doseNumber == null)
 * are accepted on antigen match. When `birthDoseRequired` is true,
 * only rows with `doseKind === "birth"` are eligible — this prevents
 * a later combination dose (e.g. Pentavalent at 6 weeks containing
 * HepB) from silently satisfying Egypt's HepB birth-dose requirement,
 * which exists specifically to interrupt vertical HBV transmission
 * and cannot be rescued retroactively. */
function findCoveringRow(
  rows: ParsedCardRow[],
  component: string,
  destDoseNumber: number,
  birthDoseRequired: boolean,
): ParsedCardRow | null {
  for (const row of rows) {
    const delivered = rowDeliversComponents(row);
    if (!delivered.has(component)) continue;
    if (birthDoseRequired && row.doseKind !== "birth") continue;
    if (row.doseNumber == null) return row;
    if (row.doseNumber >= destDoseNumber) return row;
  }
  return null;
}

/** Detect the case the clinician needs to see: a birth-dose was not
 * satisfied, but the same component WAS delivered by a later
 * non-birth row. Returns a sentence explaining why the engine
 * refused to credit it; null when no such row exists (silence is
 * fine — the standard "missing" framing covers it). */
function birthDoseClinicalNote(
  rows: ParsedCardRow[],
  dose: ScheduleDose,
  missingComponents: string[],
): string | null {
  if (!dose.birth_dose) return null;
  const explanations: string[] = [];
  for (const component of missingComponents) {
    const consolation = rows.find((row) => {
      if (row.doseKind === "birth") return false;
      const delivered = rowDeliversComponents(row);
      return delivered.has(component);
    });
    if (consolation) {
      explanations.push(
        `${dose.antigen} birth dose not documented on card. Later ${dose.antigen}-containing ${consolation.antigen} doses were documented, but they do not prove birth-dose administration — the birth dose protects against vertical transmission and cannot be rescued by a later combination dose.`,
      );
    }
  }
  return explanations[0] ?? null;
}

export function coverageForDose(
  rows: ParsedCardRow[],
  dose: ScheduleDose,
): DoseCoverage {
  const requiredComponents = doseRequiresComponents(dose);
  const delivered: ComponentDelivery[] = [];
  const missingComponents: string[] = [];
  const birthDoseRequired = dose.birth_dose === true;

  for (const component of requiredComponents) {
    const row = findCoveringRow(
      rows,
      component,
      dose.dose_number,
      birthDoseRequired,
    );
    if (row) {
      delivered.push({
        component,
        rowAntigen: row.antigen,
        rowDoseNumber: row.doseNumber,
        rowDate: row.date,
      });
    } else {
      missingComponents.push(component);
    }
  }

  let status: DoseCoverage["status"];
  if (missingComponents.length === 0) status = "covered";
  else if (delivered.length === 0) status = "missing";
  else status = "partial";

  const clinicalNote = birthDoseClinicalNote(rows, dose, missingComponents);

  return {
    dose,
    status,
    requiredComponents,
    delivered,
    missingComponents,
    clinicalNote,
  };
}

export type NextAction =
  | { kind: "catchup_overdue"; coverage: DoseCoverage; overdueCount: number }
  | { kind: "routine_upcoming"; coverage: DoseCoverage }
  | null;

export interface ReconciliationResult {
  /** Compulsory doses where every required component was delivered. */
  covered: DoseCoverage[];
  /** Compulsory doses where some — but not all — components were
   * delivered. Pentavalent against Egypt's Hexavalent lands here:
   * DPT + Hib + HepB are delivered, IPV is in `missingComponents`. */
  partial: DoseCoverage[];
  /** Compulsory doses with recommended age in the past where NO
   * component was delivered. The most clinically urgent gap class. */
  missed: DoseCoverage[];
  /** Compulsory doses with recommended age in the future, not yet
   * covered. Surfaced as the routine "next dose" when no catch-up
   * is overdue. */
  upcoming: DoseCoverage[];
  /** Recommended (private / non-EPI) doses that are missing or
   * partial. Informational — the UI displays these separately so the
   * clinician can see private-uptake gaps without inflating the
   * compulsory missing count. */
  recommendedMissing: DoseCoverage[];
  /** The single most urgent next clinical action. Catch-up (an
   * entirely uncovered overdue compulsory dose) outranks the next
   * routine upcoming dose, so a 3-year-old missing MMR is not told
   * "your next dose is DT at 54 months". */
  nextAction: NextAction;
  /** Antigens delivered by the card that don't appear anywhere on
   * the destination schedule (e.g. Yellow Fever from Nigeria for
   * Egypt). Preserve on record, not counted as missing. */
  sourceOnlyAntigens: string[];
}

/** Pick the single most urgent next action.
 *
 *   1. If any compulsory `missed` dose exists (recommended age in the
 *      past, NO component delivered), return the earliest such dose.
 *      This is the catch-up framing the clinician needs — a 3-year-old
 *      missing MMR 1 should not be steered to the school-age DT
 *      booster as the "next dose".
 *   2. Otherwise, return the earliest `upcoming` dose. Partial doses
 *      do NOT trigger a catch-up — they may already be clinically
 *      acceptable depending on local equivalence rules; the UI
 *      surfaces them in their own section for clinician review.
 *   3. Otherwise, null. */
function pickNextAction(
  missed: DoseCoverage[],
  upcoming: DoseCoverage[],
): NextAction {
  if (missed.length > 0) {
    const earliest = missed[0];
    return {
      kind: "catchup_overdue",
      coverage: earliest,
      overdueCount: missed.length,
    };
  }
  if (upcoming.length > 0) {
    return { kind: "routine_upcoming", coverage: upcoming[0] };
  }
  return null;
}

export function reconcile(
  rows: ParsedCardRow[],
  destination: CountrySchedule,
  dobISO: string,
  today: Date = new Date(),
): ReconciliationResult {
  const ageMo = ageMonthsOn(dobISO, today);
  const covered: DoseCoverage[] = [];
  const partial: DoseCoverage[] = [];
  const missed: DoseCoverage[] = [];
  const upcoming: DoseCoverage[] = [];
  const recommendedMissing: DoseCoverage[] = [];

  const sortedDoses = [...destination.doses].sort(
    (a, b) => recommendedAgeMonths(a) - recommendedAgeMonths(b),
  );

  for (const dose of sortedDoses) {
    const cov = coverageForDose(rows, dose);
    const recAge = recommendedAgeMonths(dose);

    if (dose.category === "compulsory") {
      if (cov.status === "covered") {
        covered.push(cov);
      } else if (cov.status === "partial") {
        partial.push(cov);
      } else if (recAge <= ageMo) {
        missed.push(cov);
      } else {
        upcoming.push(cov);
      }
    } else if (cov.status !== "covered" && recAge <= ageMo) {
      recommendedMissing.push(cov);
    }
  }

  // Source-only antigens: a row's *primary* antigen (canonicalized)
  // whose expansion has zero overlap with anything Egypt's schedule
  // asks for. Two pitfalls this avoids:
  //   - A row whose primary antigen IS Egypt-relevant (e.g. MMR,
  //     which Egypt requires) must not contribute its component
  //     expansions (Measles, Mumps, Rubella) to the source-only
  //     list. Egypt covers them via the combination, not as
  //     stand-alone schedule entries.
  //   - Combination trade names themselves (Hexavalent, Pentavalent)
  //     are never "source-only" — they're carriers; the components
  //     are what get matched.
  const destAntigens = new Set<string>();
  for (const d of destination.doses) {
    destAntigens.add(canon(d.antigen));
    for (const c of d.components ?? []) destAntigens.add(canon(c));
  }
  const comboNames = new Set(Object.keys(COMBO_COVERS));
  const sourceOnlySet = new Set<string>();
  for (const row of rows) {
    const primary = canon(row.antigen);
    if (comboNames.has(primary)) continue;
    const delivered = rowDeliversComponents(row);
    let overlap = false;
    for (const d of delivered) {
      if (destAntigens.has(d)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) sourceOnlySet.add(primary);
  }
  const sourceOnly = [...sourceOnlySet].sort();

  return {
    covered,
    partial,
    missed,
    upcoming,
    recommendedMissing,
    nextAction: pickNextAction(missed, upcoming),
    sourceOnlyAntigens: sourceOnly,
  };
}

/** Format a recommended age for display ("12 months", "6 weeks"). */
export function formatScheduleAge(dose: ScheduleDose): string {
  if (typeof dose.recommended_age_months === "number") {
    const m = dose.recommended_age_months;
    if (m === 0) return "at birth";
    if (m < 1) return `${Math.round(m * 30)} days`;
    if (m < 12) return `${m} month${m === 1 ? "" : "s"}`;
    if (m % 12 === 0) return `${m / 12} year${m === 12 ? "" : "s"}`;
    return `${m} months`;
  }
  if (typeof dose.recommended_age_weeks === "number") {
    return `${dose.recommended_age_weeks} weeks`;
  }
  return "—";
}
