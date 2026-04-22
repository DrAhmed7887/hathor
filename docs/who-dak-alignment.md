# WHO DAK Alignment Strategy

Hathor's positioning strategy for credibility with WHO Innovation Hub, Gavi, and
partner ministries of health. The WHO Digital Adaptation Kit (DAK) for
Immunizations (2024) is the "Rosetta Stone" that translates Hathor's Python
clinical logic into a language these institutions already trust.

## Three Moves

| Move | Strategy |
| --- | --- |
| **Normative Alignment** | Map Hathor's logic to the WHO Digital Adaptation Kit (DAK) for Immunizations (2024). This proves the agent isn't "guessing" — it's following the official WHO data dictionary. |
| **Safety-First UI** | Lead with the Phase D review panel. The WHO is wary of "black box" AI hallucinations. Showing the tool blocking until a doctor verifies a 0.82-confidence row is Hathor's strongest clinical selling point. |
| **Interoperability** | Package the output as HL7 FHIR, aligning with the Global Digital Health Certification Network (GDHCN) standards. |

## About the DAK

The WHO Digital Adaptation Kit (DAK) for Immunizations (2024) is part of the
SMART Guidelines collection, designed to help developers and countries
implement WHO's clinical and data recommendations into digital systems.

### Official references

- **Full document (PDF):** *Digital adaptation kit for immunizations: operational requirements for implementing WHO recommendations in digital systems.*
- **WHO IRIS landing page:** Handle `10665/380303`.
- **Computable FHIR Implementation Guide (v1.1.0):** *SMART DAK IMMZ — Home.*

## Why It Matters for Hathor

The DAK provides structured, machine-readable versions of exactly the things
Hathor's engine already does in Python:

- **Decision-support logic** — detailed tables for routine and catch-up scheduling.
- **Data dictionary** — standardized data elements mapped to ICD-11 and SNOMED CT for immunization events.
- **Business requirements** — defined personas and user scenarios for digital immunization systems.

Aligning Hathor's internal models with the DAK's vocabulary and logic tables
turns the project from "a hackathon demo with reasonable clinical logic" into
"a reference implementation of WHO's own recommended workflow."

## Narrative & Positioning

How to talk about the gap-fix work to WHO Innovation Hub, Gavi, and ministry-of-health audiences. Governance-first framing — not accuracy benchmarks.

### Governance narrative

- **DAK codes in `VACCINE_DB`.** Acknowledging the gap today proves transparency. Adopting the SMART DAK IMMZ codes is exactly what the WHO Innovation Hub looks for — adherence to a global data dictionary over proprietary labeling.
- **Structured contraindications.** Moving contraindication rules from a "black box" system prompt into structured `IMMZ.D5.DT.*` lookups is a safety upgrade. It enables deterministic audits of the agent's reasoning, addressing WHO AI-governance concerns around transparency.
- **GDHCN & SMART Trust.** Recognizing that the Global Digital Health Certification Network is a separate bridging layer — reached through the SMART Trust IG, not IMMZ — demonstrates literacy in the broader Digital Public Infrastructure (DPI) landscape.

### Reasoning vs. Extraction

Standard OCR apps trust their eyes. Hathor's core differentiator is that **Opus 4.7 uses its reasoning strength to be self-critical on extraction itself.**

Rather than letting the model "guess" what a blurry date says, Hathor's pipeline asks the model to explain *why* a row is uncertain — e.g., *"the stamp overlaps the year '14', making the fourth digit ambiguous"* — so the physician fixes that one row before the agentic scheduling logic ever runs.

> "Standard apps fail because they trust their eyes. Hathor succeeds because it uses AI reasoning to double-check every extracted date against the WHO's official clinical rules, flagging errors before they ever reach the child's record."
