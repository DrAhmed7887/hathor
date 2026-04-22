# References

Prior art, clinical guidelines, and data sources relevant to Hathor.

---

## Closest Prior Art

- **AI-VaxGuide** — Agentic RAG for clinician vaccination Q&A over Algerian + WHO guidelines.
  Different use case (Q&A, not reconciliation), different user (clinician, not parent), no vision/OCR,
  no cross-jurisdictional equivalence reasoning. We cite and differentiate.
  https://arxiv.org/abs/2507.03493

---

## Clinical and Epidemiological Background

- **Hargreaves et al., Lancet Public Health, 2024** — Migrant life-course immunisation:
  the gap this project addresses. Documents the clinical and policy problem of vaccination
  record continuity across borders.

- **WHO Immunization Agenda 2030** — Global immunisation strategy and schedule references.
  https://www.who.int/teams/immunization-vaccines-and-biologicals/strategies/ia2030

---

## Vaccination Schedule Sources

Phase 1 (hackathon) reconciles within Africa — Nigerian NPI (source) into Egyptian
MoHP EPI (target). Both schedules are composed from official public sources, cross-
referenced against WHO country profiles, and clinically reviewed.

- **Egypt MoHP EPI — Expanded Programme on Immunization** — Phase 1 target schedule.
  Composed from WHO EMRO Egypt programme description, UNICEF Egypt, and the WHO
  Immunization Data portal (EGY). Routine coverage exceeds 95%; WHO certified Egypt
  measles-elimination in 2023.
  - https://www.emro.who.int/egy/programmes/expanded-programme-on-immunization.html
  - https://www.unicef.org/egypt/vaccines
  - https://immunizationdata.who.int/dashboard/regions/eastern-mediterranean-region/EGY

- **Nigeria NPI — National Programme on Immunization** — Phase 1 validated source
  schedule. Composed from UNICEF Nigeria immunization schedule, WHO 2024 Nigeria
  country profile, and the Paediatric Association of Nigeria (PAN, 2020).
  - https://www.unicef.org/nigeria/immunization
  - https://immunizationdata.who.int/dashboard/countries/NGA
  - https://pan-ng.org/

---

## Clinical Guidance on Interpreting Foreign Records

- **CHOP guidance on interpreting foreign immunization records** — Manual clinician workflow
  that Hathor automates. Children's Hospital of Philadelphia protocols for catch-up scheduling
  when vaccination history is from a different country.

- **Australian Immunisation Handbook — Catch-up chapter** — Detailed clinical reasoning rules
  for partial series, timing windows, and combination vaccine equivalences. Useful reference
  for the agent's equivalence logic.
  https://immunisationhandbook.health.gov.au/vaccination-procedures/catch-up-vaccination
