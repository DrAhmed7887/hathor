# Hathor

An autonomous clinical reasoning agent for cross-border vaccination schedule reconciliation.

---

## The Story Behind the Name

Hathor was the ancient Egyptian goddess of motherhood and the protection of children. This project takes its name and its purpose from that origin. It was built by an Egyptian physician relocating to Germany with his family — for whom the question this software answers is not abstract. When you arrive in a new country with your children's vaccination cards, you face a real administrative and clinical gap: the records are real, the vaccines were given, but nobody can tell you cleanly which ones count, which are missing, and what your children need next under the new country's schedule. Hathor is the tool that should have existed.

---

## The Clinical Problem

Migrant families face a genuine clinical gap at the intersection of international health systems. As documented by Hargreaves et al. (*Lancet Public Health*, 2024), migrant children are systematically under-vaccinated relative to host-country standards — not because vaccines were withheld, but because cross-border immunisation record continuity is an unsolved problem in routine clinical practice. Egypt's EPI schedule, Germany's STIKO recommendations, and the WHO's universal childhood immunisation schedule (WHO IA2030) overlap in complex and non-obvious ways: a vaccine given under one trade name in one country may satisfy a requirement listed under a different name in another; timing windows differ; combination vaccines are recorded differently across health systems.

No existing tool reconciles these schedules automatically. Clinicians do it manually from memory or outdated reference sheets, parents receive inconsistent guidance, and children sometimes receive redundant doses or — worse — miss necessary catch-up vaccinations entirely. The closest published system, AI-VaxGuide (arXiv 2507.03493), addresses clinician Q&A over a single-country guideline corpus; it does not perform cross-jurisdictional equivalence reasoning, does not process card images, and is not designed for the parent-facing use case.

---

## The Solution

Hathor is an autonomous agent built on the Claude Agent SDK and Claude Opus 4.7. Given a photograph of a child's vaccination card, the child's date of birth, and a target country, the agent:

1. Parses the card — reading trade names, dates, and dose numbers via vision
2. Resolves equivalences — mapping trade names (e.g. "Hexyon", "Pentavac") to canonical antigens and validating whether each dose counts under the destination schedule's rules
3. Validates each dose — checking minimum age at administration, maximum age cutoffs, and minimum intervals between doses of the same antigen
4. Identifies gaps — diffing the validated history against the target schedule to find completed, overdue, and upcoming doses
5. Generates a catch-up plan — grouping doses into clinic visits with correct co-administration rules, live/non-live separation, and age-window constraints
6. Flags for the clinician — surfacing anything requiring professional judgement before administering vaccines

The output is structured clinical decision support, appropriately caveated as non-prescriptive guidance requiring confirmation by a licensed paediatrician.

---

## Architecture

```
User input
  └── card image path + DOB + target country
        │
        ▼
  ClaudeSDKClient (Opus 4.7, extended thinking, budget 8000 tokens)
        │
        ├── extract_vaccinations_from_card   [vision → structured dose list]
        ├── compute_age_at_dose              [date arithmetic]
        ├── lookup_vaccine_equivalence       [trade name → canonical antigens]
        ├── check_interval_rule              [antigen × dose pair → interval validity]
        ├── validate_dose                    [full per-dose validity: age + interval + max-age]
        ├── get_schedule                     [country code → filtered STIKO/WHO/EPI schedule]
        ├── compute_missing_doses            [validated history × schedule → gap analysis]
        └── build_catchup_schedule           [gap list → visit-grouped catch-up plan]
        │
        ▼
  Structured reconciliation report
  (card summary · dose validation · coverage table · catch-up plan · paediatrician flags)
```

The agent decides the order and combination of tool calls autonomously — no orchestration pipeline is hardcoded. Extended thinking is enabled throughout so the agent's reasoning is visible and verifiable.

---

## How It Works

A parent uploads their child's Egyptian vaccination card. The agent reads the card, resolves "Hexyon" to DTaP + IPV + Hib + HepB, calculates the child's exact age at each dose, checks each dose against STIKO's minimum age and interval rules, identifies that the Egyptian 2–4–6 month hexavalent schedule creates an invalid STIKO G3 (which requires a 180-day gap from G2), notes that pneumococcal and meningococcal B vaccines are absent entirely from the Egyptian national programme, excludes rotavirus from the catch-up plan because the intussusception age cutoff has passed, and produces a visit-by-visit catch-up schedule with correct live-vaccine co-administration rules — all without any hardcoded logic. The entire reasoning chain is visible in the extended thinking output.

---

## Quick Start

**Requirements:** Python 3.11+, [uv](https://github.com/astral-sh/uv), `ANTHROPIC_API_KEY` in environment.

```bash
git clone https://github.com/DrAhmed7887/hathor.git
cd hathor/api
uv sync
export ANTHROPIC_API_KEY=sk-ant-...
uv run python -m hathor.run_agent
```

To run with Opus 4.7 (higher cost, more conservative clinical reasoning):
```bash
HATHOR_MODEL=claude-opus-4-7 uv run python -m hathor.run_agent
```

---

## Current Capabilities and Future Work

**Implemented:**
- Egypt → Germany (STIKO Impfkalender 2026) reconciliation
- Eight clinical reasoning tools registered as an in-process MCP server
- Trade-name resolution for 20+ vaccine products (Hexyon, Pentavac, Priorix, Varilrix, Rotarix, and others)
- STIKO-specific rules: 2+1 schedule, 180-day G2→G3 interval, rotavirus age contraindication, Masernschutzgesetz documentation flag
- Egyptian Pentavac IPV-gap detection (Egyptian pentavalent = DTaP+HepB+Hib, no IPV — IPV given separately)
- Full validation: minimum age, maximum age (rotavirus), inter-dose intervals with ACIP 4-day grace period
- Catch-up scheduling with live/non-live co-administration rules and age-window constraints

**Future work:**
- Additional source/target country pairs (Turkey → Germany, India → UK, etc.)
- Vision-based card OCR replacing the current stub extractor
- FastAPI + Next.js web interface with SSE streaming
- Formal evaluation harness across synthetic and anonymised real-world cases
- Deployment as a paediatric decision-support MCP server

---

## Evaluation Approach

Agent outputs are evaluated across three dimensions: (1) clinical correctness of dose validity judgements against ground truth from a licensed paediatrician; (2) catch-up plan completeness — do all required doses appear, correctly grouped, with valid inter-visit intervals; (3) safety behaviour — are contraindicated vaccines (rotavirus beyond age cutoff, MMR before minimum age) correctly excluded rather than flagged as overdue. Full evaluation methodology will be documented in `docs/METHODS.md`.

---

## Limitations

- **Not a medical device.** Hathor is a research prototype. All outputs require confirmation by a licensed paediatrician before clinical action is taken.
- **Egypt schedule is approximate.** The Egypt EPI data was compiled from Vacsera product documentation and the Nomou paediatric health app (reviewed March 2026 by the author). It has not been validated against official MOHP policy documents.
- **Card extraction is a stub.** In this prototype, card image parsing returns a hardcoded test scenario. Production OCR is future work.
- **STIKO rules are jurisdiction-specific.** The catch-up logic is calibrated for Germany. Other European destination countries have different rules and are not yet supported.
- **No formal peer review.** The clinical rules encoded in the system prompt and validation tools have been reviewed by the author (an Egyptian-trained physician) but have not undergone peer review or clinical audit.

---

## References

- Hargreaves et al., *Lancet Public Health*, 2024 — Migrant life-course immunisation
- AI-VaxGuide, arXiv 2507.03493 — Closest prior agentic system in the vaccination domain
- WHO Immunization Agenda 2030 — https://www.who.int/teams/immunization-vaccines-and-biologicals/strategies/ia2030
- STIKO Impfkalender 2026 — https://www.rki.de
- Australian Immunisation Handbook, Catch-up chapter — https://immunisationhandbook.health.gov.au

---

## License

MIT © 2026 Ahmed Zayed

---

*Built for the "Built with Opus 4.7" Hackathon — Anthropic × Cerebral Valley, April 21–26, 2026.*
