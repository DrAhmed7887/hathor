/**
 * Nigeria and Egypt metadata for the HATHOR Phase 1.0 demo.
 *
 * Scope discipline (PRD §8.2): Nigeria → Egypt is the ONE validated country
 * pair. The UI must not pretend to support arbitrary countries. Adding
 * another country here without PRD approval is out of scope.
 *
 * Deliberate non-duplication: the interval and minimum-age logic lives in
 * the Python engine (api/src/hathor/tools/dose_validation.py —
 * MIN_AGE_DAYS, MAX_AGE_DAYS, INTERVAL_RULES). The frontend does NOT
 * re-encode those rules here. This file holds only:
 *   - display metadata (name, code, language, writing direction)
 *   - the canonical list of antigens the UI should expect on a card from
 *     that country (for parse-card schema hints + ScheduleView labels)
 *   - PRD-linked notes for ambiguities flagged in §9 Open Questions
 *
 * The engine remains the single source of truth for schedule correctness.
 */

import type { CardLanguage, CountryCode, WritingDirection } from "./types";

export interface CountryProfile {
  code: CountryCode;
  name: string;
  /** Primary card language(s) the vision pass should expect. Used as a
   * hint to /api/parse-card, not as a filter — a Nigerian card presented
   * in a Cairo clinic may contain Arabic annotations. */
  cardLanguages: readonly CardLanguage[];
  /** Writing direction of the PRIMARY card layout. Drives RTL toggles in
   * ParsedResults (PRD §6 point 5). */
  writingDirection: WritingDirection;
  /** Canonical routine-card antigens observed at the target age range
   * (0–6y). Must be a subset of antigens the engine covers; adding an
   * antigen here that the engine does not have an INTERVAL_RULE for
   * silently de-risks validation. */
  routineAntigens: readonly string[];
  /** Open-question notes to surface in the UI audit trail. Keep short. */
  notes?: readonly string[];
}

/**
 * Engine coverage (as of commit d2cccc7):
 *   BCG, HepB, bOPV/OPV, IPV, DTP-containing (pentavalent), Hib, PCV,
 *   Rotavirus, MMR/Measles.
 *
 * Antigens the engine does NOT cover (PRD §8.2, explicitly out of scope):
 *   DT, HepA, MenA, MenACWY, MenC, Mumps, Rubella, YellowFever.
 *
 * Only engine-covered antigens are listed in routineAntigens below.
 */

const NIGERIA: CountryProfile = {
  code: "NG",
  name: "Nigeria",
  cardLanguages: ["en"],
  writingDirection: "ltr",
  routineAntigens: [
    "BCG",
    "HepB",
    "OPV",
    "IPV",
    "DTP",
    "Hib",
    "PCV",
    "Rotavirus",
    "Measles",
  ],
  notes: [
    // PRD §1.1 — validated source country for Phase 1.
    "Phase 1 validated source country. Cards typically printed in English.",
  ],
};

const EGYPT: CountryProfile = {
  code: "EG",
  name: "Egypt",
  // Cairo / Alexandria MCH clinics see a mix: Arabic-primary cards from
  // Egypt itself, English cards from Nigeria, and bilingual or
  // Arabic-only refugee cards from Sudan, Syria, Gaza (PRD §1.2, §3.1).
  cardLanguages: ["ar", "en", "mixed"],
  writingDirection: "rtl",
  routineAntigens: [
    "BCG",
    "HepB",
    "OPV",
    "IPV",
    "DTP",
    "Hib",
    "PCV",
    "Rotavirus",
    "MMR",
  ],
  notes: [
    // PRD §1.1 — validated destination country for Phase 1.
    "Phase 1 validated destination country. Egyptian EPI exact measles " +
      "first-dose age (9 vs. 12 months), HPV dose count, TCV / HepA / " +
      "yellow fever inclusion all flagged as PRD §9.1 open questions — " +
      "engine defaults apply until confirmed.",
  ],
};

export const COUNTRIES: Readonly<Record<CountryCode, CountryProfile>> = {
  NG: NIGERIA,
  EG: EGYPT,
};

export const VALIDATED_SOURCE: CountryCode = "NG";
export const VALIDATED_DESTINATION: CountryCode = "EG";

export function getCountry(code: CountryCode): CountryProfile {
  return COUNTRIES[code];
}

/** For dropdown / selector UIs. Order: source first, destination second. */
export const SELECTABLE_COUNTRIES: readonly CountryProfile[] = [
  NIGERIA,
  EGYPT,
];
