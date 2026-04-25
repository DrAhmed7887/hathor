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

**Phase 2 (post-hackathon):** Africa → Europe reconciliation. Phase 2 schedule and tool rules have been removed from the Phase 1 branch to prevent prompt drift and agent confusion.

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

## Architectural Rule: Two Safety Loops

The no-hardcoded-pipeline rule governs **agent reasoning**. It does not apply to the
**input and output boundaries** of the system. Those boundaries have two mandatory gates.
See `docs/SAFETY_LOOPS.md` for the full design.

**Phase D — Vision Safety Loop (per-field).** If any field extracted from a vaccination
card has confidence `< 0.85`, that field must not be auto-committed. It routes to the
HITL review UI where the clinician confirms or corrects it. Per-field, not per-document.
Confidence scores must propagate end-to-end; do not silently drop them.

**Phase E — Reasoning Safety Loop (per-recommendation).** Every clinical recommendation
in agent output must pass `rules_engine.validate()` before reaching the UI or the FHIR
bundle. The agent reasons freely; the output layer is gated. The rules engine is
deterministic Python derived from the WHO DAK — it is the ground truth for
*correctness*, while the agent is the ground truth for *reasoning and explanation*.

A "clinical recommendation" is anything actionable about the child's care (dose due,
dose overdue, catch-up visit, dose-validity verdict, contraindication flag). Narrative
and summary text is not gated.

**Clinician final authority.** The clinician can override any Phase E `fail` verdict.
Every override must capture a reason from the clinician and must be logged to the
FHIR Provenance resource with the DAK rule ID, the agent's original proposal, the
override reason, and a timestamp. The rules engine rejects; the clinician decides.

Neither gate is optional. Code paths that bypass them are a bug.

The rules engine is exposed over HTTP via `POST /validate-schedule` on the FastAPI app in `api/src/hathor/server.py` (thin wrapper, no engine logic — delegates to `hathor.tools.dose_validation.validate_dose`).

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

---

## Next 16 patterns that differ from Next 14 — relevant to HATHOR build

`web/` runs on Next.js 16.2.4 + React 19 + Tailwind 4. Per `web/AGENTS.md`, always
consult `web/node_modules/next/dist/docs/` before writing App Router code — the
bundled docs are version-matched and authoritative over any training data.

Deltas that will bite if you write Next 14 code by habit:

- **Async request APIs (breaking).** `params`, `searchParams`, `cookies()`,
  `headers()`, and `draftMode()` are all Promises. In route handlers and pages:
  `const { id } = await params`. Synchronous access is gone in Next 16.
- **Global route type helpers.** `RouteContext<'/users/[id]'>`,
  `PageProps<'/blog/[slug]'>`, and `LayoutProps<'/blog'>` are globally
  available (generated by `next dev` / `next build` / `next typegen`). Do not
  import them. Use them for type-safe `await params` / `await searchParams`.
- **Turbopack is default.** `next dev` and `next build` use Turbopack with no
  flag. If a webpack config is detected, build fails unless you pass `--webpack`
  or migrate. HATHOR has no webpack config, so this is free.
- **Route handlers = Web Request / Response.** SSE endpoints return a `Response`
  with `text/event-stream` body wrapping a `ReadableStream`. No `runtime = 'edge'`
  — Node runtime handles streaming fine, and Edge breaks Cache Components.
- **`export const maxDuration = N`** at the route-segment level to raise the
  default timeout on long-running handlers. Required for `/api/chat` (SSE
  intake, ~30s) and `/api/parse-card` (vision call, up to ~15s).
- **`unstable_instant` for nav smoothness.** When Cache Components is enabled,
  `export const unstable_instant = { prefetch: 'static' }` on a route validates
  the Suspense structure and gives instant client-side navigations. Suspense
  alone is not enough.
- **AGENTS.md convention.** Next 16 ships docs inside `node_modules/next/dist/docs/`
  and expects AGENTS.md to point agents there. `web/AGENTS.md` already does this;
  do not delete it.

Things that are stable and you can still rely on:

- App Router layout: `app/<route>/page.tsx`, `app/<route>/route.ts`.
- `'use client'` / `'use server'` directives (unchanged semantics).
- `next/font`, `next/image`, `next/link` APIs (unchanged at the call site).
- shadcn/ui and Tailwind class conventions (the Pharos design tokens in
  `app/page.tsx` are the reference for clinical-surface styling).
