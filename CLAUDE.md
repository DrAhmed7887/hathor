# CLAUDE.md — Hathor Project Rules

This file is read by Claude Code at the start of every session on this repository.
Follow these rules without exception. If a user instruction conflicts with a rule here,
flag the conflict before proceeding.

---

## What This Project Is

Hathor is an autonomous clinical reasoning agent for cross-border vaccination schedule
reconciliation. See README.md for the full context. The project was built by Ahmed Zayed,
an Egyptian physician, as a hackathon submission and as the foundation for ongoing research.

**Current scope — Phase 1 (hackathon):** intra-Africa reconciliation. The validated source
country is Nigeria; the validated destination country is Egypt. Other African country pairs
are future work within Phase 1.

**Phase 2 (post-hackathon, may not be reached in hackathon):** Africa → Europe
reconciliation, starting with Germany/STIKO. The Phase 2 schedule (`germany.json`) and
tool rules are present in the code for continuity, but they are NOT part of the Phase 1
public-facing surface. Do not mention Germany, STIKO, Aachen, RWTH, Masernschutzgesetz,
or Kita in demos, README copy, UI, or new evaluation material. If a user prompt asks
about Phase 2 work, flag the scope before proceeding.

---

## Model Defaults

- **Default model: `claude-opus-4-7`** — Hathor is an Opus 4.7 project. Use this for
  all development, testing, demos, and evaluation runs.
- Sonnet 4.6 (`claude-sonnet-4-6`) may be used for side-by-side comparisons when
  Ahmed explicitly requests them, but never as the default.
- The `HATHOR_MODEL` environment variable overrides the default in all scripts.

---

## Scope Discipline

No feature is added without Ahmed's explicit approval. When in doubt:

1. Describe what you're considering and why.
2. Ask whether to proceed.
3. **Default answer is no.**

This applies to new dependencies, new files, new endpoints, UI additions, and refactors.
A bug fix does not justify surrounding cleanup unless separately approved.

---

## Architectural Rule: No Hardcoded Pipeline

Hathor's agent must decide its own path. You must never write orchestration code like:

```python
result1 = pass_one(input)
result2 = pass_two(result1)
result3 = pass_three(result2)
```

That is a script, not an agent. The Claude model decides which tools to call, in what order,
based on what it discovers. Your job is to provide good tools and a good system prompt —
not to orchestrate the reasoning.

---

## Tool Granularity Principle

Each custom tool must answer **one specific clinical sub-question**. The test:

- `reconcile_everything(card, dob, country)` — **too chunky.** One tool cannot do the whole job.
- `read_single_pixel(x, y)` — **too granular.** Not a clinical decision.
- `lookup_vaccine_equivalence(source_vaccine, target_schedule)` — **correct grain.**
  One clinical decision: does this vaccine count under this schedule?

When designing tools, ask: "What is the one question this answers?" If the answer is more
than one sentence, split the tool.

---

## Secrets

- `ANTHROPIC_API_KEY` lives **only** in the shell environment. Never write it to a file.
- `.env.example` contains only placeholder values.
- If you need to verify the key is loaded, print only the first 8 characters + `...`.
- Never log, print, or commit any real credentials.

---

## Before Large Changes

For any change that touches more than two files, adds a dependency, modifies the agent
system prompt, or changes the tool interface: **describe the change and ask first.**
Ahmed will approve or redirect.

---

## Repository Layout

```
hathor/
├── api/          Python backend (FastAPI + Claude Agent SDK)
├── web/          Next.js frontend
├── data/         Vaccination schedule JSON files
├── cards/        Synthetic test card images
├── docs/         REFERENCES.md and methods documents
├── evaluation/   Evaluation logs and harness
```
