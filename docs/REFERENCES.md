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

- **STIKO (RKI) — German vaccination schedule** — Primary target schedule for the hackathon demo.
  https://www.rki.de/EN/Topics/Infectious-diseases/Immunisation/Recommendations/recommendations_node.html

- **Egypt EPI Schedule** — Source schedule for the demo case (Egyptian child, German target).
  https://www.emro.who.int/egy/programmes/epi.html

---

## Clinical Guidance on Interpreting Foreign Records

- **CHOP guidance on interpreting foreign immunization records** — Manual clinician workflow
  that Hathor automates. Children's Hospital of Philadelphia protocols for catch-up scheduling
  when vaccination history is from a different country.

- **Australian Immunisation Handbook — Catch-up chapter** — Detailed clinical reasoning rules
  for partial series, timing windows, and combination vaccine equivalences. Useful reference
  for the agent's equivalence logic.
  https://immunisationhandbook.health.gov.au/vaccination-procedures/catch-up-vaccination
