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

## HATHOR-DOSE-003 — acip_grace_period (Q4)

**Clinical question:** Should a dose administered slightly before the
minimum age or minimum interval be considered valid?

**Decision:** I, Dr. [Name], MD, authorize a 4-day grace period for
all vaccines in Phase 1 scope, with one clinically significant
exception. A dose administered ≤4 days before the minimum age or
interval is marked Valid. A dose administered ≥5 days early is
Invalid and must be repeated.

**Exception — live parenteral vaccines administered sequentially:**
The 4-day grace does not apply to the 28-day minimum interval
between different live parenteral vaccines given on different days.
This exclusion is enforced by HATHOR-EPI-002 (live_vaccine_coadmin)
as a hard floor; HATHOR-DOSE-003 does not override it.

**Rationale:** The 4-day window accounts for real-world logistical
variation — weekend clinic closures, appointment reschedules,
scheduling noise in busy clinics — without meaningful impact on
immune response. The clinical literature supports this threshold:
in a study of 8,293 children in a low-income community, adopting the
4-day grace reduced unnecessary revaccination by 30% without
compromising series efficacy.

The live-parenteral exclusion exists because viral interference is a
distinct mechanism: the first live vaccine's immune response can
prevent the second live vaccine from "taking" if given within the
28-day window. This is not a schedule-variability concern and is
not resolved by a 4-day grace. Oral live vaccines (rotavirus, OPV,
Ty21a, oral cholera) do not produce sufficient systemic interferon
to cause this interference and are not subject to the exclusion.
Inactivated vaccines are not subject to viral interference at all.

**Operative scope (retrospective review only):** The grace period
applies only to retrospective validity assessment of doses already
administered — which is exactly Hathor's workflow when reading a
Yellow Card from a source country. Prospective catch-up plan
generation uses true minimum ages and intervals, never
grace-adjusted minimums. ACIP explicitly prohibits using the grace
period to schedule future doses.

**Chained grace:** Grace-period acceptance does not compound across
doses. When dose N is accepted under the grace period, subsequent
doses in the series reference dose N's actual administration date
for their own interval calculations — not a notional "intended
date." This prevents repeated short-by-4-days acceptances from
accumulating into a clinically compressed series.

**Rule composition:** When HATHOR-DOSE-003 accepts a dose under the
grace period, it returns a pass verdict that supersedes
HATHOR-DOSE-002's fail verdict. Both events are preserved in the
validation log and logged via FHIR Provenance: the original
minimum-interval violation and the grace-period acceptance with the
specific gap shortfall in days. The live-parenteral exclusion is
enforced by HATHOR-EPI-002 returning an unrecoverable fail that
HATHOR-DOSE-003 does not attempt to supersede.

**Sources consulted:**
- CDC General Best Practices for Immunization: Timing and Spacing of
  Immunobiologics (ACIP), including Table 1-1 restrictions on the
  4-day grace
- Immunize.org Ask the Experts: Scheduling Vaccines (June 2023)
- Children's Hospital of Philadelphia: Minimum Ages and Intervals
  Between Doses (2024)
- Stokley et al., "Impact of the ACIP 4-day grace period in a
  low-income community," PubMed ID 14507532
- Albers et al., "Invalid Vaccine Doses Among Children Aged 0 to 35
  Months: 2011 to 2020," Pediatrics 2025
- WHO Immunization Standards for "Early Doses"
- WHO EMRO Expanded Programme on Immunization (Egypt country page)
- Egyptian Ministry of Health and Population EPI schedule
  (2024/2025 update)

**Known limitations / edge cases:**
- **Rabies and accelerated Twinrix:** ACIP explicitly excludes these
  from the 4-day grace. Both are outside Phase 1 scope; flagged for
  future coverage.
- **Jurisdictional MMR strict enforcement:** Some regulatory bodies
  (notably US state school/childcare authorities) enforce MMR's
  12-month minimum strictly regardless of ACIP grace. Hathor adopts
  ACIP grace for clinical validity; users in jurisdictions with
  stricter regulatory requirements should override via the
  clinician-reason path.
- **Egyptian MoH silence:** Egyptian MoH does not publish a formal
  grace-period policy for retrospective dose validity review. This
  decision adopts ACIP's 4-day grace as the operative policy in the
  absence of published local guidance. A future Egyptian MoH
  directive would supersede this choice.

**Override conditions:** A clinician may override a fail verdict
from this rule in either direction:

Accepting a dose beyond the 4-day window:
- **Outbreak response:** A dose given 5–7 days early during an active
  local outbreak, where immediate (albeit slightly suboptimal)
  coverage outweighs the marginal immunogenicity concern.
- **Travel urgency:** Patient departing to a high-risk area without
  access to the repeat dose within a clinically adequate window.

Requiring revaccination despite grace acceptance:
- Clinical concern about immunogenicity for the specific patient
  (e.g., documented immunosuppression at the time of the
  originally-administered dose).

*UI surfacing note:* The "require revaccination despite grace
acceptance" override direction is a clinically legitimate pathway
not yet surfaced in Commit 8's UI, which supports fail→pass
overrides. Clinicians needing this direction contact the care team
directly; tracked as a production-deferred item.

Override is logged via FHIR Provenance with the stated clinical
reason. Override of the live-parenteral 28-day exclusion is handled
by HATHOR-EPI-002's own override path, not this rule's.

**Revision trigger:**
- Egyptian MoH issuing a "No Grace Period" mandate for specific
  high-value antigens (e.g., Polio).
- ACIP updates to grace-period scope, duration, or excluded
  antigens.
- Emergence of clinical evidence that specific Phase 1 antigens
  require stricter intervals than the 4-day grace accommodates.
- WHO DAK 2026 release providing formal WHO grace-period guidance.
- Phase 1 scope expansion to include rabies or Twinrix, requiring
  per-antigen grace-exemption configuration.

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
`api/src/hathor/safety/phase_e.py`. **Amended** by Clinical UI Policy — Friction by
Design (same session): high-burden-origin path changed from `warn` to `override_required`.

### Decision

Hathor adopts the ACIP age cutoffs as the default rule:
- Dose 1 must be administered before age 15 weeks 0 days (i.e., at or before 14 weeks
  6 days = 104 days; the cutoff threshold is ≥ 105 days).
- All doses must be completed before age 8 months 0 days (≥ 240 days triggers fail or
  override_required per Friction by Design).
- Minimum interval between rotavirus doses is 4 weeks (handled by HATHOR-DOSE-002).
- Minimum age for dose 1 is 6 weeks (42 days).

**Severity logic — amended by Friction by Design:**

| Condition | source_country ∈ HIGH_BURDEN_COUNTRIES | Severity |
|-----------|----------------------------------------|----------|
| Dose 1 < 42 days | any | `fail` (absolute) |
| Any dose ≥ 240 days | Yes | `override_required` |
| Any dose ≥ 240 days | No | `fail` |
| Dose 1 ≥ 105 days AND < 240 days | Yes | `override_required` |
| Dose 1 ≥ 105 days AND < 240 days | No | `fail` |
| Dose 2+ ≥ 105 days AND < 240 days | any | `pass` (dose-1 cutoff doesn't apply) |
| Otherwise | any | `pass` |

**`override_required`** is the Friction by Design structured override pathway. It is
distinct from plain `fail`: the UI applies separate visual treatment, contextual triggering
on `ClinicalContext.source_country`, and the clinician must select a structured
justification code from `OVERRIDE_JUSTIFICATION_CODES` (`HIGH_BURDEN_ORIGIN`,
`OUTBREAK_CATCHUP`, `CLINICIAN_DETERMINED`) in addition to optional free text. Both are
logged to FHIR Provenance. See § Clinical UI Policy — Friction by Design below.

**Special handling for older migrant children:** When a child arrives from a
`HIGH_BURDEN_COUNTRIES` origin with no prior rotavirus doses and is already past the
dose-1 cutoff (≥ 105 days), the rule returns `override_required` rather than the plain
`fail` returned for non-high-burden cases. This surfaces the decision as a structured
override rather than a silent block, and records the clinical justification code that
drove the decision. The clinician selects a code (most commonly `HIGH_BURDEN_ORIGIN`)
and the system logs the full decision trail to Provenance.

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

- **Child arriving at 15–32 weeks with no rotavirus, high-burden origin:** returns
  `override_required` with `HIGH_BURDEN_ORIGIN` as the most applicable justification code.
  Rationale explicitly cites Nigerian/high-burden-setting mortality context (~154 deaths
  prevented per intussusception risk). Clinician must select a code and document the
  rationale; both logged to Provenance.
- **Child arriving at 15–32 weeks with no rotavirus, non-high-burden origin:** returns
  `fail`. Standard clinician override with free-text reason is available.
- **Child arriving >8 months with no rotavirus:** `override_required` (high-burden) or
  `fail` (non-high-burden). WHO data on post-cutoff efficacy attenuates past 8 months;
  the rule rationale notes this explicitly so the clinician documents accordingly.
- **Dose 1 inadvertently given ≥ 15 weeks 0 days:** ACIP states the remaining doses
  should be completed on normal schedule by 8 months — the cutoff does not invalidate
  subsequent doses. HATHOR-AGE-003 respects this: only the dose-1 event triggers the
  ≥ 15-week cutoff logic; subsequent doses are evaluated on the 8-month completion cutoff
  only.
- **Preterm infants:** ACIP uses chronological age, not corrected age, for rotavirus
  cutoffs. Hathor uses chronological age.

### Override conditions

Two override pathways apply, depending on severity:

**`override_required` (high-burden origin):** The clinician must select exactly one
justification code from `OVERRIDE_JUSTIFICATION_CODES`:
- `HIGH_BURDEN_ORIGIN` — child arrives from a WHO high-child-mortality stratum country
- `OUTBREAK_CATCHUP` — local outbreak or high-exposure risk elevates benefit
- `CLINICIAN_DETERMINED` — clinician-determined case-by-case assessment

The selected code plus optional free-text are logged to FHIR Provenance. The clinician
is expected to cite the clinical context (source-country mortality data, outbreak status,
or documented case-by-case rationale).

**`fail` (non-high-burden / dose-1 minimum-age violation):** Standard clinician override
with free-text reason is available via the usual override path. Free-text is logged to
FHIR Provenance.

### Revision trigger

- WHO updates to rotavirus age cutoff policy (under periodic review given the
  benefit-risk evidence).
- Egyptian MoH publication of migrant-specific rotavirus catch-up policy.
- Emergence of intussusception safety data for vaccination past cutoff.
- New rotavirus vaccine formulations with broader age indications (e.g., Rotavac,
  Rotasiil in broader WHO prequalification).
- Changes to the `HIGH_BURDEN_COUNTRIES` list as Phase 1 scope expands.

---

## Q11. EG-CONTRA-001 — contraindication_source_conflict

**Status:** RESOLVED 2026-04-23; doc aligned with shipped design 2026-04-24. Implemented
as `_rule_contraindication_source_conflict` in `api/src/hathor/safety/phase_e.py`. Rule ID
is EG-CONTRA-001 per physician's naming: the rule applies Egypt MoH authority, making EG-
the correct source prefix (see `recommendation.py` naming convention).

### Clinical question

When multiple authoritative sources (Egyptian Ministry of Health, manufacturer label, WHO
DAK) disagree about whether a given condition is a contraindication for a given antigen,
which source's verdict governs, and what is Phase E's role in enforcing that precedence?

### Decision

Hathor's contraindication handling is a two-layer system:

**Layer 1 — Agent-provided source assessment.** The agent, drawing on its clinical
knowledge, assesses each recommendation against applicable contraindication sources and
populates `Recommendation.source_verdicts` with the consulted sources (Egyptian MoH,
manufacturer label, WHO DAK) and their individual verdicts. The agent is responsible for
identifying which contraindications apply to a given (antigen, patient-condition) pair.

**Layer 2 — Phase E precedence enforcement.** When the agent submits `source_verdicts`,
Phase E's EG-CONTRA-001 rule applies the following precedence, taking the strictest
applicable contraindication:

1. **Egyptian MoH directive** — if a verdict is provided, governs absolutely for patients
   being assessed against the Egyptian destination schedule.
2. **Manufacturer label (product-specific)** — applies when the specific product is
   identified and its label verdict is provided.
3. **WHO DAK / WHO position paper** — applies as the baseline when provided.

"Strictest applicable wins" means: if any provided verdict marks the (antigen, condition)
pair as contraindicated, the recommendation fails, and the rationale cites the
highest-precedence source holding that verdict. A source marking merely "precaution" does
not downgrade a stricter source's "contraindication."

When `source_verdicts` is empty or absent, EG-CONTRA-001 returns no violation. Phase E
does not maintain an independent contraindication registry; the rule is a precedence
enforcer over agent-cited sources, not an independent knowledge base.

### Rationale for the two-layer design

A static contraindication registry maintained inside the codebase would require ongoing
clinical-data governance that Hathor does not currently have. Tiny or incomplete
registries create a false sense of safety — any (antigen, condition) pair not in the
registry would appear to be "cleared" by silence. Agent-sourced verdicts, combined with
structural precedence enforcement, gives Hathor a defensible posture: the agent cites its
clinical reasoning explicitly, and Phase E audits whether the cited sources are being
weighted correctly. Any contraindication the agent misses is a gap in the agent's
reasoning to be caught by clinician review via HITL — not a silent false-negative inside
a registry the clinician cannot inspect.

This design also scales to new antigens and jurisdictions without code changes to Phase
E's contraindication rule.

### Agent prompt requirement

The agent is instructed to populate `source_verdicts` whenever a recommendation involves
a patient condition with plausible contraindication implications, citing all sources
consulted even when they agree. This provides the audit trail even when no conflict
exists.

### Sources consulted (for Phase E's precedence logic)

- Egyptian Ministry of Health and Population: vaccine-specific contraindication guidance,
  where published.
- WHO Digital Adaptation Kit (DAK) for Immunization.
- WHO Position Papers for antigens in Phase 1 scope.
- Prescribing information / product labels for WHO-prequalified products in Phase 1 scope.

### Known limitations / edge cases

- **Agent omission:** If the agent fails to populate `source_verdicts` when a
  contraindication applies, the rule does not fire. This is a known limitation; clinician
  review via HITL is the safety net. Alert-fatigue-safe UI treatment (see Clinical UI
  Policy section) applies to any override decision.
- **Ambiguous patient condition:** The rule does not resolve clinical ambiguity about
  whether the patient's condition meets a contraindication's definition. The agent makes
  that determination upstream; this rule handles source precedence only.
- **Unspecified product:** When Yellow Card documentation lacks brand specificity (e.g.,
  "Pentavalent" without manufacturer), the agent is instructed to cite the most
  restrictive applicable label across WHO-prequalified products. This is an agent-prompt
  convention, not a Phase E lookup.
- **Absence of Egyptian MoH guidance:** Many (antigen, condition) pairs lack published
  Egyptian MoH directives. The rule falls through to manufacturer and WHO cleanly in
  these cases.

### Override conditions

A clinician may override a contraindication fail if:
- The patient's specific clinical situation does not meet the contraindication's
  definition despite superficial match.
- Documented evidence exists that the cited contraindication is outdated or no longer
  reflects current practice.
- Benefit-risk in the specific clinical context favors vaccination despite the
  contraindication (e.g., outbreak exposure in an immunocompromised patient where disease
  risk exceeds vaccine risk).

Override is logged via FHIR Provenance with the stated clinical reason and the specific
source being overridden.

### Revision trigger

- Availability of structured Egyptian MoH contraindication data suitable for registry
  integration would enable a future shift to a hybrid design (agent verdicts + registry
  backstop).
- New Egyptian MoH directive on contraindications for any Phase 1 antigen.
- WHO DAK 2026 release with updated contraindication sections.
- Product label updates for WHO-prequalified products in Phase 1 scope.
- Discovery of a systematic agent-omission pattern in contraindication reasoning.

---

## Clinical UI Policy — Friction by Design

**Status:** ADOPTED 2026-04-23. Applies immediately to HATHOR-AGE-003 (Q6, rotavirus
cutoffs). Architecture is in place for future rules that carry documented adverse-event
risk.

Author: Ahmed Zayed MD.

### Purpose

Some Phase E rule violations carry documented adverse-event risk that makes a plain
`fail` → free-text-override pathway insufficient. For these cases, the standard two-tier
model (`pass`/`fail`) is extended by a fourth severity tier: `override_required`. This
tier applies **Friction by Design** — intentional clinical friction that surfaces the
specific risk, prompts structured justification, and records the decision for audit.

The goal is not to prevent override. Clinician authority is an unconditional hard rule
(see CLAUDE.md). The goal is to ensure that overrides of high-risk rules are:
1. Deliberate — the clinician cannot proceed without acknowledging the specific risk.
2. Documented — a structured justification code (machine-readable) plus optional
   free text (clinician's narrative) are both logged to FHIR Provenance.
3. Distinguishable — the UI applies distinct visual treatment so these decisions are
   not processed with the same cognitive load as routine `fail` overrides.

### Severity tiers

| Severity | Meaning | UI Treatment | Clinician Action Required |
|----------|---------|-------------|--------------------------|
| `pass` | Meets all rules | Normal display | None |
| `warn` | Meets rules with caveat | Yellow badge + rationale | None |
| `fail` | Rule violation | Blocked + override affordance | Free-text override reason |
| `override_required` | High-risk violation | Distinct treatment + justification selector | Justification code + optional free text |

### `override_required` protocol

When a ValidationResult has severity `override_required`:

1. **Visual treatment** — distinct from `fail`. The UI must not render `override_required`
   results with the same styling as plain `fail` results.
2. **Contextual trigger** — the rule may use `ClinicalContext.source_country` (or other
   context fields) to determine whether this tier applies. For HATHOR-AGE-003, the trigger
   is `source_country ∈ HIGH_BURDEN_COUNTRIES`.
3. **Justification code** — the `ValidationResult.override_justification_codes` list is
   populated with applicable codes. The clinician must select exactly one code from this
   list. Codes are defined in `OVERRIDE_JUSTIFICATION_CODES`:
   - `HIGH_BURDEN_ORIGIN` — child arrives from WHO high-child-mortality stratum country
   - `OUTBREAK_CATCHUP` — local outbreak or high-exposure risk elevates benefit
   - `CLINICIAN_DETERMINED` — clinician-determined case-by-case assessment
4. **Free text** — optional, in addition to the code. If provided, captured alongside.
5. **FHIR Provenance logging** — both the code and free text are logged to the FHIR
   Provenance resource for the recommendation, alongside the rule ID and agent's original
   proposal. This is a hard requirement — not optional.
6. **Clinician authority** — the clinician may select any code and proceed. The override
   is allowed and logged. The system does not block the clinician's final decision.

### Currently applicable rules

| Rule | When triggered | Trigger condition |
|------|---------------|-------------------|
| HATHOR-AGE-003 | Rotavirus dose-1 max-age or series-max violation | `source_country ∈ HIGH_BURDEN_COUNTRIES` |

### Architectural note

`PhaseEOutput.has_override_required` is True when any active ValidationResult has severity
`override_required`. `emit_recommendations` surfaces this flag in its response so the
clinical UI can conditionally render the override_required pathway. Rules that do not
meet the Friction by Design threshold return plain `fail` with standard free-text override.

### Revision trigger

- Any new rule carrying documented adverse-event risk where structured override
  justification would improve clinical audit quality.
- Changes to `OVERRIDE_JUSTIFICATION_CODES` (versioned alongside rule definitions).
- Changes to `HIGH_BURDEN_COUNTRIES` list as Phase 1 scope expands.
- FHIR IG updates affecting Provenance resource structure for justification codes.
