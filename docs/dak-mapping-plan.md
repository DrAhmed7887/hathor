# DAK Mapping Plan

Scoping document for aligning Hathor with the **WHO SMART DAK IMMZ v1.1.0** (L2
IG at https://smart.who.int/dak-immz/, L3 computable IG at
https://build.fhir.org/ig/WorldHealthOrganization/smart-dak-immz/, PDF at
https://iris.who.int/handle/10665/380303). This is a scoping document only —
no code changes yet. Companion strategy note: [who-dak-alignment.md](./who-dak-alignment.md).

---

## 1. What Hathor has today

Hathor's clinical reasoning surface is an 8-tool agent (`api/src/hathor/tools/`) orchestrated by a Claude Opus 4.7 agent against per-country schedule JSONs.

### Tools exposed to the agent
Registered in `api/src/hathor/tools/__init__.py:10`.

| Tool | File:line | Clinical sub-question |
| --- | --- | --- |
| `get_schedule` | `tools/schedule.py:38` | What does country X expect by age Y? |
| `lookup_vaccine_equivalence` | `tools/vaccine_lookup.py:215` | Does this trade name count under that schedule? |
| `compute_age_at_dose` | `tools/age_math.py:12` | How old was the child on the date given? |
| `check_interval_rule` | `tools/intervals.py:90` | Is the gap between consecutive doses valid? |
| `validate_dose` | `tools/dose_validation.py:36` | Is this single dose valid (min/max age + interval)? |
| `compute_missing_doses` | `tools/coverage.py:37` | What's missing vs. target schedule? |
| `build_catchup_schedule` | `tools/catchup.py:23` | What's the prioritized next-visit plan? |
| `extract_vaccinations_from_card` | — | (OCR — out of DAK scope) |

### Vocabulary
- `VACCINE_DB` in `tools/vaccine_lookup.py:9` — lowercase trade-name → `{canonical_name, manufacturer, components[], combination_type, stiko_equivalent, notes, source}`.
- Component-to-combined rollup in `tools/coverage.py:14` — e.g. frozenset `{Measles, Mumps, Rubella}` → `MMR`.
- Canonical antigens are Hathor-internal strings (`"DTaP"`, `"IPV"`, `"Hib"`, `"HepB"`, `"Measles"`, …). **No ICD-11 / SNOMED / LOINC codes today.**

### Schedules
`data/schedules/{egypt,nigeria,who,germany}.json`. Hand-curated per-country schedule + interval rules + key-differences metadata. Phase 1 validated pair: Nigeria → Egypt.

### Agent instructions
`api/src/hathor/agent_prompt.py:3` — `SYSTEM_PROMPT`. No hardcoded pipeline; the agent picks its own tool sequence. Rules baked into prompt: antigen equivalence, Egypt EPI specifics, live-vaccine co-admin, ACIP 4-day grace.

### Output
`api/src/hathor/server.py:54` streams SSE: `agent_start`, `thinking`, `tool_use`, `tool_result`, `assistant_text`, `final_plan` (markdown with 5 sections), `run_complete`. **The terminal artifact is agent-authored markdown, not a structured resource.**

---

## 2. What the DAK provides

### Artifact categories (all confirmed present in IMMZ v1.1.0)
- **Generic personas** — https://smart.who.int/dak-immz/personas.html. Health worker, community health worker, EPI manager. No distinct "record-reviewer" persona; record review is part of the vaccine-administration workflow.
- **User scenarios & business processes** — enumerated in PDF Ch. 3.
- **Data dictionary** — downloadable Excel + L3 FHIR Logical Models + 45+ ValueSets. Codings bound to **ICD-11, SNOMED CT, LOINC, UCUM** (https://smart.who.int/dak-immz/v0.9.9/codings.html). ICHI **not found**.
- **Decision-support logic** — `IMMZ DAK_decision-support logic.xlsx` spreadsheet + computable **PlanDefinitions** + **CQL Libraries** in L3 IG. Table pattern `IMMZ.D5.DT.{antigen}{Variant}` (e.g. `IMMZD5DTBCGContraindications`).
- **Indicators & measures** — FHIR `Measure` resources. Out of Hathor's scope.
- **System requirements** — functional + non-functional.

### FHIR profiles in the L3 IG
Patient (IPS), **Immunization**, Encounter, Condition, Questionnaire/QuestionnaireResponse, plus CPG-style ActivityDefinitions, PlanDefinitions, and CQL Libraries (e.g. `IMMZD18SBCGLogic`).

### Antigens covered by DAK PlanDefinitions
BCG, DTP, Cholera, Dengue, HPV, HepA, HepB, Hib, Japanese Encephalitis, Malaria, Measles, Meningococcal, Mumps, Pneumococcal, Polio, Rabies, Rotavirus, Rubella, Seasonal Influenza, Tick-Borne Encephalitis, Typhoid, Varicella, Yellow Fever.

### GDHCN relationship
**Not direct.** DAK IMMZ does not reference GDHCN on its index. Bridge is via the sibling **WHO SMART Trust IG** (https://smart.who.int/trust/). Treat GDHCN as a downstream concern, not an IMMZ artifact.

---

## 3. Gap analysis

Effort key: **T** = trivial (mapping table / relabel), **M** = moderate (new module, no model rewrite), **B** = blocker-grade (requires redesign).

| Hathor concept | DAK equivalent | Effort | Notes |
| --- | --- | --- | --- |
| `VACCINE_DB` canonical antigens (`"DTaP"`, `"Measles"`, …) | DAK Codings — ICD-11 / SNOMED / LOINC ValueSets | **T** | Add a `dak_codes` field per antigen. Mechanical lookup against the Codings page. |
| `VACCINE_DB` trade names (Hexyon, Priorix, Pentaxim, Pentavac, …) | DAK data dictionary vaccine products | **M** | DAK uses product-agnostic antigen logic; Hathor's trade-name layer is a Hathor extension. Keep it, but annotate each entry with the DAK antigen codes it resolves to. |
| `data/schedules/*.json` routine schedules | `IMMZ.D2.DT.*` decision tables (per-antigen scheduling) | **M** | Compare Hathor's Egypt/Nigeria schedules against the WHO baseline the DAK encodes. Hathor's per-country overrides stay, but should be expressed as deltas against the DAK baseline. |
| `tools/intervals.py` interval rules | `IMMZ.D5.DT.*` interval / catch-up tables | **M** | Spreadsheet comparison; most rules will align (ACIP + WHO share lineage), STIKO-specific rules diverge. |
| `tools/dose_validation.py` validity logic | DAK PlanDefinitions + CQL Libraries (e.g. `IMMZD18SBCGLogic`) | **M** | Don't port to CQL — keep Python. Instead, per antigen, cite the DAK PlanDefinition ID the rule corresponds to in a comment/docstring, so auditors can cross-check. |
| Contraindication rules (currently in `agent_prompt.py` + `catchup.py`) | `IMMZ.D5.DT.{antigen}Contraindications` PlanDefinitions | **M** | Hathor's contraindication logic is currently prose in the system prompt. Extracting per-antigen contraindications into a structured lookup and mapping to DAK PlanDefinition IDs is high-value. |
| `build_catchup_schedule` output (markdown plan) | FHIR `Immunization` + `Encounter` + `CarePlan` bundle | **M** | New thin FHIR serialization layer at the server boundary. Keep the markdown for humans; emit FHIR for machines. |
| Agent's `final_plan` markdown report | No direct DAK equivalent (L2 narrative vs. L3 resources) | **T** | Narrative output is fine; add a companion structured JSON/FHIR payload. |
| Phase D review UI (confidence-gated approval) | SMART Trust IG (downstream) | **M** | Not an IMMZ artifact. Defer until trust/certification story is scoped separately. |
| `SYSTEM_PROMPT` in `agent_prompt.py` | DAK User Scenarios (PDF Ch. 3) | **T** | Add a docstring citing which DAK scenario each prompt section implements. |
| `extract_vaccinations_from_card` (OCR) | — | — | DAK does not cover card OCR. Out of scope for alignment. |

**No blockers identified.** Every gap is mapping work, not a redesign.

---

## 4. Proposed phased plan

Each phase is independently valuable and leaves the project in a shippable state. All scope changes still require explicit approval per `CLAUDE.md`.

### Phase A — Data dictionary alignment (1–2 days, low risk)
**Goal:** every antigen Hathor knows about carries its DAK coding.

- Pull the IMMZ v1.1.0 Codings page into a local reference table (`data/dak/codings.json`).
- Extend each `VACCINE_DB` entry with `{icd11, snomed, loinc}` resolved via the DAK antigen mapping.
- Expose codes through `lookup_vaccine_equivalence` output.
- No behavior change; pure annotation.

### Phase B — Decision-logic cross-reference (2–3 days, low risk)
**Goal:** every clinical rule Hathor enforces is traceable to a DAK artifact.

- Download the DAK decision-logic spreadsheet; extract the per-antigen interval, min-age, max-age, and contraindication tables into machine-readable form (`data/dak/decision_logic.json`).
- For each rule in `intervals.py`, `dose_validation.py`, `catchup.py`: add a `dak_source` docstring pointing to the PlanDefinition ID (e.g. `IMMZD5DTBCGContraindications`).
- Produce `docs/dak-conformance.md` — a table showing every Hathor rule and the DAK row it matches or deliberately diverges from (e.g. Egypt MoH's 1-month BCG vs. DAK's birth-dose BCG).

### Phase C — FHIR output (3–5 days, medium risk)
**Goal:** the reconciliation output is machine-readable, not only human-readable.

- New module `api/src/hathor/fhir/serialize.py`. Convert the final reconciliation state into a FHIR bundle: `Patient`, one `Immunization` per validated dose, `Condition` for any flagged contraindications, `CarePlan` for the catch-up schedule.
- Profile against IMMZ's Immunization profile from the L3 IG.
- Add a new SSE event type `final_fhir` alongside `final_plan`. Frontend stays text-first; FHIR is opt-in.
- Do **not** replace the markdown report — it stays the clinician-facing surface.

### Phase D — Persona & scenario alignment (0.5 day, documentation only)
**Goal:** Hathor's positioning maps cleanly to DAK personas.

- Document which DAK persona(s) Hathor serves (most likely "health worker" + "EPI manager"), citing the personas page.
- Identify the specific DAK user scenarios (PDF Ch. 3) Hathor implements. Note any Hathor scenario that does **not** appear in the DAK (e.g. cross-border record reconciliation, which is a Hathor contribution to the DAK conversation, not a DAK artifact).

### Deferred — SMART Trust / GDHCN
Scope separately when the verifiable-credentials story is on the roadmap. Not part of DAK alignment.

---

## 5. Recommended first move

Start with **Phase A**. It's the smallest, most mechanical, and unlocks everything else: once antigens carry DAK codes, every downstream phase can reference them. One session, one PR, no behavior change.

Proceed?
