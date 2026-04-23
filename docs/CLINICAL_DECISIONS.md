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

**Status:** DEFERRED. Pending physician-authored answer.

---

## Q6. Rotavirus age cutoffs — HATHOR-AGE-003

**Status:** DEFERRED. Pending physician-authored answer.

---

## Q11. Contraindication source-of-truth conflicts — HATHOR-CONTRA-001

**Status:** DEFERRED. Pending physician-authored answer.
