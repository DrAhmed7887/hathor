# SESSION HANDOFF — Post-Commit-6.1

A fresh Claude Code instance should read this cold before doing anything on
Hathor. Read CLAUDE.md first, then this document. This captures the verbal
decisions, pitfalls, and scoped next step from the session ending
2026-04-23. Last updated after Commit 6.1 landed.

---

## 1. Current commit state

### Build plan position
Commit 6.1 is **done**. Commit 7 is next — see §7 below.

### Commits shipped this session (reverse chronological)

| SHA | Type | Summary |
| --- | --- | --- |
| `51d2a8b` | ui | Commit 6.1 — nav link to card flow. Single file: `web/app/page.tsx`. `CARD FLOW →` link in home header pointing to `/reconcile-card`. |
| `3092efa` | ui | Commit 6 — HITL UI in `web/`. 4 new files + 2 card images + gitignore + deferred doc update. Smoke-tested end-to-end (25 tool calls, $0.91, full HITL round-trip verified). |
| `079fcd1` | docs | SESSION_HANDOFF.md (pre-Commit-6 prep) |
| `43c4f97` | server | `/reconcile/card` SSE endpoint + HITL corrections POST + session store + 27 tests. |
| `24c3c12` | agent | System prompt catch-up for per-field extraction schema + 9 tests. |
| `6f5c5c1` | tools | `card_extraction.py` STUB migrated to per-field schema. |
| `a9fad87` | safety | Phase D vision gate implementation + schemas/extraction.py + 8 tests. |
| `9178e51` | docs | Phase D/E safety loops as hard rules; SAFETY_LOOPS.md; dak-questions.md; schema-proposal.md. |

### Commit 6 — what shipped

**4 new files:**

| File | Purpose |
| --- | --- |
| `web/app/reconcile-card/page.tsx` | Card-first reconcile page. SSE stream to `/reconcile/card`. Handles all event types including `hitl_required`. Reasoning collapses with "Paused for review — N field(s) need input" + expandable chevron during HITL. Reasoning re-expands automatically after corrections confirmed. |
| `web/components/HITLPanel.tsx` | Two-pane HITL review. Left: card image via `next/image`. Right: field queue with FieldRow per item. Expiry countdown. "Confirm all" disabled until all fields resolved. POSTs to `resume_endpoint` from payload. |
| `web/components/FieldRow.tsx` | Per-field row. Red highlight, confidence %, ambiguity reason. Edit/Keep/Skip toggles. Inline input when Edit selected. |
| `web/lib/api.ts` | `postCorrections()` typed fetch wrapper. Returns `{ok:true}` or `{ok:false, status:400|404|410, detail}`. Also exports shared types: `HITLQueueItem`, `Correction`, `CorrectionAction`, `HITLRequiredPayload`. |

**2 new card images (checked in, not gitignored):**

| File | Purpose |
| --- | --- |
| `cards/phase_d_demo.jpg` + `web/public/card-images/phase_d_demo.jpg` | Synthetic NPHCDA-style Nigerian vaccination card. 4 doses: Hexyon ×3 + MMR ×1. Dose 3 date (`2024-12-1?`) visibly smudged — triggers Phase D HITL gate. |
| `cards/demo.jpg` + `web/public/card-images/demo.jpg` | Same card, dose 3 date clean (`2024-12-15`). Happy-path stub — no HITL triggered. |

**Note:** Card images live in two places. `cards/` is for server-side path validation (`image_path` field). `web/public/card-images/` is for Next.js static serving (left pane of HITLPanel). Both are identical copies.

**`.gitignore` change:** added `!/cards/demo.jpg` and `!/cards/phase_d_demo.jpg` exceptions.

**`docs/DEFERRED_DOC_UPDATES.md`:** §3 (nav link deferred item) was added and then removed in the same session — the nav link shipped as Commit 6.1 before the session closed, so §3 never reached origin.

### Push state
`origin/main` is at **`51d2a8b`** (2026-04-23). Commits 6 and 6.1 are both on origin.

### What's done vs what's left

**Done:**
- All Phase D machinery end-to-end: schema, gate, stub, agent-prompt awareness, SSE endpoint, HITL correction POST, session store with TTL, 27 server tests.
- Strategy and positioning docs (`who-dak-alignment.md`, `dak-mapping-plan.md`).
- DAK decision answers for 7/12 clinical questions.

**Next (Commit 7):** Phase E rules engine scaffold. See §7.

**Blocked on user:**
- `CLINICAL_DECISIONS.md` — physician-authored answers to 5 deferred DAK questions. Phase E rules engine scaffolding can proceed; rule bodies cannot.
- Phase 2 STIKO minimum rule-set conversation (user is bringing to strategist).

---

## 2. Architectural invariants not obvious from CLAUDE.md

These were established verbally during this session and are not yet all
written into CLAUDE.md. Treat them as load-bearing.

### 2.1 "Flag before exceeding 2 files" (CLAUDE.md rule) — how to apply
When a change would touch more than two files, add a dependency, modify the
system prompt, or change a tool interface: **describe the change in text
with an explicit file list, then wait for approval**. Do not pre-write code.
"Describe" means: list each file, what it does, and open design
questions. Example from this session: the Commit 5 proposal listed endpoint
shape, session correlation model, session store backing, TTL, SSE payload
shape — the user answered each before I touched code.

### 2.2 Commit grouping preference
Small commits, each independently revertable. **Docs before code** when the
docs capture an architectural decision; **docs with code** when the docs
describe a concrete schema or module that must exist. Never
doc-ahead-of-code for API shapes (see 2.5).

The user preferred this grouping pattern this session:
1. Docs that encode a decision
2. Schemas + core impl + tests (the "module" commit)
3. Wiring commits (tools, agent, server, UI) — one per layer
4. Each wiring commit includes the tests that cover it

If you're tempted to bundle "related" work, resist. Atomic is better.

### 2.3 Sovereignty-note convention
At any code location where a production deployment would swap to on-prem
infrastructure, OR where PHI touches storage, add an inline comment:

```python
# SOVEREIGNTY NOTE: <what production replaces and why>
```

Example: `api/src/hathor/server_sessions.py` top-of-module docstring. The
`SOVEREIGNTY.md` file was called out in Option B scope but has not yet
been written — that's a follow-up ticket, not in Commit 6.

### 2.4 Stub-ness must be loud
When code is stubbed, every visible surface says so — module docstring,
function docstrings, the tool description the agent sees, commit message.
No ambiguity. See `api/src/hathor/tools/card_extraction.py` for the pattern.

### 2.5 Don't update docs ahead of code
Never land a doc that describes a schema, module, or API that doesn't exist.
Track pending doc updates in `docs/DEFERRED_DOC_UPDATES.md` with a trigger
(the commit that should fire them) and scope (file + section + ~lines). The
update lands atomically with the triggering code commit.

### 2.6 Clinician Final Authority is a hard rule
`ValidationResult.override_allowed` is typed `Literal[True]` in
`docs/schema-proposal.md`. The schema itself forbids `False`. Every Phase E
`fail` is overridable with a mandatory clinician reason, logged to FHIR
Provenance. This is encoded in CLAUDE.md and SAFETY_LOOPS.md invariant #4.

### 2.7 Manual end-to-end smoke test before pushing behavior-visible changes
After commits that change agent-observable behavior (tool output shape,
system prompt, new endpoints), run the flow end-to-end against real Opus
4.7 before pushing. Budget ~$0.50–$1.00 per run, plan for two runs (happy
path + phase_d variant). The user insisted on this after noticing the
agent-prompt drift risk in Commit 3. "Unit tests pass but running system
is broken" is NOT allowed on `origin/main`.

For smoke tests: write a temporary script under `/tmp/`, run it, report
output, delete. Don't commit smoke scripts.

### 2.8 "Describe then ask" applies even when the user has said "proceed"
The user's in-principle approval is not a license to expand scope.
"Proceed with X" means X, not X plus adjacent cleanup. When in doubt,
describe the delta and ask.

### 2.9 CLINICAL_DECISIONS.md gated work
Five DAK questions are deferred to physician authorship: Q2
(component-antigen partial-satisfaction), Q4 (ACIP 4-day grace), Q5 (live
vaccine co-administration), Q6 (rotavirus age cutoffs), Q11
(contraindication source-of-truth conflicts). Until
`CLINICAL_DECISIONS.md` lands, the rules engine may be **scaffolded** (the
registry, the `validate()` signature, antigen-code plumbing) but rule
bodies for these five topics must not be implemented.

### 2.10 No new scripts/files without need
For test harnesses and smoke tests that won't be reused, use `/tmp/` temp
files and delete after. Don't add `api/scripts/` or similar unless the
script is a durable dev tool.

### 2.11 Per-field, not per-row — Phase D
Phase D gating is per-field, not per-row. A smudged date on an otherwise
legible row blocks only that date. Every `FieldExtraction` carries its own
confidence, `needs_review`, and `ambiguity_reason`. The current stub
produces this shape; the HITL queue carries `field_path` strings like
`extracted_doses[2].date_administered`.

### 2.12 Confidence propagation end-to-end
Confidence scores must NOT be silently dropped. They flow from
extraction → auto_committed → HITL corrections (set to 1.0 for
clinician-verified) → confirmed output → FHIR Provenance (when Phase C
lands). The agent prompt explicitly tells the agent to flag rather than
use low-confidence fields.

### 2.13 Path allowlist semantics
`_validate_image_path` in `server.py`: relative paths resolve from the
repo root (not from CARDS_DIR). So `"cards/foo.jpg"` lands inside the
allowlist and `"data/schedules/egypt.json"` lands outside. Any `..` in the
raw path is rejected regardless of where it resolves. INFO-level log on
every rejection.

---

## 3. Open decisions awaiting the user

### 3.1 CLINICAL_DECISIONS.md (BLOCKER for Phase E rules engine)
Five questions pending physician-authored answers. See
`docs/dak-questions.md` for the full text. Summary:
- Q2: Component-antigen partial-satisfaction (MMR rollup semantics when only Measles monovalent was given)
- Q4: ACIP 4-day grace period applicability
- Q5: Live vaccine co-administration thresholds and exceptions
- Q6: Rotavirus age cutoffs (105/240 days vs DAK)
- Q11: Contraindication source-of-truth conflicts (Egypt MoH vs DAK)

### 3.2 Phase 2 STIKO minimum rule set
User is bringing to strategist (outside Claude Code) and will come back
with a scoped minimum set. Not a blocker for Phase 1.

### 3.3 Nigeria-pitch grounding facts
Positioning for WHO Innovation Hub / Gavi audiences. Captured in
`docs/who-dak-alignment.md` (Narrative & Positioning section) and in the
user memory at
`~/.claude/projects/-Users-ahmedzayed/memory/hathor_positioning.md`.
Load that memory when writing pitch-facing copy.

### 3.4 Push decision for Commit 5
`43c4f97` is local as of handoff. User may or may not push before
clearing. If origin is at `24c3c12` when you start: do not push
unilaterally. Ask first.

### 3.5 Phase E schema approval
`docs/schema-proposal.md` carries the `Recommendation`, `ValidationResult`,
and `emit_recommendations` tool design. The user reviewed and approved
everything in §2–§4 (and §1 is already implemented). No open design
questions remain — but implementation is blocked on
`CLINICAL_DECISIONS.md`.

---

## 4. Known pitfalls — do not re-discover

### 4.1 Agent-prompt drift (discovered pre-Commit 4)
Migrated the extraction tool's output schema in Commit 3 (per-field
confidence) but did not update the agent's system prompt. Unit tests
passed because they tested the new schema in isolation. **The running
agent, however, was still instructed to expect the old bare-scalar
shape.** End-to-end would have produced incoherent output. User caught
this ("unit tests pass but running system is broken is not a state I want
on origin/main") and the fix became Commit 4. Lesson: when you change a
tool's output shape, the agent prompt is part of the contract.

### 4.2 FastAPI TestClient deadlocks on held SSE streams
TestClient runs the ASGI app on a single anyio portal. A request that
holds a response mid-stream (awaiting an `asyncio.Event`) cannot share
the portal with a concurrent request. Symptoms: second request times
out, first never sees its own yields. Fix: drive the generator directly
in tests, OR use `httpx.AsyncClient` with `ASGITransport` and
`asyncio.gather` for concurrent operations.

### 4.3 httpx ASGITransport buffers intermediate SSE chunks
ASGITransport does NOT flush intermediate response chunks until the ASGI
generator completes. Happy paths work because the generator finishes.
Held paths (Phase D `hitl_required` while waiting for corrections) do
not deliver the intermediate yield to the client. Fix: test the SSE
event stream by driving the generator function directly
(`_card_reconciliation_stream`) — bypass httpx/ASGITransport for
streaming scenarios that pause mid-stream. Use `httpx.AsyncClient` only
for the concurrent correction POST in roundtrip tests.

### 4.4 `@tool`-wrapped functions aren't directly callable
`claude_agent_sdk`'s `@tool` decorator wraps the function in an
`SdkMcpTool` dataclass (not callable). To invoke the underlying coroutine
in tests, use `my_tool.handler(args)` instead of `my_tool(args)`. Found
while writing the `test_agent_schema.py` round-trip tests.

### 4.5 Pydantic validation returns 422, but the user wanted 400
FastAPI default: body-shape errors → 422 Unprocessable Entity. The user
specified 400 for semantic malformed-correction cases (unknown
field_path, missing corrections, action=edit without corrected_value).
Fix: manual validation inside the endpoint with explicit
`HTTPException(400, ...)`. Pydantic shape errors (wrong types) still fall
through as 422 — acceptable because those are pre-POST client bugs.

### 4.6 Initial `_validate_image_path` resolved from CARDS_DIR
First implementation treated relative paths as relative to
`CARDS_DIR` — so `"data/schedules/egypt.json"` resolved to
`cards/data/schedules/egypt.json` (still inside CARDS_DIR) and was
erroneously accepted. Fix: resolve relative paths from **REPO_ROOT**,
then check the resolved path is inside CARDS_DIR. The path-traversal
rejection (checking for `..` in raw parts) is an independent belt-and-
braces check.

### 4.7 Stub variant path-sniff survives absolute-path conversion
`card_extraction.build_stub_output` picks the demo variant based on
substring match for "phase_d" or "hitl_demo" in the image_path. After
path validation resolves to an absolute path, the absolute string still
contains the substring, so variant selection still works. If you change
the path-validation behavior to normalize the path differently, verify
this still holds.

### 4.8 `_stream_agent` monkey-patching technique
Tests replace the agent call via module-level attribute assignment:
```python
server_mod._stream_agent = _fake_stream_agent
```
in `setUpModule`, with `importlib.reload(server_mod)` in
`tearDownModule` to restore. Works because Python resolves module
globals at call time. If you refactor `_stream_agent` to be imported
into a namespace elsewhere, update the patch target.

### 4.9 SSE event parsing edge cases
`_parse_sse_event_block` splits on `:` with `maxsplit=1` so event names
and data payloads containing `:` survive. If you extend the event
format, preserve that. Each event ends with a blank line
(`\n\n`) — consumer code relies on the empty line to finalize the block.

---

## 5. Verifying repo state

### 5.1 Run this first
From `api/`:
```bash
uv run python -m unittest discover tests
```
Expected output final lines:
```
----------------------------------------------------------------------
Ran 53 tests in <~0.1>s

OK
```
**53/53 green.** If not, something drifted after handoff.

### 5.2 Test file inventory

| File | Count | Covers |
| --- | --- | --- |
| `api/tests/test_phase_d.py` | 8 | Phase D gate: passthrough, routing, flag priority, per-field-not-per-row, metadata gating, threshold boundary, None preservation, method preservation |
| `api/tests/test_card_extraction_stub.py` | 9 | Stub variants: happy path confidences, gate passthrough, method label, phase_d path sniff (3 cases), one-low-confidence-date, clean-field preservation |
| `api/tests/test_agent_schema.py` | 9 | Prompt documents schema (5 assertions), tool output round-trip (both variants), agent-translation simulation (2 variants) |
| `api/tests/test_server_hitl.py` | 27 | Path validation (6), SessionStore (5), `_apply_corrections` (3), endpoint path rejection (2), HITL corrections endpoint (8), SSE integration (3) |

### 5.3 Repo layout

```
hathor/
├── CLAUDE.md                         # read first
├── README.md
├── api/
│   ├── pyproject.toml
│   ├── src/hathor/
│   │   ├── agent_prompt.py           # SYSTEM_PROMPT
│   │   ├── server.py                 # FastAPI app — 3 endpoints
│   │   ├── server_sessions.py        # HITL session store (SOVEREIGNTY NOTE)
│   │   ├── run_agent.py              # CLI runner
│   │   ├── flagship_scenario.py      # Nigeria→Egypt demo data
│   │   ├── schemas/extraction.py     # CardExtractionOutput + nested types
│   │   ├── safety/phase_d.py         # per-field gate
│   │   └── tools/
│   │       ├── __init__.py           # HATHOR_TOOLS registry
│   │       ├── card_extraction.py    # STUB for Phase D testing
│   │       ├── age_math.py
│   │       ├── catchup.py
│   │       ├── coverage.py
│   │       ├── dose_validation.py
│   │       ├── intervals.py
│   │       ├── schedule.py
│   │       └── vaccine_lookup.py
│   └── tests/                        # unittest suite (no pytest dep)
├── data/schedules/                   # egypt, nigeria, who, germany JSONs
├── cards/                            # gitignored (card images)
├── docs/
│   ├── SAFETY_LOOPS.md               # Phase D+E design
│   ├── dak-mapping-plan.md           # 4-phase DAK plan
│   ├── dak-questions.md              # 12 Qs (7 resolved, 5 deferred)
│   ├── DEFERRED_DOC_UPDATES.md       # doc-ahead-of-code tracker
│   ├── schema-proposal.md            # Phase E schemas
│   ├── who-dak-alignment.md          # positioning
│   ├── ocr-sources.md                # LMIC dataset research
│   ├── REFERENCES.md                 # existing bibliography
│   └── SESSION_HANDOFF.md            # THIS FILE
├── web/                              # Next.js frontend (Day 3/4 work)
├── evaluation/                       # evaluation logs + harness
└── scratch/, internal/               # gitignored
```

### 5.4 Entry points

| Command | From | Purpose | Needs |
| --- | --- | --- | --- |
| `uv run python -m unittest discover tests` | `api/` | Run full test suite | nothing |
| `uv run python -m hathor.run_agent --flagship` | `api/` | Run flagship Nigeria→Egypt scenario against real Opus 4.7 | `ANTHROPIC_API_KEY` |
| `uv run uvicorn hathor.server:app --reload` | `api/` | Start the FastAPI server | `ANTHROPIC_API_KEY` for agent calls |
| `curl -N -H 'Content-Type: application/json' -d '{"image_path":"cards/phase_d_demo.jpg","child_dob":"2024-06-15","target_country":"Egypt"}' http://localhost:8000/reconcile/card` | anywhere | Exercise the new card-reconcile endpoint | server running |

### 5.5 Endpoints on the server

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/reconcile-stream` | Original endpoint — client provides structured `given_doses`, no extraction. Unchanged. |
| POST | `/reconcile/card` | Card-first: extract → Phase D → (HITL) → agent. SSE stream. |
| POST | `/reconcile/hitl/{session_id}/corrections` | Submit HITL corrections; wakes the paused SSE stream. |
| GET | `/health` | Liveness probe. |

---

## 6. Commit 6 — HITL UI in `web/` — **DONE**

Shipped. Files listed in §1. Smoke-tested end-to-end on 2026-04-23.

### 6.1 Verified smoke test (2026-04-23)

Commands used:
```bash
# Terminal 1 — API server
cd api && uv run uvicorn hathor.server:app --port 8000

# Terminal 2 — Web dev server
cd web && npm run dev
```

Steps run and verified:

| Step | Result |
| --- | --- |
| Open `http://localhost:3000/reconcile-card` | Page loads; form shows `cards/phase_d_demo.jpg` pre-filled |
| Click "Reconcile →" | SSE stream opens; status shows "Starting up" |
| `hitl_required` event arrives | Reasoning bar collapses: "PAUSED FOR REVIEW — 1 FIELD NEED INPUT ▼"; HITL panel appears below |
| Click ▼ chevron on collapsed bar | Reasoning re-expands mid-review (trust lever confirmed) |
| Left pane of HITL panel | Card image (`phase_d_demo.jpg`) renders; dose 3 date visibly smudged |
| Right pane — FieldRow | "DOSE 2 · DATE_ADMINISTERED · 62% confidence" in red; ambiguity reason shown; EDIT / KEEP / SKIP buttons present |
| Click "Edit", type `2024-12-15` | Inline input opens; "CONFIRM ALL →" transitions from stone to copper |
| Click "CONFIRM ALL →" | POST to `/reconcile/hitl/{id}/corrections` → 200; HITL panel closes; reasoning re-expands; SSE resumes |
| Agent runs | 25 tool calls; parallel compute_age, validate_dose, build_catchup |
| `final_plan` event | Reasoning collapses; "RECONCILIATION REPORT · Catch-up plan" renders |
| Footer stats | `25 tool calls · 22K input · 11,614 output tokens · $0.9151 · claude-opus-4-7` |

**All 7 smoke-test steps from the original design passed.**

### 6.2 Known limitation: mobile layout

At viewport < ~768px the two-pane HITLPanel grid overflows horizontally.
Mobile optimization is explicitly out of scope for Commit 6 (see original §6.8).
Track as a post-hackathon polish item.

### 6.3 Card images — two-copy design

Card images live in two places intentionally:

- `cards/{demo,phase_d_demo}.jpg` — server-side (path-validated by `_validate_image_path`)
- `web/public/card-images/{demo,phase_d_demo}.jpg` — client-side (Next.js static serving at `/card-images/...`)

These are identical copies. If the card images are regenerated or replaced, update both locations.

---

## 7. Commit 7 — next steps

### 7.1 Shipped deferred items

| Item | SHA | Notes |
| --- | --- | --- |
| Nav link from `/` to `/reconcile-card` | `51d2a8b` | **DONE.** Shipped as Commit 6.1. `DEFERRED_DOC_UPDATES.md §3` closed. |

### 7.2 Phase E scaffold — Commit 7 target

Phase E rules engine **scaffolding** can proceed without `CLINICAL_DECISIONS.md`. The schema is fully approved in `docs/schema-proposal.md`. Scaffolding scope:

- `api/src/hathor/schemas/recommendation.py` — `Recommendation`, `ValidationResult`, `HITLCorrectionRecord` Pydantic models (triggers deferred doc update #1 in `DEFERRED_DOC_UPDATES.md`)
- `api/src/hathor/safety/phase_e.py` — `validate()` entry point, rule registry, antigen-code plumbing; rule stubs for Q2/Q4/Q5/Q6/Q11 (no bodies yet)
- `api/src/hathor/tools/emit_recommendations.py` — `@tool` that wraps `phase_e.validate()`, returns `ValidationResult` list
- Agent system prompt update for Phase E awareness
- Tests

Rule bodies for Q2/Q4/Q5/Q6/Q11 cannot be implemented until `CLINICAL_DECISIONS.md` lands.

### 7.3 Blocked work (awaiting Ahmed)

| Item | Blocker |
| --- | --- |
| Rule bodies for Q2, Q4, Q5, Q6, Q11 in `phase_e.py` | `CLINICAL_DECISIONS.md` — 5 physician-authored answers. |
| Phase 2 STIKO minimum rule set | User bringing to strategist. Not a Phase 1 blocker. |

---

## 7. Things I wish I'd known at the start of this session

1. **`extract_vaccinations_from_card` has been stubbed since Day 2.**
   No real OCR yet. `docs/ocr-sources.md` describes datasets for when
   real vision lands; it was aspirational research, not a schema
   reference. If I'd checked the tool file first, I'd have written
   `SAFETY_LOOPS.md` with the understanding that the schema was a new
   design, not a pre-existing contract.

2. **The flagship scenario doesn't invoke `extract_vaccinations_from_card`.**
   `flagship_scenario.py` passes doses as pre-structured text in the
   prompt. So `run_agent.py --flagship` does not exercise the extraction
   tool at all. To smoke-test extraction end-to-end, you need a custom
   prompt that explicitly instructs the agent to call the tool with a
   specific `image_path`. I wrote that as a `/tmp/hathor_smoke.py`
   script for Commit 4 and deleted it after.

3. **FastAPI TestClient + held SSE = deadlock.** Skip straight to
   `httpx.AsyncClient` OR direct generator iteration for any test that
   needs to observe intermediate SSE events on a stream that pauses. I
   burned a debug cycle learning this.

4. **`@tool`-wrapped coroutines: use `.handler(args)`.** Not `tool(args)`.

5. **Commits are smaller than you think.** The user wanted one
   architectural concern per commit, independently revertable. My
   instinct was to bundle related changes for cohesion. Wrong cadence
   for this project.

6. **"Proceed" ≠ scope up.** When the user approves a step, execute
   exactly that step and stop. Don't opportunistically bundle adjacent
   cleanup. Ask first.

7. **The user's review is architectural, not just code-level.** They
   catch drift at the contract level (e.g., "unit tests pass but
   running system is broken"). Bring the whole stack into the review
   frame — prompt, tool shape, endpoint, UI — not just the diff.

8. **Memory is worth loading.** The `hathor_positioning.md` memory
   entry captures the WHO/Gavi framing and the "reasoning vs.
   extraction" differentiator. Load it when writing any pitch-facing
   copy or commit message narrative. It's not automatically loaded —
   `MEMORY.md` is the index; the body files are fetched on demand.

9. **CLAUDE.md "default answer is no" is the strongest rule.** It
   means: don't add what wasn't asked for. Not "make small changes
   reluctantly." The ask-first threshold is lower than the two-file
   threshold.

10. **The user pays for smoke tests.** Opus 4.7 at current pricing
    runs ~$0.50–1.00 per 30–60s agent run. Two runs per behavior-visible
    commit is expected. Don't proliferate runs; one happy-path + one
    edge-case is the cadence.

---

*Written 2026-04-23 by Claude Opus 4.7. Commit 6 starts here.*
