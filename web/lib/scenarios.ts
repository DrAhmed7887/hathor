/**
 * Demo scenarios surfaced on the homepage and consumable by /scan.
 *
 * The homepage links to `/scan?scenario=<id>`; /scan reads the param,
 * fetches the card image, prefills DOB + source country, and auto-starts
 * the reconciliation. The shape mirrors the inputs /scan would otherwise
 * collect via its form, so adding a scenario means adding a row here —
 * the consumer code does not change.
 *
 * Card images live under web/public/card-images/ and are referenced by
 * absolute URL so both the picker and /scan can fetch them with the same
 * path string.
 */
export type ScenarioCardLanguage = "en" | "ar" | "fr" | "mixed";

export interface DemoScenario {
  id: string;
  patient: string;
  ageLabel: string;
  routePill: string;
  sourceCountry: string;
  destinationCountry: string;
  cardImageUrl: string;
  cardLanguage: ScenarioCardLanguage;
  dob: string;
  blurb: string;
  showcases: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "lagos-cairo",
    patient: "Amina B.",
    ageLabel: "22 months",
    routePill: "Lagos → Cairo",
    sourceCountry: "NG",
    destinationCountry: "EG",
    cardImageUrl: "/card-images/demo.jpg",
    cardLanguage: "en",
    dob: "2024-06-15",
    blurb:
      "Nigerian NPI primary series complete; Measles-monovalent at 9 months and Yellow Fever on the record.",
    showcases: "Antigen equivalence · Measles → MMR gap · YF preserved but not required",
  },
  {
    id: "cairo-amber-review",
    patient: "Omar S.",
    ageLabel: "14 months",
    routePill: "Cairo · clinician review",
    sourceCountry: "EG",
    destinationCountry: "EG",
    cardImageUrl: "/card-images/phase_d_demo.jpg",
    cardLanguage: "ar",
    dob: "2025-02-10",
    blurb:
      "Egyptian MoHP card with Arabic handwriting and ambiguous date cells (٣ vs ١).",
    showcases: "AMBER gate · per-field clinician review · Eastern-Arabic digits",
  },
];

export function getScenario(id: string | null | undefined): DemoScenario | null {
  if (!id) return null;
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? null;
}
