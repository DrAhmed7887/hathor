/**
 * Country metadata for the HATHOR Phase 1.0 demo.
 *
 * Hackathon scope (per CLAUDE.md, intra-Africa Phase 1):
 *   - Egypt is the validated destination schedule (partial_ready).
 *   - Sudan, South Sudan, Eritrea, Ethiopia are surfaced as
 *     needs_review countries motivated by the most relevant African
 *     refugee/asylum-seeker groups in Egypt (UNHCR Egypt operational
 *     data). Their schedules and synonym maps are NOT clinically
 *     verified for definitive reconciliation; the UI gates that
 *     accordingly.
 *   - Nigeria is OPTIONALLY included as an English-language demo
 *     source country. It is NOT claimed to be a top migration group
 *     into Egypt by number — the README and the UI must reflect that.
 *
 * Engine support is independent of this file. The /validate-schedule
 * engine carries a ground-truth Egypt schedule today; calling it for a
 * needs_review destination would yield Egypt-rules verdicts mislabeled
 * as that country's recommendations. The selector enforces the gate.
 *
 * Deliberate non-duplication: interval rules and minimum ages live in
 * api/src/hathor/tools/dose_validation.py. This file holds only display
 * metadata and the readiness flag.
 */

import type {
  CardLanguage,
  CountryCode,
  CountryReadiness,
  WritingDirection,
} from "./types";

export interface CountryProfile {
  code: CountryCode;
  /** Human-readable name in English. */
  name: string;
  /** Localised name (Arabic / Tigrinya / Amharic / etc.) for the
   * bilingual selector label. Optional — falls back to `name`. */
  nameLocal?: string;
  /** Primary card language(s) the vision pass should expect. Used as a
   * hint to /api/parse-card; does not constrain the model. */
  cardLanguages: readonly CardLanguage[];
  /** Writing direction of the PRIMARY card layout. */
  writingDirection: WritingDirection;
  /** Whether the schedule under data/schedules/<code>.json is
   * clinically verified for this demo. See CountryReadiness. */
  readiness: CountryReadiness;
  /** Canonical routine-card antigens observed at 0–6y, scoped to what
   * the engine knows. needs_review countries still expose this for the
   * review UI to label rows but do NOT drive engine reconciliation. */
  routineAntigens: readonly string[];
  /** Short demo-facing description; rendered next to the selector. */
  blurb: string;
  /** Optional notes surfaced in the audit-trail UI. Keep short. */
  notes?: readonly string[];
}

const ENGINE_ANTIGENS_AFRICA = [
  "BCG",
  "HepB",
  "OPV",
  "IPV",
  "DTP",
  "Hib",
  "PCV",
  "Rotavirus",
  "Measles",
  "MMR",
] as const;

const EGYPT: CountryProfile = {
  code: "EG",
  name: "Egypt",
  nameLocal: "مصر",
  cardLanguages: ["ar", "en", "mixed"],
  writingDirection: "rtl",
  readiness: "partial_ready",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA],
  blurb:
    "Phase 1 destination schedule. Egyptian MoHP mandatory childhood immunizations (التطعيمات الإجبارية), clinically reviewed for the demo.",
  notes: [
    "Hexavalent at 2/4/6 months covers IPV. Egypt EPI exact measles first-dose age (9 vs 12 months), HPV dose count, and TCV inclusion remain open and follow engine defaults until clinician confirmation.",
  ],
};

const SUDAN: CountryProfile = {
  code: "SD",
  name: "Sudan",
  nameLocal: "السودان",
  cardLanguages: ["ar", "en", "mixed"],
  writingDirection: "rtl",
  readiness: "needs_review",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA, "YellowFever", "MenA"],
  blurb:
    "Surfaced for the review-workflow demonstration (UNHCR-relevant population in Egypt). Schedule under verification — no auto-reconciliation.",
};

const SOUTH_SUDAN: CountryProfile = {
  code: "SS",
  name: "South Sudan",
  cardLanguages: ["en", "ar", "mixed"],
  writingDirection: "ltr",
  readiness: "needs_review",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA, "YellowFever", "MenA"],
  blurb:
    "Surfaced for the review-workflow demonstration (UNHCR-relevant population in Egypt). Schedule under verification — no auto-reconciliation.",
};

const ERITREA: CountryProfile = {
  code: "ER",
  name: "Eritrea",
  nameLocal: "ኤርትራ",
  cardLanguages: ["ti", "en", "ar", "mixed"],
  writingDirection: "ltr",
  readiness: "needs_review",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA, "YellowFever"],
  blurb:
    "Surfaced for the review-workflow demonstration (UNHCR-relevant population in Egypt). Schedule under verification — no auto-reconciliation.",
};

const ETHIOPIA: CountryProfile = {
  code: "ET",
  name: "Ethiopia",
  nameLocal: "ኢትዮጵያ",
  cardLanguages: ["am", "en", "mixed"],
  writingDirection: "ltr",
  readiness: "needs_review",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA, "YellowFever", "MenA"],
  blurb:
    "Surfaced for the review-workflow demonstration (UNHCR-relevant population in Egypt). Schedule under verification — no auto-reconciliation.",
};

const NIGERIA: CountryProfile = {
  code: "NG",
  name: "Nigeria",
  cardLanguages: ["en"],
  writingDirection: "ltr",
  readiness: "needs_review",
  routineAntigens: [...ENGINE_ANTIGENS_AFRICA, "YellowFever"],
  blurb:
    "Optional English-language demo source country. NOT presented as a top-by-number African migration group to Egypt — included for English-card demonstration only.",
  notes: [
    "Engine seed is present in the repo; reconciliation gating defers to the same needs_review banner as the other African countries until clinical sign-off.",
  ],
};

export const COUNTRIES: Readonly<Record<CountryCode, CountryProfile>> = {
  EG: EGYPT,
  SD: SUDAN,
  SS: SOUTH_SUDAN,
  ER: ERITREA,
  ET: ETHIOPIA,
  NG: NIGERIA,
};

/** Egypt is the only partial-ready destination for this hackathon. */
export const VALIDATED_DESTINATION: CountryCode = "EG";

/** Source-country options shown in the selector, in the order the demo
 * narrates them: Egypt first (the host), then the four UNHCR-relevant
 * African countries, then optional Nigeria as an English-card demo. */
export const SELECTABLE_SOURCE_COUNTRIES: readonly CountryProfile[] = [
  EGYPT,
  SUDAN,
  SOUTH_SUDAN,
  ERITREA,
  ETHIOPIA,
  NIGERIA,
];

/** Destination options — Egypt is the only partial-ready schedule.
 * needs_review entries appear so a clinician can pick them, but the
 * UI gates reconciliation downstream. */
export const SELECTABLE_DESTINATION_COUNTRIES: readonly CountryProfile[] = [
  EGYPT,
  SUDAN,
  SOUTH_SUDAN,
  ERITREA,
  ETHIOPIA,
  NIGERIA,
];

/** @deprecated Kept for source-compat with earlier call sites that
 * imported a single SELECTABLE_COUNTRIES list. New code should pick
 * SELECTABLE_SOURCE_COUNTRIES or SELECTABLE_DESTINATION_COUNTRIES. */
export const SELECTABLE_COUNTRIES: readonly CountryProfile[] =
  SELECTABLE_SOURCE_COUNTRIES;

export function getCountry(code: CountryCode): CountryProfile {
  return COUNTRIES[code];
}

/** True when the destination schedule is clinically verified for this
 * demo and `/validate-schedule` may run. Anything else MUST surface
 * the "Schedule under review" banner instead of due/overdue verdicts. */
export function canRunReconciliation(destination: CountryCode): boolean {
  return COUNTRIES[destination].readiness === "partial_ready";
}

/** Single source of truth for the readiness banner copy used on the
 * selector and the schedule view. Keeps wording consistent. */
export const READINESS_BANNER = {
  partial_ready: {
    label: "Partial-ready schedule",
    body:
      "Schedule has been clinician-reviewed for the Phase 1 demo. Recommendations require clinician confirmation before any clinical action.",
  },
  needs_review: {
    label: "Schedule under review",
    body:
      "This country's schedule and synonym map are not clinically verified for the demo. Hathor will extract and review the card, but will NOT produce definitive due / overdue / catch-up verdicts. Confirm with public-health guidance.",
  },
} as const;

/** Disclosure shown on the country picker. Kept short so it can sit
 * underneath the dropdowns without dominating the page. */
export const COUNTRY_SELECTOR_DISCLOSURE =
  "Country schedules are source-backed where available and require clinician/public-health confirmation. Egypt is the current partial-ready schedule. Other country schedules are included for review-workflow demonstration and remain under verification.";
