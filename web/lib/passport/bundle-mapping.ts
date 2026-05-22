// SYNTHETIC TEST DATA — RESEARCH PROTOTYPE.
//
// Map a clinician-confirmed Hathor reconciliation result into the
// passport payload. Subject is reduced to initials + birth-month only;
// no full name, no exact DOB. Status comes from the engine verdict;
// source labels how the row reached this point (card / rules_engine /
// clinician_confirmed).

import {
  DEMO_ISSUER_ID,
  DEMO_ISSUER_NAME,
} from "./keys.ts";
import type {
  PassportImmunisation,
  PassportImmStatus,
  PassportImmSource,
  PassportPayload,
} from "./schema.ts";
import type { CountryCode, ReconciledDose } from "../types";

const SCHEDULE_CODES: Record<CountryCode, string> = {
  EG: "EG-NIP-2024",
  SD: "SD-EPI",
  SY: "SY-EPI",
  SS: "SS-EPI",
  ER: "ER-EPI",
  ET: "ET-EPI",
  NG: "NG-NPI-2024",
  WHO: "WHO-IVB-BASELINE",
};

export interface BundleMappingArgs {
  doses: ReconciledDose[];
  childDob: string;
  destinationCountry?: CountryCode;
  childInitials?: string;
  issuerName?: string;
  issuerId?: string;
}

function deriveBirthMonth(childDob: string): string {
  // childDob is ISO YYYY-MM-DD. We retain only YYYY-MM. If the input is
  // not parseable, return an empty string so downstream consumers can
  // surface the error rather than silently ship a malformed payload.
  if (typeof childDob !== "string") return "";
  const match = childDob.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : "";
}

function deriveStatus(d: ReconciledDose): PassportImmStatus {
  if (d.verdict.valid && !d.verdict.needs_clinician_confirmation) return "valid";
  return "invalid";
}

function deriveSource(d: ReconciledDose): PassportImmSource {
  const action = d.parsed.clinician_action;
  if (action === "confirmed" || action === "edited") return "clinician_confirmed";
  if (d.verdict.valid) return "rules_engine";
  return "card";
}

function shortLabel(antigen: string): string {
  // Vaccine codes in this codebase are already canonical and short
  // (BCG, DTP, MMR, OPV, IPV, PCV13, Rota, HepB, Hib, YF). Pass through;
  // any future longer label is truncated to 24 chars to defend the
  // QR payload budget.
  if (antigen.length <= 24) return antigen;
  return antigen.slice(0, 24);
}

export function bundleToPassportPayload(
  args: BundleMappingArgs,
): PassportPayload {
  const issuedAt = Math.floor(Date.now() / 1000);

  const immunisations: PassportImmunisation[] = args.doses
    .filter((d) => d.parsed.date && !d.verdict.needs_clinician_confirmation)
    .map((d) => ({
      vaccineCode: d.parsed.antigen,
      vaccineLabel: shortLabel(d.parsed.antigen),
      date: d.parsed.date as string,
      status: deriveStatus(d),
      source: deriveSource(d),
    }));

  const schedule = args.destinationCountry
    ? SCHEDULE_CODES[args.destinationCountry] ?? "UNKNOWN"
    : "UNKNOWN";

  return {
    subject: {
      initials: args.childInitials ?? "—",
      birthMonth: deriveBirthMonth(args.childDob),
    },
    issuer: {
      id: args.issuerId ?? DEMO_ISSUER_ID,
      name: args.issuerName ?? DEMO_ISSUER_NAME,
    },
    issuedAt,
    schedule,
    immunisations,
  };
}
