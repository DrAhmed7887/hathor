# CLAUDE.md — Hathor Project Rules

This file is read by Claude Code at the start of every session on this repository.
Follow these rules without exception. If a user instruction conflicts with a rule here,
flag the conflict before proceeding.

---

## What This Project Is

Hathor is an autonomous clinical reasoning agent for cross-border vaccination schedule
reconciliation. See README.md for the full context. The project was built by Ahmed Zayed,
an Egyptian physician, as a hackathon submission and as the foundation for a research thesis
at RWTH Aachen's Applied Health Informatics & Digital Medicine program.

---

## Model Defaults

- **Default model: `claude-sonnet-4-6`** — use this for all development and testing.
- **Opus 4.7 (`claude-opus-4-7`) is opt-in only.** Switch to it only when Ahmed explicitly
  requests it (e.g., "run the validation on Opus"). Never default to Opus.
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
├── web/          Next.js frontend (Day 3+)
├── data/         Vaccination schedule JSON files (Day 2+)
├── cards/        Synthetic test card images (Day 2+)
├── docs/         REFERENCES.md and methods documents
├── evaluation/   Evaluation harness (Day 4+)
```

---

## Day-by-Day Scope

Build one day at a time. Do not work ahead.

| Day | Scope |
|-----|-------|
| 1 | Foundation: monorepo, SDK wired ✓ |
| 2 | Custom tools, schedule data, end-to-end agent run |
| 3 | Next.js frontend, SSE streaming |
| 4 | Polish, flagship demo case, methods writeup |
| 5 | Demo video + submit |
