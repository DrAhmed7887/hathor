# DAK Clinical Questions — Ahmed's Decisions

Reviewed 2026-04-23. Twelve resolved; zero deferred. All DAK clinical questions
resolved and implemented. See `docs/CLINICAL_DECISIONS.md` for physician-authored
decisions (Q2, Q4, Q5, Q6, Q11).

---

## Q1. Confidence threshold scope — RESOLVED
**Decision:** 0.85 **per field** (not per row). Same threshold across all field types.

**Implication:** Extraction output schema uses `FieldExtraction` with per-field
`confidence`, `needs_review`, `ambiguity_reason`. Phase D gate iterates per field.
See `docs/schema-proposal.md` §1.

---

## Q2. Component-antigen partial satisfaction — RESOLVED
**Decision:** see `docs/CLINICAL_DECISIONS.md` Q2. Combination vaccines satisfy
per-component requirements when WHO-prequalified, minimum age met, and minimum
interval met. wP/aP interchangeable for series completion.

**Implemented as:** `HATHOR-EPI-001` (`_rule_component_antigen_satisfaction`) in
`api/src/hathor/safety/phase_e.py`.

---

## Q3. Egypt schedule vs. DAK baseline precedence — RESOLVED
**Decision:** `egypt_rules > dak_rules > general_defaults`.

**Implication:** Rules engine consults Egypt-specific tables first; falls back to
DAK when Egypt is silent; falls back to general WHO defaults when both are silent.
`get_schedule` uses Egypt's schedule as comparison target; DAK divergence surfaces
as informational note.

---

## Q4. ACIP 4-day grace — RESOLVED
**Decision:** see `docs/CLINICAL_DECISIONS.md` Q4. Doses 1–4 days early are valid;
5+ days early must be repeated. Exception: antigens with minimum age ≤ 28 days
(birth-dose HepB, BCG). Chained grace uses actual dates.

**Implemented as:** `HATHOR-DOSE-003` (`_rule_acip_grace_period`) in
`api/src/hathor/safety/phase_e.py`. Supersedes `HATHOR-DOSE-002` for interval
grace and `HATHOR-AGE-001` for age grace when shortfall is 1–4 days.

---

## Q5. Live vaccine co-administration — RESOLVED
**Decision:** see `docs/CLINICAL_DECISIONS.md` Q5. Different live parenteral vaccines
must be ≥28 days apart if not same-day. Live oral vaccines (OPV, Rotavirus) exempt.
Same-antigen intra-series handled by DOSE-002/003. 4-day grace does NOT apply here.

**Implemented as:** `HATHOR-EPI-002` (`_rule_live_vaccine_coadmin`) in
`api/src/hathor/safety/phase_e.py`.

---

## Q6. Rotavirus age cutoffs — RESOLVED
**Decision:** see `docs/CLINICAL_DECISIONS.md` Q6. ACIP cutoffs: dose-1 min 42 days,
dose-1 max 105 days (warn if exceeded, < 8 months), series max 240 days (fail).
Migrant advisory warn path for children arriving past dose-1 cutoff.

**Implemented as:** `HATHOR-AGE-003` (`_rule_rotavirus_age_cutoff`) in
`api/src/hathor/safety/phase_e.py`.

---

## Q7. Antigen scope for Phase 1 contraindications — RESOLVED
**Decision:** limit to antigens present in **Nigerian + Egyptian EPI schedules** for
the demo. Expansion beyond those schedules is post-hackathon.

**Implication:** The intersection of `data/schedules/nigeria.json` and
`data/schedules/egypt.json` antigens is the working set for the rules engine.
List will be pinned in `CLINICAL_DECISIONS.md` or derived from the JSONs at engine
init time.

---

## Q8. Validation severity model — RESOLVED
**Decision:** three-level `pass` / `warn` / `fail`.

**Implication:** `ValidationResult.severity` is a `Literal["pass", "warn", "fail"]`.
Phase E forwards `pass` and `warn` (warns include a visible banner); `fail` blocks
and replaces with a "requires physician review" flag. See `docs/schema-proposal.md` §3.

---

## Q9. Physician override policy — RESOLVED (HARD RULE)
**Decision:** clinician always has final authority. Any `fail` may be overridden.
Every override captures a clinician reason and is logged to the FHIR Provenance
resource with: DAK rule ID, agent's original proposal, clinician reason, timestamp.

**Encoded as:** hard rule in `CLAUDE.md` (Two Safety Loops → Clinician final authority).
`ValidationResult.override_allowed` defaults to `True` and should never be `False`.

---

## Q10. FHIR profile target — RESOLVED
**Decision:** **IMMZ** (WHO SMART Guidelines) as primary. IPS-Immunization as
fallback only if IMMZ integration blocks the demo.

**Implication:** `fhir.resources` validation runs against IMMZ profiles when built.
ValueSet bindings follow DAK's ICD-11/SNOMED CT/LOINC. Phase C (FHIR output) work.

---

## Q11. Contraindication source-of-truth conflicts — RESOLVED
**Decision:** see `docs/CLINICAL_DECISIONS.md` Q11. Precedence: Egypt MoH > Manufacturer
label > WHO DAK. Strictest applicable source governs; any contraindication verdict
triggers fail. Source verdicts carried in `Recommendation.source_verdicts`.

**Implemented as:** `EG-CONTRA-001` (`_rule_contraindication_source_conflict`) in
`api/src/hathor/safety/phase_e.py`. Rule ID changed from HATHOR-CONTRA-001 to
EG-CONTRA-001 per physician's naming (Egypt-MoH-sovereign authority).

---

## Q12. Phase 2 (Germany/STIKO) rule coverage — RESOLVED (with follow-up)
**Decision:** scope to a minimum set that demonstrates the architecture. The
minimum set is **to be defined in a separate conversation** with Ahmed before
implementation.

**Implication:** `rules/engine.py` is Phase 1 scope by default. STIKO stubs stay
as `NotImplementedError` (or absent) until the follow-up conversation.

---

## Deferred summary

All twelve DAK clinical questions resolved. No open deferrals.
