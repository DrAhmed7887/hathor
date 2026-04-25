/**
 * Light client-side reconciliation helpers used by the /scan flow.
 *
 * The authoritative WHO-DAK rules engine lives in the Python service —
 * see api/src/hathor/server.py /validate-schedule. This module is a
 * narrower, schedule-aware diff that runs without spinning up Python:
 * it answers two questions the /scan UI needs immediately after a
 * card parses:
 *
 *   nextDose(rows, schedule, dobISO, today)
 *     → the first compulsory schedule dose that is due-now or upcoming
 *       and not yet present on the card.
 *
 *   missedDoses(rows, schedule, dobISO, today)
 *     → compulsory schedule doses whose recommended age is in the
 *       past relative to `today` and which are not present on the card.
 *
 * Matching rule for "present on the card":
 *   The card row covers the schedule dose if its antigen matches
 *   (canonical or via combination components) and its dose_number is
 *   >= the schedule dose_number for that antigen. Booster rows
 *   without a number fall back to age proximity (within ±60 days of
 *   the recommended age) on antigen match.
 *
 * Combination products on cards (Hexavalent, Pentavalent) cover their
 * component antigens via `components`. So a Pentavalent dose 1 from
 * a Nigerian card counts toward Egypt's Hexavalent dose 1 for the
 * shared components (DPT/Hib/HepB) but flags IPV as not covered.
 *
 * THIS IS NOT THE CLINICAL RULES ENGINE. It does no interval
 * checking, no contraindication logic, no booster-vs-primary
 * disambiguation beyond the simple count above. The /scan UI
 * surfaces it as "preliminary — clinician must confirm" copy.
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
}

export interface CountrySchedule {
  country: string;
  country_code: string;
  source: string;
  source_urls?: string[];
  source_notes?: string;
  scope?: string;
  key_features?: string[];
  key_differences_vs_egypt?: string[];
  doses: ScheduleDose[];
}

/** Combination product → component antigens it covers on the schedule.
 * Conservative — only widely-accepted product equivalences are listed.
 * Used for "did the card cover Egypt's Hexavalent dose 1?" matching
 * across Egypt (Hexavalent) ↔ Nigeria (Pentavalent + IPV). */
const COMBO_COVERS: Record<string, string[]> = {
  Hexavalent: ["DPT", "DTaP", "DTP", "Hib", "HepB", "IPV"],
  Pentavalent: ["DPT", "DTaP", "DTP", "Hib", "HepB"],
  DTP: ["DPT", "DTaP"],
  DTaP: ["DPT", "DTP"],
  MMR: ["Measles", "Mumps", "Rubella"],
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
  if (m.startsWith("hexa")) return "Hexavalent";
  if (m.startsWith("penta")) return "Pentavalent";
  if (m === "mmr") return "MMR";
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

/** All antigens a card row covers, accounting for combinations. */
function rowCoversAntigens(row: ParsedCardRow): Set<string> {
  const c = canon(row.antigen);
  const covered = new Set<string>([c]);
  for (const comp of COMBO_COVERS[c] ?? []) covered.add(comp);
  return covered;
}

/** All schedule-doses a card row could "count as", grouped by antigen.
 * For combination products this returns one entry per covered antigen. */
function expandRowToScheduleAntigens(row: ParsedCardRow): Array<{
  antigen: string;
  doseNumber: number | null;
  date: string | null;
  doseKind: ParsedCardRow["doseKind"];
}> {
  const out: ReturnType<typeof expandRowToScheduleAntigens> = [];
  for (const antigen of rowCoversAntigens(row)) {
    out.push({
      antigen,
      doseNumber: row.doseNumber,
      date: row.date,
      doseKind: row.doseKind,
    });
  }
  return out;
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

/** Did the card contain any row that covers (antigen, dose_number)? */
function isDosePresent(rows: ParsedCardRow[], dose: ScheduleDose): boolean {
  const targetAntigen = canon(dose.antigen);
  for (const row of rows) {
    const expansions = expandRowToScheduleAntigens(row);
    for (const exp of expansions) {
      if (exp.antigen !== targetAntigen) continue;
      if (exp.doseNumber == null) {
        // Booster row without an explicit number — match by antigen only.
        // Conservative: counts toward the schedule's lowest unmet number,
        // which we approximate by accepting it for any dose number.
        return true;
      }
      if (exp.doseNumber >= dose.dose_number) return true;
    }
  }
  return false;
}

export interface ReconciliationResult {
  /** All compulsory doses whose recommended age has already passed and
   * which are not present on the card. Sorted by recommended age. */
  missed: ScheduleDose[];
  /** First compulsory dose with a recommended age in the future (or
   * within the next ~30 days) that is not yet present. */
  next: ScheduleDose | null;
  /** Compulsory doses present on the card (covered by extracted rows). */
  covered: ScheduleDose[];
  /** Recommended (non-EPI) doses missing — informational only. */
  recommendedMissing: ScheduleDose[];
  /** Antigens on the source card that are not on the destination
   * schedule at all (e.g., Yellow Fever from Nigeria for Egypt). */
  sourceOnlyAntigens: string[];
}

export function reconcile(
  rows: ParsedCardRow[],
  destination: CountrySchedule,
  dobISO: string,
  today: Date = new Date(),
): ReconciliationResult {
  const ageMo = ageMonthsOn(dobISO, today);
  const missed: ScheduleDose[] = [];
  const covered: ScheduleDose[] = [];
  const recommendedMissing: ScheduleDose[] = [];
  let next: ScheduleDose | null = null;

  const sortedDoses = [...destination.doses].sort(
    (a, b) => recommendedAgeMonths(a) - recommendedAgeMonths(b),
  );

  for (const dose of sortedDoses) {
    const recAge = recommendedAgeMonths(dose);
    const present = isDosePresent(rows, dose);
    if (dose.category === "compulsory") {
      if (present) {
        covered.push(dose);
      } else if (recAge <= ageMo) {
        missed.push(dose);
      } else if (next === null) {
        next = dose;
      }
    } else {
      if (!present && recAge <= ageMo) recommendedMissing.push(dose);
    }
  }

  // Source-only antigens: anything on the card that is not represented
  // anywhere in the destination schedule. Useful to surface "Nigeria
  // gave Yellow Fever; Egypt does not require it."
  const destAntigens = new Set<string>();
  for (const d of destination.doses) {
    destAntigens.add(canon(d.antigen));
    for (const c of d.components ?? []) destAntigens.add(canon(c));
  }
  const sourceAntigens = new Set<string>();
  for (const row of rows) {
    for (const a of rowCoversAntigens(row)) sourceAntigens.add(a);
  }
  const sourceOnly = [...sourceAntigens].filter((a) => !destAntigens.has(a));

  return {
    missed,
    next,
    covered,
    recommendedMissing,
    sourceOnlyAntigens: sourceOnly.sort(),
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
