# HATHOR — Product Requirements Document

**AI-assisted digitization and schedule reconciliation for paper vaccination records**

*Prepared for: WHO Egypt · Egyptian Ministry of Health and Population (Preventive Medicine Sector) · American University in Cairo AI-in-Healthcare Hub · Hasso Plattner Institute Digital Health Cluster*

*Version 1.0 — April 2026*

---

## 0. How to read this document

This PRD synthesizes three independent deep-research reports (referred to here as **[Research note A]**, **[Research note B]**, and **[Research note C]**), supplemented by a fourth research note on VAccApp and WHO adoption pathways (**[VAccApp/WHO]**). Where the three sources converge, the claim is stated once with multi-source attribution. Where they disagree, the disagreement is shown and a position is recommended. Gaps across all sources are captured in §9 Open Questions.

---

## 1. Problem

### 1.1 The scale of the gap HATHOR addresses

The WHO Eastern Mediterranean Region (EMRO) is in a measurable immunization retreat. All three primary sources agree on the headline numbers:

- DTP3 coverage in EMRO fell from **84% (2019) to 79% (2024)**. [Research note A; Research note B; Research note C]
- Cumulative **zero-dose children** in EMRO, 2019–2024: **~14.3 million**, rising from ~2.0M annually in 2019 to ~2.8M in 2024. [Research note A; Research note B; Research note C]
- Approximately **90% of the EMRO zero-dose burden** is concentrated in five conflict-affected or fragile states — Sudan, Yemen, Afghanistan, Pakistan, and Somalia. [Research note A; Research note C]
- Sudan is currently the lowest-performing country globally for both DTP1 and MCV1. [Research note A]

These are not only epidemiological figures. They are the cohort HATHOR is designed to serve: children who cross borders under displacement, arrive at Egyptian maternal-and-child-health (MCH) clinics with damaged or foreign-language cards, and whose immunization histories must be reconstructed under time pressure by a clinician who has ten minutes.

### 1.2 Why the paper card persists

Paper home-based records (HBRs) remain the dominant longitudinal immunization record across MENA, Sub-Saharan Africa, and South Asia. WHO guidance confirms HBRs are in use in **more than 163 countries**, and systematic reviews describe them as culturally familiar, electricity- and connectivity-independent, and the only record that survives cross-border migration. [Research note B]

Three structural factors, consistent across all three sources, keep the paper card in place:

1. **Infrastructure.** Rural and peri-urban primary healthcare centers operate with intermittent internet and unstable power; cloud-dependent EHRs fail. [Research note A; Research note B]
2. **Mobility.** Egypt hosts millions of refugees whose national health systems do not share interoperable records with Egypt; the physical card is the only longitudinal bridge. [Research note A; Research note C]
3. **Capital and training.** Full EHR rollouts are capital-intensive and face high staff turnover; paper is the default resilient medium. [Research note A]

Even where DHIS2 has been introduced — 40 Gavi-supported countries now use it as their main immunization platform — most facilities still record doses on paper tally sheets and HBRs and only aggregate upward later. [Research note B]

### 1.3 What breaks when the card is misread

The three sources converge on four harm pathways, though they quantify the baseline error rate differently:

| Harm pathway | Mechanism |
|---|---|
| **Invalid dose** | A misread date causes a live-attenuated vaccine to be administered before the minimum interval; maternal antibodies or prior-dose interference neutralize it; the dose is recorded but confers no immunity. [Research note A; Research note B] |
| **Missed opportunity for vaccination (MOV)** | Uncertainty about prior doses leads clinicians to defer vaccination rather than risk invalid double-dosing, in direct tension with WHO catch-up guidance. [Research note A] A Jordan EMRO study cited by [Research note C] reports **63% missed opportunity** when a card is absent vs. 24% when present. |
| **Contraindication blindness** | Prior AEFI or immunosuppression not captured in the digital record means decision support cannot flag live-vaccine contraindications. [Research note B; Research note C] |
| **Programmatic data corruption** | Silently wrong dates and dose counts corrupt DHIS2 aggregates; Ministries misallocate outreach and supplementary immunization activities. [Research note A; Research note B] |

**Disagreement on baseline manual transcription error rate.** [Research note A] and [Research note B] both cite the same JAMIA outpatient point-of-care study reporting a **3.7%** manual transcription error rate, with ~0.5% clinically significant. [Research note C] cites an older immunization-specific study reporting **10.2%**. [Research note B] additionally cites a Thai DEPIC study in which **24.2%** of vaccination-date records in the routine electronic system were "absolutely inconsistent" with the paper logbook.

**Recommended position:** For institutional audiences, we state the range honestly: depending on setting and outcome definition, manual transcription errors run from **~3.7% on simple, supervised data entry to ~24% on batched end-of-day logbook digitization in rural clinics**. HATHOR's value proposition does not depend on the highest number; it depends on the fact that a non-trivial, clinically relevant fraction of records is wrong today and that reasoning-aware extraction can catch a meaningful share of those errors before they corrupt the record.

---

## 2. Strategic Context

### 2.1 RITAG Cairo, February 2026

The WHO EMRO Regional Immunization Technical Advisory Group met in Cairo on **11–12 February 2026**, with all three sources confirming two mandates directly material to HATHOR:

- **"Reaching zero-dose and under-immunized children,"** particularly in fragile and remote settings.
- **"Strengthening digitalization and innovative technology for data collection and use."** [Research note A; Research note B; Research note C]

Both [Research note B] and [Research note C] flag that the full IRIS summary report requires authenticated access and could not be retrieved programmatically; public reporting is via the EMRO news release. See §9 Open Questions.

### 2.2 Egypt's "Vaccine City" and the export thesis

In April 2026 the Egyptian Ministry of Health and Population reiterated production and export targets tied to the Vaccine City complex:

- **~115,000 m²**, 32 buildings; human and veterinary vaccine factories, R&D, logistics. [Research note A; Research note B; Research note C]
- **140 million human doses annually by 2030**, scaling to **690 million by 2040** — approximately **16% of Africa's vaccine demand**. [Research note A; Research note B; Research note C]
- Target markets: **60+ destination countries** across Africa and the Middle East. [Research note A; Research note B; Research note C]

The strategic implication, which all three sources draw independently, is that exporting doses without a parallel data infrastructure to monitor post-market efficacy, lot-level AEFI, and coverage attribution in destination countries leaves Egypt's biotech thesis exposed. HATHOR is positioned as the last-mile digital tether that accompanies the physical dose: a standardized, multilingual parser that converts any destination country's HBR format into a structured record interoperable with a Cairo-anchored surveillance backbone.

### 2.3 Egypt's National Digital Health Strategy 2025–2029

Launched November 2025 by Minister Khaled Abdel Ghaffar, the NDHS 2025–2029 commits to: [Research note A; Research note B; Research note C]

- Unified national health data and interoperable platforms by 2029.
- Standardized EHR deployment across Universal Health Insurance (UHI) facilities.
- Institutionalization of AI and mobile applications for diagnosis and decision support (Priority 6).
- Expansion of telemedicine and AI-assisted medical analysis under "Digital Egypt 2030."

**Disagreement.** [Research note A] reads the NDHS as providing "a clear regulatory runway for an AI-powered digitization tool." [Research note B] is more cautious, noting that public summaries do **not explicitly mandate** an electronic immunization registry or digitization of home-based cards. [Research note C] cites a secondary source that the roadmap includes a "national vaccination database" but concurs that the published strategy is high-level.

**Recommended position:** Treat NDHS as a permissive environment, not a specific mandate. HATHOR should be framed to MoH as a modular on-ramp that operationalizes the NDHS's interoperability and AI priorities for the specific, well-defined subdomain of routine immunization.

### 2.4 WHO IA2030 and the broader normative architecture

Global immunization policy is aligned with HATHOR's thesis:

- **IA2030** targets a **50% reduction in zero-dose children by 2030** and explicitly calls for expanded subnational data systems to map under-immunized populations. [Research note A; Research note B; Research note C]
- **Gavi Digital Health Information (DHI) Strategy 2022–2025** positions digital immunization information systems as foundational investments; **40 Gavi-supported countries** now use DHIS2 as their primary immunization platform. [Research note B; VAccApp/WHO]
- **WHO SMART Guidelines** include a dedicated **Immunization Digital Adaptation Kit (SMART DAK IMMZ v1.1)** covering core data elements, decision-support logic for routine and catch-up schedules, indicators, and non-functional requirements (offline capability, multilingual support, master facility list integration). [VAccApp/WHO]
- The **Global Digital Health Certification Network (GDHCN)** and **Global Initiative on AI for Health (GI-AI4H)** — co-led by WHO, ITU, and WIPO — provide open-source governance pathways into which HATHOR can be registered. [VAccApp/WHO]

### 2.5 Data protection — Egypt PDPL and cross-border LLM calls

Egypt's **Personal Data Protection Law No. 151 of 2020**, with Executive Regulations issued November 2025, enters full enforcement in **October 2026**. All three sources agree on the material provisions: [Research note A; Research note B; Research note C]

- Health data and children's data are classified as **sensitive personal data**.
- Processing requires explicit, informed guardian consent.
- **Article 14 restricts cross-border data transfers** to jurisdictions offering equivalent protection, subject to Personal Data Protection Centre (PDPC) licensing.
- Combined administrative and criminal sanctions, including personal liability for DPOs in serious cases.

The practical consequence is unanimous across the sources: any architecture that sends identifiable images to a non-Egyptian LLM API without aggressive, on-device de-identification is legally untenable once enforcement begins. See §5 Technical Requirements for the architectural response.

---

## 3. Users

HATHOR serves three tiers of the immunization workforce. All three primary sources converge on the same personas, though they differ in the exact patient-throughput numbers cited.

### 3.1 Primary: MCH clinic family physician (Cairo / Alexandria)

**Workflow.** Sees 40–60 patients per shift [Research note A], typically 7–10 minutes per patient [Research note B], with a card-review budget the physician will abandon at 1–2 minutes [Research note C]. Patients increasingly arrive with foreign cards from Sudan, Syria, Gaza, and other displacement origins.

**Pain points (consolidated across sources).**
- Deciphering torn, faded, stamp-overlapped, or foreign-language cards under time pressure.
- Mental catch-up interval math under fear of invalid double-dosing.
- No automated cross-check against WHO or national schedules at the point of care.

**Success metrics.** Time saved per encounter; reduced cognitive load; no increase in patient-safety incidents.

**Trust drivers (unanimous across sources).** The tool must not be an opaque black box. Extracted fields must be shown alongside the cropped source image region; uncertain fields must show the reasoning for uncertainty; every schedule recommendation must cite the specific WHO or MoH rule it invokes.

### 3.2 Secondary: Vaccination nurse / data entry clerk

**Workflow.** Administers vaccines during clinic hours; transcribes the day's paper ledger into the regional MoH portal (DHIS2, OpenMRS, or equivalent) after shift end.

**Pain points.** End-of-day bulk data entry is tedious, error-prone, and often uncompensated overtime. [Research note A; Research note B; Research note C]

**Success metrics.** Elimination of duplicate end-of-day entry; batch scan throughput; visual confidence cues that focus attention on likely errors.

### 3.3 Tertiary: MoH EPI analyst

**Workflow.** Cairo-based. Monitors regional coverage, zero-dose clusters, stock, and supplementary immunization activities via DHIS2 dashboards.

**Pain points.** Reports arrive weeks late, incomplete, or corrupted; cannot distinguish true zero-dose children from misclassified records. [Research note A; Research note B; Research note C]

**Trust drivers.** DHIS2 interoperability via structured FHIR-aligned payloads; independent audits demonstrating statistically significant error reduction; explicit documentation of how HATHOR prevents invalid dates from entering the registry.

---

## 4. Clinical Requirements

### 4.1 Required data elements per vaccination event

All three primary sources, cross-referenced against FHIR's `Immunization` resource and OpenMRS's immunization widget, converge on the same minimum dataset:

| Field | Source | Notes |
|---|---|---|
| Antigen / vaccine type | Card | e.g., bOPV, IPV, DTP-HepB-Hib pentavalent, PCV, MMR, MR |
| Date of administration | Card | Foundational variable for every interval calculation |
| Dose number in series | Card | DTP1 vs DTP3; may be inferred from date sequence |
| Batch / lot number | Card | Mandatory for AEFI traceability and recalls |
| Provider / facility stamp | Card | Visual authentication |
| Route and anatomical site | Card (often absent) | Clinician may supply during review |
| Performer / facility ID | Card + clinic context | For DHIS2 attribution |
| AEFI notes | Card or clinician | Drives contraindication logic |
| Next-dose due date and status | Derived | HATHOR output, not card input |

HATHOR must distinguish fields **read from the card** (which carry a confidence score) from fields **added by the clinician** during review (which carry clinician attribution).

### 4.2 WHO-aligned minimum intervals and schedule logic

All three sources reproduce essentially the same WHO minimum-interval table. The consolidated and clinically-safe synthesis, which HATHOR's deterministic rules engine must enforce, is:

| Antigen | Min. age, dose 1 | Min. interval 1→2 | Min. interval 2→3 | Critical age-out / notes |
|---|---|---|---|---|
| BCG | Birth | — (single dose) | — | Contraindicated in HIV-infected infants in many national policies [Research note B] |
| HepB (birth dose) | <24h | 4 weeks | 4 weeks | Special protocols for premature / low-birth-weight infants |
| bOPV | 6 weeks (birth dose in high-risk settings) | 4 weeks | 4 weeks | Independent of MR timing |
| IPV | 14 weeks (preferred per [Research note A]) | 4–8 weeks | — for 2-dose | Country variation: sequential IPV/OPV strategies differ |
| DTP-containing | 6 weeks | 4 weeks | 4 weeks | Boosters ≥ 4 years apart |
| Hib | 6 weeks | 4 weeks | 4 weeks | Single dose suffices for healthy children >12 months |
| PCV | 6 weeks | 4–8 weeks | 4–8 weeks | 3+0 vs 2+1 schedules vary by country |
| Rotavirus | 6 weeks | 4 weeks | 4 weeks (3-dose series) | **Hard cutoff: first dose ≤14 weeks 6 days; final dose ≤8 months (per Research note A) or 24–32 weeks (per Research note B)** — see disagreement below |
| Measles / MR / MMR | 9–12 months | 4 weeks | — | Egypt-specific timing to be confirmed (§9) |
| HepA | 12 months | 6 months | — | Strict 6-month minimum |
| HPV | 9 years | 6 months (12 preferred) | — (2-dose) | WHO SAGE now permits 1-dose in some contexts [Research note B] |
| MenACWY | Product-dependent; often adolescence | 8 weeks | — | Critical for Hajj/Umrah; Gulf policies differ |
| Yellow fever | 9–12 months in endemic countries | Single dose (long-term protection) | — | Contraindicated in severe immunosuppression |
| Typhoid (TCV) | 6–9 months in high-burden countries | — (single dose) | — | [Research note B] |

**Disagreement: rotavirus upper age bounds.** [Research note A] states the final dose must be by 8 months; [Research note B] cites 24–32 weeks. The difference traces to product (Rotarix 2-dose vs RotaTeq 3-dose) and the most recent WHO position paper revisions. **Recommended position:** HATHOR encodes per-product, per-country age-out rules rather than a single global number, because rotavirus is one of the vaccines where incorrect late dosing carries non-trivial intussusception risk.

**Disagreement: measles first dose age.** WHO permits 9 months in high-endemic settings; many national schedules prefer 12 months for better seroconversion. [Research note A; Research note B] Egypt's specific EPI policy must be confirmed (see §9 Open Questions). HATHOR's schedule engine must be parameterized per country, not globally.

### 4.3 Catch-up principles

All three sources converge on the WHO catch-up canon:

- **Resume, do not restart.** An interrupted primary series resumes without repeating prior valid doses, regardless of duration of delay. The exceedingly narrow exceptions (e.g., the oral cholera WC-rBS vaccine) are documented but out of scope for EMR pediatric practice. [Research note A; Research note B; Research note C]
- **Live-vaccine co-administration.** Live-attenuated vaccines (MMR, varicella, yellow fever) are administered either simultaneously or with a strict ≥4-week separation to prevent immunological interference; inactivated vaccines carry no such spacing requirement. [Research note A; Research note B]
- **Age-out enforcement.** Rotavirus is the canonical example: initiation past 15 weeks is prohibited due to increased intussusception risk. HATHOR must silence recommendations for aged-out vaccines rather than produce an unsafe suggestion. [Research note A; Research note B]

### 4.4 Contraindications and precautions

HATHOR's rules engine must encode at minimum: [Research note A; Research note B; Research note C]

- **Absolute:** anaphylaxis to a prior dose or component; severe immunosuppression (for live vaccines — BCG, MMR, varicella, yellow fever); pregnancy (for live viral vaccines).
- **Precautions:** moderate-to-severe acute illness (deferral, not prohibition); certain evolving neurologic conditions.

HATHOR cannot infer all of these from the card alone. The UI must present an explicit contraindication panel that the clinician completes; once set, the schedule engine must suppress any conflicting recommendation automatically.

### 4.5 National schedule deviation

All three sources flag the same tension: WHO provides a baseline; national NITAGs adapt. HATHOR's clinical reasoning layer must be geolocation- and origin-country-aware, enforcing the local MoH EPI over the WHO baseline where they differ. Card-origin context (country, year of issue) must be preserved throughout reconciliation so that a dose read on a Nigerian card is scored against the Nigerian schedule in force at the time, not against Egypt's current policy.

---

## 5. Technical Requirements

### 5.1 Accuracy benchmarks

The three primary sources present a nuanced picture on realistic accuracy:

| Regime | Benchmark | Source |
|---|---|---|
| Modern VLMs on clean printed English | 98%+ character accuracy | [Research note A; Research note B] |
| Handwriting-only OCR (domain-agnostic) | ~76% character accuracy plateau | [Research note A] |
| Rural HBR digitization with Tesseract-class OCR alone | ~85% character accuracy | [Research note B] |
| Human-augmented pipelines on the same data | ~99%; 85% records "perfect" | [Research note B] |
| Specialized pipelines (India MCP cards, template + homography) | 98.73% character accuracy vs. 75–79% for generic Google Vision / Azure | [Research note B] |
| Arabic-script document OCR (CAMIO benchmark, generic engines) | ~24% character error rate | [Research note B] |
| Arabic printed documents, tuned Tesseract | Up to 99.5% in controlled settings | [Research note B] |

**Disagreement on handwriting baseline.** [Research note A] states pure handwriting OCR plateaus at 76% without fine-tuning; [Research note B] suggests realistic handwritten-clinical baselines are 90–95% with modern deep-learning OCR (YOLO + TrOCR reporting 6–9% character error).

**Recommended position:** HATHOR targets ≥95% field-level accuracy on **date** and **antigen** on non-degraded cards, and ≥99% **flag-rate** on degraded fields. The distinction matters: HATHOR does not promise to extract every field perfectly; it promises never to silently commit a field it is not confident about. This is the reasoning-over-extraction thesis made auditable.

### 5.2 Latency

**Disagreement across sources:**

| Source | End-to-end target | UI interaction target |
|---|---|---|
| [Research note A] | <15 seconds | asynchronous — clinician proceeds with exam while inference runs |
| [Research note B] | <10–15 seconds end-to-end; progressive rendering | <2–3 seconds for post-extraction UI operations |
| [Research note C] | 2–3 seconds total | sub-second for CDS responses |

**Recommended position:** [Research note C]'s 2–3-second target is aspirational and unrealistic for a full frontier-VLM call; [Research note A]'s 15-second ceiling is realistic if the UI is asynchronous. HATHOR commits to:

- **≤3 seconds** for any post-extraction UI operation (field edit, review-and-accept, navigation).
- **≤15 seconds** end-to-end for card capture → structured, validated record, with progressive rendering of extracted rows so the clinician can start reviewing before the final row lands.
- **Hard timeout at 30 seconds** with a fallback to manual entry so the tool never blocks the clinical flow.

These targets must be validated with local user testing; see §9.

### 5.3 Multilingual reality

All three sources agree that Arabic-script and low-resource African-language OCR performance is the technical risk most likely to produce algorithmic inequity in HATHOR's target population. [Research note A; Research note B; Research note C]

- **Arabic handwriting** presents cursive connections, context-dependent letter shapes (isolated / initial / medial / final), bidirectional Latin-digit + Arabic-letter mixing, and diacritics that alter meaning. Generic VLMs perform substantially worse than on English.
- **Amharic (Ge'ez)**, **Swahili**, and **Urdu** suffer from limited annotated training corpora.
- **Date-format disambiguation** is an orthogonal hazard: "05/04/24" resolves differently in North American, European, and Arabic-origin cards.

HATHOR's mitigations:
- User-selected card-origin country biases the OCR and date-parsing backends.
- Confidence thresholds are language-aware: Arabic-script cards trigger review at a tighter threshold than Latin-script cards.
- The reasoning layer explicitly checks chronological plausibility against the child's DOB; impossibly-ordered dates force a review regardless of OCR confidence.

### 5.4 Privacy architecture (PDPL-compliant)

All three sources converge on the same architectural response to Egypt's PDPL:

1. **On-device PII redaction.** A lightweight NER model running on the clinic tablet or phone masks patient name, national ID, street address, and guardian identifiers before the image leaves the device. [Research note A; Research note B]
2. **Payload minimization.** Only cropped tensor regions containing the clinical table are transmitted to the cloud VLM. The PHI and the extracted clinical data are re-associated only on the clinic's local network. [Research note A; Research note B]
3. **Vendor contractual controls.** Any LLM vendor (e.g., Anthropic) must operate under a zero-data-retention agreement; Egypt's PDPL equivalent of a BAA must be in place; cross-border transfer must be PDPC-licensed with explicit guardian consent. [Research note A; Research note B; Research note C]
4. **Local-hosting roadmap.** For Phase 2, hosting the VLM in an Egypt-region data center, or in an on-premise enclave for Ministry sites, removes the cross-border-transfer question entirely. [Research note B; Research note C]

### 5.5 Offline-first architecture

Agreement across all three sources, reinforced by the Tanzania/Zambia BID Initiative and PATH evidence cited in [Research note B]:

- Image capture, confidence review, and local draft storage must function without connectivity.
- A local, packaged version of the WHO minimum-interval rules engine must execute offline, so that core schedule recommendations are available even when cloud inference is not.
- Encrypted local caching with background sync to the national registry (DHIS2 Tracker EIR) when connectivity returns.
- Robust multi-device conflict resolution at the EIR layer, not the client.

### 5.6 Two mandatory safety gates

HATHOR's internal design specifies two non-optional gates (see the project's `docs/SAFETY_LOOPS.md`):

- **Vision Safety Loop (per-field).** Any extracted field with confidence < 0.85 routes to human-in-the-loop (HITL) review rather than auto-committing. Per field, not per document.
- **Reasoning Safety Loop (per-recommendation).** Every clinical recommendation (dose due, dose overdue, dose-validity verdict, contraindication flag) passes through a deterministic rules engine derived from the WHO DAK before reaching the UI or any outbound FHIR bundle. The agent reasons freely; the output layer is gated.

The clinician retains final authority and can override any rules-engine verdict; every override is logged to a FHIR Provenance resource with DAK rule ID, original proposal, override reason, and timestamp.

---

## 6. UX Requirements

Design constraints consolidated from all three sources, expressed in terms a clinical audience will recognize:

1. **Reasoning-over-extraction is the visible product.** For every field, the UI must support showing the cropped image region, the extracted value, the confidence score, and — for flagged fields — the *reason* for uncertainty in plain language ("the facility stamp overlaps the year digit; resolution ambiguous between 2021 and 2024"). [Research note A]
2. **Single-field correction, not full-form retype.** Clinicians must be able to fix one ambiguous field without retyping the rest of the card. [Research note A; Research note C]
3. **Two severity channels.** Amber flags ("review this") are separated from red flags ("this interval violation would harm a child"). The product never uses the same channel for OCR uncertainty and for clinical-safety violations.
4. **Source attribution on every recommendation.** A schedule suggestion of "DTP3 due today" must render with a citation to the specific WHO position-paper rule (or national EPI rule) that produced it, so clinicians can audit the logic.
5. **Bidirectional RTL support in the card-review UI**, with Arabic and Latin content rendered correctly side-by-side. [Research note A; Research note C]
6. **Progress visibility.** No dead spinners. Skeleton states must advance as steps complete ("Parsing card…" → "Cross-checking WHO rules…" → "Computing next doses…"). [from hackathon build spec]
7. **Offline affordance.** The UI must signal offline mode clearly and degrade gracefully — local schedule logic continues to run, AI-based re-extraction is deferred until sync.

HATHOR explicitly does **not** replicate VAccApp's design center. [VAccApp/WHO] notes that VAccApp (now VIVI VaccApp) is a parent-facing, educational, manual-entry tool in the ViVI Vaccine Safety Initiative portfolio, actively maintained but not solving the frontline digitization problem. HATHOR targets a different layer — clinician-facing automated extraction and reconciliation — and could in principle feed records into tools like VIVI VaccApp or national caregiver apps (e.g., the Philippines' DigiVacc / VaccCheck).

---

## 7. Success Metrics

### 7.1 Institutional metrics (WHO EMRO, MoH, RITAG)

Drawn from [Research note A; Research note B; Research note C] and aligned to IA2030 and RITAG February 2026 priorities:

- **Zero-dose children identified and reached.** Absolute count of previously unrecorded or misrecorded children integrated into the national routine schedule through HATHOR-mediated encounters.
- **Coverage-data quality.** Reduction in discrepancy between physical doses administered and DHIS2-recorded doses. Target: from the observed manual-process error range (3.7%–24%, per §1.3) to **<0.5% clinically-significant discrepancy** in HATHOR-mediated records. [Research note A]
- **Missed Opportunities for Vaccination (MOV) avoided.** Count of valid catch-up doses HATHOR's rules engine recommended that would have been deferred under manual interval calculation.
- **DTP3 / MCV1 coverage uplift** in pilot catchment areas, measured six to twelve months post-deployment. [Research note C]

### 7.2 Operational / tool metrics

- **Digitization time.** End-to-end card capture → structured verified record: median **<5 seconds over 4G** for a non-degraded card [Research note A]; <15 seconds worst-case per §5.2.
- **Field-level extraction accuracy.** **≥95%** on date and antigen for non-degraded cards; **≥99% flag rate** on degraded fields (no silent failures). [Research note A]
- **Clinician override rate (leading indicator of calibration).** Target band **5%–10%**. [Research note A]
  - An override rate of 0% indicates automation bias — clinicians rubber-stamping without review.
  - An override rate >20% indicates the model is inefficient and will be abandoned.
- **Cards processed per clinic per week**, **time saved per encounter**, and **duplicate data-entry eliminated** — operational metrics the nurse persona will experience directly. [Research note C]

### 7.3 Leading vs. lagging indicators

- **Leading (pilot phase, 0–6 months):** cards scanned, field-level precision/recall on a curated benchmark set, latency distributions, clinician time-on-task, override-rate calibration, user-satisfaction scores.
- **Lagging (12+ months):** district-level DTP3 / MCV1 coverage uplift, documented reductions in VPD outbreaks, MoH-reported cost savings on outreach and stock allocation.

---

## 8. Risks and Scope

### 8.1 Risks and mitigations

| Risk | Vector | Mitigation |
|---|---|---|
| **Silent extraction failure** | Model returns a plausible but wrong date with high confidence; no flag triggered. | Chronological plausibility check against DOB and prior doses; tightened thresholds for Arabic-script cards; mandatory HITL for any field below 0.85 confidence; offline fallback to manual entry on timeout. [Research note A; Research note C] |
| **Automation bias / clinician over-trust** | 0% override rate indicates blind acceptance. | UI forces active confirmation per field; source image crop displayed alongside every extracted value; override-rate dashboard surfaced to supervisors. [Research note A] |
| **Algorithmic inequity** | VLMs underperform on Arabic, Amharic, Swahili handwriting vs. English. | Language-aware confidence thresholds; continuous fine-tuning on localized corpora; per-language accuracy reported publicly; bias audits in pilot phase. [Research note A; Research note B; Research note C] |
| **PDPL / cross-border exposure** | Identifiable images sent to non-Egyptian LLM. | On-device PII redaction, payload minimization, zero-data-retention vendor contracts, PDPC consent and licensing — see §5.4. Phase-2 move to Egypt-region hosting. |
| **Clinical liability** | Physician blindly accepts AI output; patient harmed. | MENA legal frameworks treat clinical AI as **decision support**; the physician retains the duty of care. [Research note A; Research note B; Research note C] UI design enforces per-field confirmation; Provenance audit trail logged for every override and accepted recommendation. |
| **Network timeout freezing clinical flow** | App hangs mid-inference; patient queue stops. | Hard 30-second timeout; asynchronous processing; manual-entry fallback path; queued background re-inference on reconnect. [Research note A] |
| **Regulatory classification ambiguity** | Egyptian Drug Authority may classify a schedule-recommendation algorithm as a regulated medical device. | See §9 Open Questions. HATHOR's conservative position is to pre-register under the more stringent interpretation and design clinical validation studies that would satisfy a medical-device pathway if required. [Research note A; Research note C] |

### 8.2 Scope — Demo vs. Pilot vs. Product

The PRD distinguishes three deliverable scopes. This is load-bearing for institutional conversations: promising pilot-grade validation in a hackathon demo, or promising product-grade privacy in a pilot, is how trust is lost.

#### Phase 1.0 — Hackathon Demo (April 2026, AUC Harvard HSIL Hackathon)

**In scope.**
- Card-parse pipeline using a frontier vision-language model with per-field confidence and reasoning for uncertain fields.
- Deterministic rules engine covering BCG, HepB, bOPV, IPV, DTP-containing (pentavalent), Hib, PCV, rotavirus, and measles-containing vaccines with minimum-interval and catch-up logic derived from WHO position papers.
- Synthetic test cards; Nigeria → Egypt reconciliation as the validated country pair; Arabic-script rendering in the review UI.
- End-to-end demo flow: chat intake → card upload → parsed results with uncertainty flags → schedule recommendation → FHIR-aligned JSON / PDF export.

**Out of scope.** DHIS2 live integration; PDPC-licensed production privacy architecture; antigens lacking interval rules in the current engine (DT, HepA, MenA, MenACWY, MenC, Mumps, Rubella, Yellow Fever — already documented); live patient data; HIPAA/PDPL compliance audit; multi-site deployment.

#### Phase 1.1 — Controlled Pilot (3 clinics, 90 days)

Adapted from [Research note A] and [Research note C]:

- **Phase 1.1a, Shadow mode (30 days).** Clinicians retain paper workflow; HATHOR runs in parallel via embedded research assistants. Goals: real-world VLM extraction accuracy against a physician-curated gold standard; latency under actual cellular conditions; hardware-fit assessment on the devices the clinics actually use.
- **Phase 1.1b, Active integration (60 days).** HATHOR is the primary intake and validation tool. Metrics: patient throughput, historical back-data digitized, nurse-persona satisfaction, override-rate calibration, AEFI-traceability completeness.

In scope for pilot but out of scope for hackathon: PDPL-compliant on-device redaction, clinical-validation statistical reporting, DHIS2 write integration, guardian consent flow, independent bias audit.

#### Phase 1.2 — Product (national rollout candidate)

In scope for product but out of scope for pilot:

- PDPC licensing and cross-border-transfer agreements with LLM vendors, or migration to Egypt-region hosting.
- Medical-device regulatory pathway (if classified as such by EDA).
- DHIS2 national Tracker EIR interoperability, validated and audited.
- Registration in the **WHO Digital Health Atlas** and submission to the **WHO Innovation Hub LEAD Innovation Challenge**; alignment of HATHOR's data dictionary and decision logic with **SMART DAK IMMZ v1.1** as a digital public good candidate in **GI-AI4H**. [VAccApp/WHO]
- Multilingual training corpora expanded to Amharic, Urdu, Swahili, French, English, and Arabic, with per-language accuracy reported publicly.
- Integration paths with caregiver-facing apps (e.g., VIVI VaccApp, DigiVacc / VaccCheck) as downstream consumers of HATHOR's validated records.

#### Explicitly out of scope for this PRD

Cross-continental reconciliation with non-African destination schedules; adult travel-vaccine use cases; veterinary integration with Vaccine City's biological products; consumer-facing use without clinician supervision.

### 8.3 Go-to-market entry points

Consolidated from [Research note A; Research note C; VAccApp/WHO]:

1. **Academic validation and demo.** AUC AI-in-Healthcare Hub and Hasso Plattner Institute Digital Health Cluster; Harvard HSIL Hackathon (April 10–11 2026, AUC Hub).
2. **WHO Egypt.** Engage Dr. Nima Saeed Abid, WHO Representative in Egypt; position HATHOR against the RITAG February 2026 digitalization and zero-dose mandates.
3. **MoH integration.** Partner with the Preventive Medicine Sector; position HATHOR as a "smart on-ramp" to the existing DHIS2 infrastructure, not as a competing EHR.
4. **Global visibility.** Register with the WHO Digital Health Atlas; apply to the WHO Innovation Hub LEAD Innovation Challenge (AI for All); submit to GI-AI4H as an open-source digital public good candidate aligned with SMART DAK IMMZ. [VAccApp/WHO]
5. **Funding pathway.** Gavi DHI strategy alignment; UNICEF country-level pilot co-design; potential joint scientific engagement with ViVI (original VAccApp team) to run a multimodal-extraction vs. manual-parent-entry comparative study.

---

## 9. Open Questions

Gaps where all three primary sources, plus the [VAccApp/WHO] supplement, hit the same wall. Each requires primary field research, a stakeholder interview, or access to a paywalled document before HATHOR can move from demo to pilot.

### 9.1 Clinical and regulatory

1. **Egypt's exact EPI schedule in force, 2026.** Specifically: measles first-dose age (9 vs. 12 months); HPV dose count (1 vs. 2 vs. 3); inclusion and timing of TCV, yellow fever, and HepA. [Research note B; Research note C]
2. **Egyptian Drug Authority classification.** Is a dynamic schedule-recommendation algorithm a regulated **medical device** requiring clinical trials, or an unregulated **administrative decision-support tool**? No authoritative local guidance found. [Research note A; Research note C]
3. **PDPL application to third-party LLMs.** No Egyptian regulatory guidance yet exists on the treatment of healthcare LLM API calls as cross-border personal-data transfers. This is the single largest regulatory ambiguity. [Research note B]
4. **Full RITAG February 2026 summary report.** The IRIS summary was not programmatically retrievable; only the EMRO news release is public. Specific recommendations on digital IDs, interoperability with civil registration, or zero-dose reference architectures may exist in the full report. [Research note B; Research note C]
5. **NDHS 2025–2029 immunization-specific mandates.** The public summary is high-level; whether the full strategy document explicitly mandates a national electronic immunization registry, data-exchange standards, or digitization of home-based records is unclear. [Research note B; Research note C]

### 9.2 Operational and field

6. **Exact hardware baseline in Egyptian MoH MCH clinics.** Device make, model, OS, processing power, camera resolution. This ceiling determines whether on-device NER for PII redaction is feasible, and whether HATHOR ships as a mobile-first or tablet-first application. [Research note A; Research note C]
7. **Clinician latency tolerance.** The precise seconds-threshold at which an Egyptian family physician reverts to paper under a 50-patient shift is unknown; sources cite general EHR usability studies rather than EMRO-specific measurements. [Research note A; Research note B; Research note C]
8. **DHIS2 write-endpoint permissions.** What specific Tracker EIR endpoints and authentication schemes will the Egyptian MoH grant to a third-party application, and what is the data-validation contract (which fields are mandatory, which trigger rejections)? [Research note A]
9. **Unit economics at scale.** Per-scan inference cost under current frontier-VLM pricing is not yet characterized against a plausible sustainable MoH or Gavi co-financing model. [Research note A; Research note C]
10. **EMRO "under-immunized" count (not zero-dose).** Zero-dose figures are well-documented; the partially-immunized cohort — which may be the larger clinical population HATHOR serves — lacks comparable regional statistics. [Research note C]

### 9.3 Evidence and benchmarks

11. **No published LLM vision benchmarks on vaccination cards.** No head-to-head comparisons of commercial frontier VLMs or open-source VLMs on multilingual, stamped, degraded HBRs exist. This benchmark must be produced in-house during Phase 1.1a. [Research note C]
12. **No WHO sandbox for third-party AI tools on immunization specifically.** GI-AI4H and the WHO Innovation Hub are the closest pathways, but a dedicated evaluation environment does not currently exist. [VAccApp/WHO]
13. **Competitor pricing and business models.** NexaLink, Vacuna, and similar tools do not publish pricing or commercial terms; the market-price reference for a per-scan cost is missing. [Research note B; Research note C]

---

## 10. Source Attribution

- **[Research note A]** — *Product Requirements and Market Landscape Report: HATHOR AI-Powered Vaccination Digitization Platform* (deep-research report, April 2026).
- **[Research note B]** — *HATHOR: AI-Powered Vaccination Card Digitization and Schedule-Recommendation – Research Foundations for PRD* (deep-research report, April 2026).
- **[Research note C]** — *Research for PRD* (deep-research report, April 2026).
- **[VAccApp/WHO]** — *Hathor, VAccApp, and Global Pathways for AI-Enabled Immunization Record Tools* (supplementary research note, April 2026).

Where a claim appears in all three primary sources, it is stated here as consensus. Where sources disagree, the disagreement is shown and a position is recommended with reasoning. Where all sources hit a wall, the gap is listed in §9.
