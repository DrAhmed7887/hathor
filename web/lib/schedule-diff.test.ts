import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { reconcile, type CountrySchedule } from "./schedule-diff.ts";
import type { ParsedCardRow } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const egyptSchedule = JSON.parse(
  readFileSync(resolve(here, "../../data/schedules/egypt.json"), "utf8"),
) as CountrySchedule;

// Synthetic card matching cards/synthetic-amina-bello-nigeria-handwritten.jpg.
// Nigerian NPI series: BCG + OPV birth, Pentavalent ×3 at 6/10/14 weeks,
// Rotavirus, Measles monovalent + Yellow Fever at 9 months. No IPV row,
// no HepB-birth row, no MMR. Born 12 March 2023; reconciliation as-of
// 26 April 2026 (~37 months old).
const aminaRows: ParsedCardRow[] = [
  row("BCG",         1,    "2023-03-12", "birth"),
  row("OPV",         0,    "2023-03-12", "birth"),
  row("Pentavalent", 1,    "2023-04-24", "primary"),
  row("Pentavalent", 2,    "2023-05-22", "primary"),
  row("Pentavalent", 3,    "2023-06-19", "primary"),
  row("Rotavirus",   1,    "2023-04-24", "primary"),
  row("Measles",     1,    "2023-12-18", "primary"),
  row("YellowFever", 1,    "2023-12-18", "primary"),
];

const aminaDob = "2023-03-12";
const aminaAsOf = new Date("2026-04-26T00:00:00Z");

function row(
  antigen: string,
  doseNumber: number,
  date: string,
  doseKind: ParsedCardRow["doseKind"],
): ParsedCardRow {
  return {
    antigen,
    doseNumber,
    date,
    doseKind,
    confidence: 1,
    imageCropRegion: { x: 0, y: 0, width: 0, height: 0 },
  };
}

describe("Egypt v2.1 reconciliation against Nigerian Pentavalent card", () => {
  test("Nigerian Pentavalent ×3 fully covers Egypt's Pentavalent ×3, but the separate single IPV at 4 months remains uncovered", () => {
    const r = reconcile(aminaRows, egyptSchedule, aminaDob, aminaAsOf);

    // Egypt v2.1 models the public-EPI primary series as Pentavalent
    // (DPT+Hib+HepB) at 2/4/6 months — NOT Hexavalent. So three
    // Nigerian Pentavalent rows match three Egyptian Pentavalent
    // doses fully, with no `partial` for that antigen. Locking this
    // in prevents a regression to the v2.0 modeling which treated
    // them as partial because Hexavalent included IPV.
    const coveredKeys = r.covered.map((c) => `${c.dose.antigen}#${c.dose.dose_number}`);
    assert.ok(coveredKeys.includes("Pentavalent#1"), `expected Pentavalent#1 in covered, got ${JSON.stringify(coveredKeys)}`);
    assert.ok(coveredKeys.includes("Pentavalent#2"));
    assert.ok(coveredKeys.includes("Pentavalent#3"));

    const partialKeys = r.partial.map((c) => `${c.dose.antigen}#${c.dose.dose_number}`);
    assert.deepEqual(partialKeys, [], `Pentavalent should be fully covered, not partial — got partial=${JSON.stringify(partialKeys)}`);

    // Egypt v2.1 has IPV #1 at 4 months as a discrete dose. The
    // Amina card has no IPV row, so this lands in `missed`.
    const missedKeys = r.missed.map((c) => `${c.dose.antigen}#${c.dose.dose_number}`);
    assert.ok(missedKeys.includes("IPV#1"), `expected IPV#1 in missed, got ${JSON.stringify(missedKeys)}`);
  });

  test("HepB birth dose is not credited to later Pentavalent doses, and the clinician sees a contextual note explaining why", () => {
    const r = reconcile(aminaRows, egyptSchedule, aminaDob, aminaAsOf);

    const hepb1 = r.missed.find(
      (c) => c.dose.antigen === "HepB" && c.dose.dose_number === 1,
    );
    assert.ok(
      hepb1,
      "HepB #1 must land in `missed` even though Pentavalent rows carry HepB component — vertical-transmission protection cannot be rescued by a 6-week dose",
    );
    assert.equal(hepb1.dose.birth_dose, true, "HepB #1 must carry birth_dose:true in egypt.json");
    assert.equal(hepb1.status, "missing");
    assert.deepEqual(hepb1.delivered, [], "no row should be credited as delivering the birth dose");
    assert.ok(
      hepb1.clinicalNote && hepb1.clinicalNote.includes("birth-dose"),
      `expected a clinicalNote explaining the birth-dose distinction, got ${JSON.stringify(hepb1.clinicalNote)}`,
    );
    assert.ok(
      hepb1.clinicalNote!.includes("Pentavalent"),
      "the note must reference the specific later vaccine that was documented (Pentavalent), so the clinician can connect it to the card",
    );
  });
});
