# CLINICAL_DECISIONS.md

Physician-authored answers to deferred DAK questions from `docs/dak-questions.md`.
Each entry here unblocks the corresponding rule body in the Phase E rules engine.

Author: Ahmed Zayed MD. Reviewed and locked per session on 2026-04-23.

**Do not implement rule bodies for a topic until its entry appears here.**

---

## Q2. Component-antigen partial satisfaction — HATHOR-EPI-001

**Status:** RESOLVED 2026-04-23. Unblocks `_rule_component_antigen_satisfaction` in
`api/src/hathor/safety/phase_e.py`.

### Decision

Combination vaccines satisfy the destination schedule's requirements on a per-antigen
basis. A dose counts as satisfying a given component-antigen requirement if all of the
following hold:

1. The combination product is WHO-prequalified or authorized by a Stringent Regulatory
   Authority (SRA).
2. The dose was administered at or after the destination schedule's minimum age for that
   component antigen.
3. The interval between the dose and any prior dose of the same component antigen meets
   the WHO absolute minimum interval for that antigen. Source-country schedule intervals
   (e.g., Nigerian EPI's 4-week gaps) are accepted as satisfying the destination
   requirement when both schedules are WHO-aligned, even where the destination schedule
   prefers longer intervals.

Whole-cell pertussis (wP) and acellular pertussis (aP) are interchangeable for the
purpose of completing a primary series. When a multivalent dose is decomposed into
component-antigen satisfactions, the system must still record the biological event
(date, vaccine type, live vs. inactivated) so that downstream rules — particularly
live-vaccine co-administration spacing — can reason correctly about the underlying dose.

Monovalent doses satisfy only the specific antigen administered. Multivalent doses
satisfy all component antigens they contain, provided the above conditions hold.

### Rationale

Antigenic efficacy is intrinsic to the component, not the combination vehicle. Denying
credit for a valid component (e.g., the diphtheria antigen in a pentavalent dose)
because the combination differs from the destination schedule's preferred product creates
unnecessary revaccination risk and delays series completion. For mobile and migrant
populations, insisting on platform consistency when supply does not support it produces
worse outcomes than accepting WHO-documented interchangeability. The immunological
differences between wP and aP are real but do not invalidate a series from a protection
standpoint — WHO evidence supports interchangeability for series completion.

### Sources

- WHO Pertussis Vaccines: WHO Position Paper (August 2015)
- WHO Polio Vaccines: WHO Position Paper (June 2022)
- WHO General Guidance on Vaccine Equivalence and Interchangeability
- Egyptian Ministry of Health EPI Schedule (2024/2025 update)
- CDC General Best Practices for Immunization, Section on Combination Vaccines

### Known limitations / edge cases

- Local preference for aP on booster doses (lower reactogenicity) is not enforced by
  this rule; the rule prioritizes protection over preference.
- The rule relies on Yellow Card or source-country registry data accurately reflecting
  the product administered. Ambiguous documentation ("Pentavac ×3" without
  manufacturer/formulation) is accepted at face value when the product name maps to a
  WHO-prequalified combination.
- Monovalent-to-multivalent decomposition reports per-antigen status (e.g., "Measles:
  complete; Mumps: pending; Rubella: pending") rather than per-product status ("MMR:
  incomplete"). This is clinically more precise but may require UI explanation.
- Shares a dependency with HATHOR-EPI-002 (live_vaccine_coadmin, Q5 — still deferred):
  when a live combination dose (e.g., MMR) satisfies a component antigen, the biological
  event still governs spacing to subsequent live vaccine doses.

### Override conditions

A clinician may override this rule and require revaccination if:

- Suspected cold chain failure or storage compromise for the original dose.
- Documented immunosuppression at the time of a live-component dose (e.g., MMR during
  immunosuppressive therapy).
- The vaccine product is not WHO-prequalified and not SRA-authorized, and provenance
  cannot be established.
- Yellow Card or source registry documentation is ambiguous in a clinically material way
  (e.g., product name does not map to any known formulation).

Override is logged via FHIR Provenance with the stated clinical reason.

### Revision trigger

- Clinical data suggesting significant loss of efficacy when switching between specific
  wP and aP formulations.
- Updates to the Egyptian MoH EPI regarding mandatory combination formulations or
  platform restrictions.
- WHO DAK 2026 release updates.
- Discovery of systematic Yellow Card misreporting in a specific source-country registry.

---

## Q4. ACIP 4-day grace — HATHOR-DOSE-003

**Status:** RESOLVED 2026-04-23. Unblocks `_rule_acip_grace_period` in
`api/src/hathor/safety/phase_e.py`.

### Decision

Hathor adopts the ACIP 4-day grace period. A dose administered up to 4 days before
the minimum age or minimum interval required by the destination schedule is counted as
valid. Doses administered 5 or more days early must be repeated.

This grace applies uniformly to all antigens in the Phase 1 scope. Exceptions are
documented below.

When the grace period applies, HATHOR-DOSE-003 returns a pass verdict that supersedes
HATHOR-DOSE-002's (min_interval_met) fail verdict for the same dose. Both events are
preserved in the validation log and logged via FHIR Provenance: the original interval
violation and the grace-period acceptance.

### Rationale

Clinical scheduling variability is a real-world constraint, particularly in migrant and
displaced populations where appointment timing is frequently disrupted. The ACIP 4-day
rule draws a clinically sound line: short enough that vaccine immunogenicity is preserved
based on available evidence, long enough that realistic scheduling variation does not
trigger unnecessary revaccination. Applying strict minimum intervals without grace
produces more false-positive catch-up recommendations than it prevents inadequate
immunity, which is a net harm for the population Hathor serves.

WHO does not formally adopt the 4-day grace but does not prohibit it; this decision is
compatible with both WHO and ACIP guidance.

### Sources

- CDC General Best Practices for Immunization, Timing and Spacing of Immunobiologics (ACIP)
- WHO Immunization Handbook, Minimum Intervals and Ages
- Egyptian Ministry of Health EPI Schedule (2024/2025 update) — grace-period policy not
  formally published; local clinical practice accepts short variances.

### Known limitations / edge cases

- **Rabies vaccine:** ACIP explicitly excludes rabies from the 4-day grace due to
  post-exposure prophylaxis requiring strict adherence. Rabies is outside the Phase 1
  antigen scope and this exception does not affect current rule behavior, but will apply
  when scope expands.
- **Doses administered in the first 28 days of life:** The grace period does not apply
  to doses where the minimum age is ≤28 days (birth-dose Hepatitis B, BCG). For these
  doses, strict minimums apply due to immunological immaturity considerations.
- **Chained grace:** If a dose is accepted under the grace period, subsequent doses in
  the series still reference that dose's actual administration date for their own interval
  calculations — not a notional "minimum date." Grace does not compound across doses.
- **Dual violation:** When both minimum age and minimum interval are simultaneously
  violated within the grace window, the engine fires interval grace (superseding
  HATHOR-DOSE-002). The age fail (HATHOR-AGE-001) remains active in that case — a known
  limitation of the single-supersedes design; clinician override is the resolution path.

### Override conditions

A clinician may override the grace-period acceptance and require revaccination if:
- The dose was administered more than 4 days early (outside the grace).
- There is clinical concern about immunogenicity for a specific patient (e.g., documented
  immunosuppression at time of dose).
- Local Egyptian MoH guidance for a specific antigen explicitly requires strict interval
  adherence.

Override is logged via FHIR Provenance with the stated clinical reason.

### Revision trigger

- ACIP updates to grace-period scope or duration.
- Emergence of clinical evidence that specific antigens require stricter intervals than
  the 4-day grace accommodates.
- Egyptian MoH publication of a formal grace-period policy that differs from ACIP.
- WHO DAK 2026 release updates.

---

## Q5. Live vaccine co-administration — HATHOR-EPI-002

**Status:** RESOLVED 2026-04-23. Unblocks `_rule_live_vaccine_coadmin` in
`api/src/hathor/safety/phase_e.py`.

### Decision

Two different live parenteral (injectable or intranasal) vaccines administered on
different days must be separated by at least 28 days. If the interval is shorter, the
second dose is invalid and must be repeated ≥28 days after the invalid administration.

Live oral vaccines (rotavirus, Ty21a oral typhoid, oral cholera, OPV) are exempt from
the 28-day rule. They may be administered simultaneously with, or at any interval before
or after, other live vaccines — parenteral, intranasal, or oral. The only oral-oral
exception is a recommended 8-hour minimum between oral cholera and oral Ty21a typhoid
due to buffer interference; neither is in Phase 1 scope.

Two doses of the same live vaccine in a series (e.g., MMR dose 1 and MMR dose 2) given
<28 days apart are treated under the intra-series interval rule (HATHOR-DOSE-002 with
HATHOR-DOSE-003 grace), not the inter-vaccine 28-day rule. The 4-day grace applies to
same-antigen intra-series intervals and does not apply to the 28-day inter-live-vaccine
rule.

**Rule composition:** HATHOR-EPI-002 consults the biological-event ledger preserved by
HATHOR-EPI-001 (component_antigen_satisfaction). When MMR is decomposed to satisfy a
measles-only component, the underlying MMR administration event (date, live_injectable
platform) remains in the ledger and governs 28-day spacing against any subsequent live
parenteral vaccine. Decomposition does not erase the biological event.

HATHOR-EPI-002 does not supersede other rules and is not superseded by HATHOR-DOSE-003
(acip_grace_period). The 28-day inter-live window is a hard floor for different live
parenteral vaccines.

### Rationale

The immune response to a second live-virus vaccine administered within 28 days of the
first may be impaired due to interferon-mediated interference. WHO and ACIP converge on
the 28-day rule as the minimum empirically justified window. Oral live vaccines do not
produce sufficient systemic interferon response to interfere with other live vaccines,
which is why they are exempt. The exemption is important for Hathor's Phase 1 population
— rotavirus and OPV are both oral live vaccines used routinely in Nigerian and Egyptian
EPI, and flagging co-administration with injectable live vaccines as a rule violation
would produce false positives on nearly every pediatric record.

### Sources

- CDC General Best Practices for Immunization: Timing and Spacing of Immunobiologics (ACIP)
- CDC Yellow Book 2026: Vaccination and Immunoprophylaxis General Principles
- Immunize.org Ask the Experts: Scheduling Vaccines and Administering Vaccines
- WHO position papers on measles, MMR, varicella, and yellow fever vaccines (timing and
  spacing sections)

### Known limitations / edge cases

- **Yellow fever and MMR co-administration:** Limited data suggest same-day co-admin may
  reduce response to yellow fever, mumps, and rubella (not measles). ACIP still recommends
  same-day administration as acceptable. Yellow fever is outside Phase 1 scope; noted for
  future inclusion.
- **Inadvertent same-day of two live parenterals:** Same-day administration is explicitly
  valid — the 28-day rule only governs non-same-day administration.
- **Tuberculin skin testing interference:** Live vaccines (especially MMR) can suppress TST
  response; testing must be same-day or ≥4 weeks later. This is a diagnostic concern, not
  a vaccination validity concern, and is out of Phase E scope.

### Override conditions

A clinician may override a fail verdict from this rule if:
- Serologic evidence of immunity for the relevant antigen is available, making
  revaccination unnecessary regardless of the interval violation.
- The patient is in an outbreak or high-exposure setting where the clinical benefit of
  the second dose outweighs the reduced immunogenicity concern.
- Local Egyptian MoH guidance for the specific antigen pair differs.

Override is logged via FHIR Provenance with the stated clinical reason.

### Revision trigger

- Updates to WHO or ACIP guidance on the 28-day inter-live interval.
- Publication of new evidence on oral-parenteral live vaccine interference.
- Egyptian MoH publication of country-specific co-administration policy.
- Phase 1 scope expansion to include yellow fever, which has specific interaction
  considerations with MMR.

---

## Q6. Rotavirus age cutoffs — HATHOR-AGE-003

**Status:** RESOLVED 2026-04-23. Unblocks `_rule_rotavirus_age_cutoff` in
`api/src/hathor/safety/phase_e.py`.

### Decision

Hathor adopts the ACIP age cutoffs as the default rule:
- Dose 1 must be administered before age 15 weeks 0 days (i.e., at or before 14 weeks
  6 days = 104 days; the cutoff threshold is ≥ 105 days).
- All doses must be completed before age 8 months 0 days (≥ 240 days triggers fail).
- Minimum interval between rotavirus doses is 4 weeks (handled by HATHOR-DOSE-002).
- Minimum age for dose 1 is 6 weeks (42 days).

A rotavirus dose-1 recommendation violating the dose-1 max age (≥ 105 days at
administration) but below the series-completion max age returns **warn** severity with a
migrant-advisory rationale. A series-completion cutoff violation (≥ 240 days) returns
**fail** severity. Dose 1 below minimum age (< 42 days) returns **fail** severity.

**Special handling for older migrant children:** When a child arrives in the destination
with no prior rotavirus doses and is already past the dose-1 cutoff (≥ 105 days), Hathor
does not silently drop rotavirus from the catch-up plan. Instead, the rule emits a
warn-severity advisory noting that ACIP cutoff applies but that WHO and clinical
benefit-risk analyses in high-burden settings support override. The clinician decides
whether to initiate the series via standard override with documented reason.

### Rationale

The ACIP cutoffs exist because pivotal safety trials enrolled infants up to 15 weeks for
dose 1 and 32 weeks for final dose; there are insufficient data on intussusception risk
when dose 1 is administered to older infants. However, modeling studies for low- and
middle-income countries estimate that removing the age restriction prevents approximately
154 rotavirus deaths for every intussusception death caused. For a migrant population
arriving from high-mortality settings, a silent default to "no rotavirus" past 15 weeks
produces measurable harm.

The right clinical posture is to default to the strict rule (fail on series-completion
violation) but surface the decision to the clinician via warn advisory when a reasonable
clinical case for override exists (dose-1 cutoff exceeded, but series completion still
feasible). This preserves safety as the default, honors the clinician's authority, and
logs the override decision to Provenance for audit.

### Sources

- WHO Weekly Epidemiological Record: Age of administration of rotavirus vaccines (2009
  SAGE recommendation)
- WHO EMRO: Rotavirus vaccine and vaccination (Eastern Mediterranean Region guidance)
- CDC Rotavirus Vaccine Recommendations (ACIP)
- Immunize.org Ask the Experts: Rotavirus
- Patel et al., "Removing the age restrictions for rotavirus vaccination: a benefit-risk
  modeling analysis," PLoS Medicine / PubMed ID 23109915
- RotaTeq prescribing information (Merck, 2020)
- Rotarix prescribing information (GlaxoSmithKline, 2019)
- Egyptian Ministry of Health and Population EPI schedule (2024/2025 update)

### Known limitations / edge cases

- **Child arriving at 15–32 weeks with no rotavirus:** warn-with-override-path as
  described. Rationale explicitly cites Nigerian/high-burden-setting mortality context.
- **Child arriving >8 months with no rotavirus:** fail severity; override is available
  but WHO data on post-cutoff efficacy attenuates, so the clinical case for override
  weakens. Rule flags this explicitly in the fail rationale.
- **Dose 1 inadvertently given ≥ 15 weeks 0 days:** ACIP states the remaining doses
  should be completed on normal schedule by 8 months — the cutoff does not invalidate
  subsequent doses. HATHOR-AGE-003 respects this: only the dose-1 event triggers the
  ≥ 15-week warn; subsequent doses are evaluated on the 8-month completion cutoff only.
- **Preterm infants:** ACIP uses chronological age, not corrected age, for rotavirus
  cutoffs. Hathor uses chronological age.

### Override conditions

A clinician may override a fail verdict if:
- The child is from a high-rotavirus-mortality setting (e.g., Nigeria, Sudan, South
  Sudan) and the clinical benefit-risk analysis favors vaccination despite the age.
- Egyptian MoH guidance for catch-up of migrant children specifies rotavirus
  administration past cutoff.
- Local outbreak or high-exposure risk elevates benefit.

Override is logged via FHIR Provenance with the stated clinical reason. The
override-reason free-text is expected to cite the clinical context (source-country
mortality data, outbreak status, or local directive).

### Revision trigger

- WHO updates to rotavirus age cutoff policy (under periodic review given the
  benefit-risk evidence).
- Egyptian MoH publication of migrant-specific rotavirus catch-up policy.
- Emergence of intussusception safety data for vaccination past cutoff.
- New rotavirus vaccine formulations with broader age indications (e.g., Rotavac,
  Rotasiil in broader WHO prequalification).

---

## Q11. Contraindication source-of-truth conflicts — EG-CONTRA-001

**Status:** RESOLVED 2026-04-23. Unblocks `_rule_contraindication_source_conflict` in
`api/src/hathor/safety/phase_e.py`. Rule ID updated from HATHOR-CONTRA-001 to
EG-CONTRA-001 per physician's naming: the rule applies Egypt MoH authority, making EG-
the correct source prefix (see `recommendation.py` naming convention).

### Decision

When contraindication sources conflict for a given (antigen, condition) pair, Hathor
applies the following precedence in order, taking the strictest applicable
contraindication:

1. **Egyptian MoH directive** — if published for the antigen and condition, governs
   absolutely for patients being assessed against the Egyptian destination schedule.
2. **Manufacturer label (product-specific)** — applies when the specific product
   administered or to be administered is identified and its label carries a
   contraindication.
3. **WHO DAK / WHO position paper** — applies as the baseline when neither of the above
   is available or applicable.

"Strictest applicable" means: if any applicable source marks the (antigen, condition)
pair as contraindicated, the recommendation fails. A source marking it as merely
"precaution" does not downgrade a stricter source's "contraindication" — the higher
stringency wins.

### Rationale

Egyptian MoH sovereignty over clinical policy in Egypt is the foundational principle.
Where Egypt has issued a specific directive, that directive governs — Hathor does not
position itself as second-guessing Egyptian clinical authority. Where Egypt is silent, the
manufacturer label (product-specific, FDA/EMA/SRA-regulated) is the next most
authoritative source because it reflects the regulatory filing under which the product was
authorized. WHO DAK is the baseline WHO position, broadly applicable across jurisdictions,
and serves as the default when more specific sources are silent.

The "strictest wins" rule errs toward safety: a false-positive contraindication triggers
clinician review via the override path; a false-negative could harm the child. This is
consistent with the rest of Phase E's design posture.

### Sources

- Egyptian Ministry of Health and Population: vaccine-specific contraindication guidance
  (where published)
- WHO Digital Adaptation Kit (DAK) for Immunization
- WHO Position Papers for each antigen in Phase 1 scope
- Prescribing information / product labels for each WHO-prequalified product used in
  Phase 1 scope (Pentavac, Rotarix, RotaTeq, BCG products, MMR products, HepB products)

### Known limitations / edge cases

- **Source availability:** Egyptian MoH does not publish comprehensive contraindication
  tables for every antigen. Where Egyptian guidance is absent, the rule falls through to
  manufacturer label, then WHO DAK, without flagging the absence as a rule violation.
- **Label vs. WHO disagreement on precaution vs. contraindication:** If the manufacturer
  label says "precaution" and WHO DAK says "contraindication," WHO DAK governs per
  "strictest wins." If the reverse, the label governs.
- **Ambiguous patient condition:** The rule does not resolve ambiguity about whether the
  patient's condition meets a contraindication's clinical definition (e.g., "moderate
  immunosuppression" requires clinical judgment). This rule only governs which source's
  definition applies once the condition is known.
- **Multiple products of the same antigen:** When the administered product is not
  specified (Yellow Card says "Pentavalent" without brand), the rule applies the most
  restrictive label across WHO-prequalified pentavalent products as a safety default.

### Override conditions

A clinician may override a contraindication fail if:
- The patient's specific clinical situation does not meet the contraindication's
  definition despite superficial match.
- The clinician has documented evidence that the contraindication is outdated or no
  longer reflects current practice.
- The benefit-risk in the specific clinical context favors vaccination despite the
  contraindication (e.g., outbreak exposure in an immunocompromised patient where risk
  of disease exceeds risk of vaccine).

Override is logged via FHIR Provenance with the stated clinical reason, and the
override-reason free-text is expected to specify which authoritative source's
contraindication is being overridden and why.

### Revision trigger

- New Egyptian MoH directive on contraindications for any Phase 1 antigen.
- WHO DAK 2026 release with updated contraindication sections.
- Product label updates for WHO-prequalified products in Phase 1 scope.
- Discovery of systematic disagreement between sources that this precedence does not
  resolve cleanly.
