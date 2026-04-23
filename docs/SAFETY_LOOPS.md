# Safety Loops

Hathor's two mandatory gates. Encoded as a hard rule in `CLAUDE.md`; designed here.

The rationale: the agent is authorized to *reason* autonomously (no hardcoded pipeline),
but it is not authorized to *speak to the clinician without review*. Two deterministic
gates stand at the input and output boundaries:

- **Phase D** gates the path `card image → agent context` — per-**field** OCR confidence.
- **Phase E** gates the path `agent output → clinician UI / FHIR bundle` — per-recommendation DAK conformance.

Diagrammed:

```
card image
   │
   ▼
extract_vaccinations_from_card  ──► per-field {value, confidence, needs_review, reason}
   │
   ▼
┌──────────── PHASE D (per-field) ─────────┐
│ field confidence < 0.85 OR needs_review? │──► yes ──► HITL review UI
│                                          │                    │
│ else auto-commit                         │◄───────────────────┘
└──────────────┬───────────────────────────┘
               ▼
       agent reasoning
       (tools: get_schedule, validate_dose, compute_missing_doses, …)
               │
               ▼
       structured recommendations + narrative
               │
               ▼
┌──────────── PHASE E ────────────┐
│ for each recommendation:        │
│   rules_engine.validate()       │
│     pass  → include in output   │
│     warn  → include + warning   │
│     fail  → replace with        │
│            "requires physician  │
│            review" + override   │
│            affordance           │
└──────────────┬──────────────────┘
               ▼
   final_plan (markdown) + final_fhir (bundle) → clinician
```

---

## Phase D — Vision Safety Loop (per-field)

### Current state of the extraction tool

`api/src/hathor/tools/card_extraction.py` is **stubbed** as of Day 2: it returns
hardcoded test data with no confidence information at all. The new per-field
schema (`docs/schema-proposal.md` §1) is the target output contract. Migrating
the stub to emit that schema is a tool-interface change that requires separate
approval.

### Source of confidence — target schema

Each field Hathor cares about is emitted as:

```json
{
  "value": "2023-05-?0",
  "confidence": 0.62,
  "needs_review": true,
  "ambiguity_reason": "Day digit is smudged; could be 10 or 20"
}
```

Full extraction output is `CardExtractionOutput` (`api/src/hathor/schemas/extraction.py`)
— see `docs/schema-proposal.md` §1. Per-field, not per-row: a smudged date on an
otherwise legible row blocks only the date, not the row.

### Threshold

**0.85 per field.** Flat across all field types (resolved as Q1 in
`docs/dak-questions.md`). A field either passes the threshold and is
auto-committed, or routes to HITL review.

**Inclusivity convention (authoritative).** `confidence >= 0.85` passes;
`confidence < 0.85` routes to HITL. A field whose confidence is exactly `0.85`
is considered passing. The gate also routes any field with `needs_review=True`
regardless of the confidence score. Implementation:
`_needs_review(f) := f.needs_review OR f.confidence < 0.85`.

### Placement

Module: `api/src/hathor/safety/phase_d.py`.

Called at the server boundary *after* `extract_vaccinations_from_card` returns
and *before* the agent reasoning loop starts. If any field requires HITL, the
server pauses the stream, emits a `hitl_required` SSE event, waits for a
client-side correction POST, and resumes.

### Gate function

```python
def gate(extraction: CardExtractionOutput) -> PhaseDResult: ...
```

Iterates every field (card metadata + every dose field). Each field is
independently assessed. The result is:

- `auto_committed: CardExtractionOutput` — same shape; low-confidence fields set to `None`.
- `hitl_queue: list[HITLField]` — one entry per field that needs review, with a
  JSON-path (`field_path`) so the UI can locate it.

### Server integration sketch (not yet implemented)

```python
extraction = await extract_vaccinations_from_card(image)
phase_d_result = phase_d.gate(extraction)

if phase_d_result.requires_review:
    yield sse_event("hitl_required", phase_d_result.hitl_queue)
    corrections = await client.wait_for_corrections()
    confirmed = merge_corrections(phase_d_result.auto_committed, corrections)
else:
    confirmed = phase_d_result.auto_committed

# agent reasoning begins on confirmed only
```

### HITL UI contract (`web/`)

- Two-pane view: card image (left), extracted table (right).
- **Specific fields** with `needs_review == true` highlighted red (not whole rows).
- `ambiguity_reason` shown inline as a tooltip/sub-label on the highlighted field.
- Three clinician actions **per field**:
  1. **Edit** — correct the value and mark confirmed.
  2. **Keep** — accept the extracted value as-is.
  3. **Skip** — mark illegible; exclude from reconciliation.
- "Confirm all" button resubmits the corrected list.
- *Deferred:* **Escalate** action (post-hackathon backlog, per Ahmed).

Confidence for confirmed fields is rewritten to `1.0` (physician-verified); skipped
fields are excluded from the agent context and recorded in the FHIR Provenance
resource as "unreadable source field."

---

## Phase E — Reasoning Safety Loop (per-recommendation)

### What counts as a clinical recommendation

**Gated** (must pass `rules_engine.validate()`):

| Kind | Example |
| --- | --- |
| `due` | "Child is due for MMR dose 1 at 12 months" |
| `overdue` | "DTaP dose 3 is 4 months overdue" |
| `catchup_visit` | "Visit 1 (today): give DTaP, IPV, Hib, HepB, PCV, Rotavirus" |
| `dose_verdict` | "MMR given at 8 months — invalid (minimum age 9 months)" |
| `contra` | "Live vaccines deferred — child received IVIG 3 months ago" |

**Not gated** (narrative only):

- Card summary ("card shows 4 doses of DTaP-containing combos at 6w/10w/14w/6mo")
- Confidence annotations ("row 3's day digit is ambiguous — flagged for review")
- Educational explanations ("Egypt's EPI uses hexavalent at 2/4/6 months, which is why…")
- Paediatrician discussion flags ("please confirm Varicella natural infection history with family")

### Recommendation schema

See `docs/schema-proposal.md` §2. Includes a `reasoning` field so the HITL UI
can show agent reasoning alongside the rules-engine verdict (per Ahmed's review
requirement).

### Rules engine interface

Module: `api/src/hathor/rules/engine.py` (Phase B of `dak-mapping-plan.md`).

```python
def validate(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult: ...
```

Deterministic Python. No LLM calls. Each rule function cites its source DAK
`PlanDefinition` ID in a docstring.

Precedence: **egypt_rules > dak_rules > general_defaults** (resolved Q3).

### Placement

Module: `api/src/hathor/safety/phase_e.py`.

Called after the agent's final `emit_recommendations` tool call, before any SSE
`final_plan` or `final_fhir` event leaves the server. No code path from agent to
client bypasses Phase E.

### Gate function

```python
def gate(agent_recs: list[Recommendation], ctx: ClinicalContext) -> GatedOutput: ...
```

Three-way severity (resolved Q8):

- `pass` → recommendation reaches clinician. Annotated with its `dak_rule_id`.
- `warn` → recommendation reaches clinician **inline with the catch-up plan,
  marked with a yellow badge and a one-line explanation.** No separate
  advisories panel.
- `fail` → recommendation is dropped. Replaced with a "requires physician review"
  entry that carries the DAK rule that blocked it, the agent's original
  rationale, and the agent's full reasoning. The **override affordance** surfaces
  here.

### Override policy (HARD RULE)

Per `CLAUDE.md`: **the clinician always has final authority.** Every Phase E `fail`
can be overridden. Every override must capture a clinician reason and must be
logged to the FHIR Provenance resource with:

- DAK rule ID that blocked the recommendation
- Agent's original proposal (structured and rationale)
- Clinician's override reason
- Timestamp

Overridden recommendations enter the FHIR bundle with a Provenance reference
pointing to the override record. `ValidationResult.override_allowed` is typed as
`Literal[True]` — Pydantic itself forbids `False`. Changing this requires a
schema change, not a field change.

### Structured recommendations from the agent

The agent currently outputs a markdown `final_plan`. For Phase E to inspect it,
the agent must also emit a structured list of `Recommendation` objects.
**Approved addition:** one new tool `emit_recommendations` to the agent surface
(per Ahmed's review). See `docs/schema-proposal.md` §4 for the tool signature and
system-prompt implications.

---

## Invariants

1. **No field leaves Phase D to the agent without either passing the 0.85 threshold or being clinician-confirmed.** Per-field, not per-row.
2. **No recommendation leaves Phase E to the clinician without passing `rules_engine.validate()`.**
3. **Confidence scores propagate unchanged through the whole pipeline** — they appear in the final FHIR Provenance resource per field.
4. **The clinician always has final authority.** Every Phase E `fail` is overridable, with mandatory reason + Provenance log. `ValidationResult.override_allowed` is `Literal[True]` at the schema level — the type system forbids `False`.
5. **No PHI persists** — card images and extraction results are in-memory only; only the structured FHIR bundle persists (SQLite for demo). See forthcoming `SOVEREIGNTY.md`.

## Where this code will live

```
api/src/hathor/
├── schemas/
│   ├── __init__.py
│   ├── extraction.py     # CardExtractionOutput, FieldExtraction, ExtractedDose
│   └── recommendation.py # Recommendation, ValidationResult (for Phase E — pending)
├── safety/
│   ├── __init__.py
│   ├── phase_d.py        # vision gate — IMPLEMENTED
│   └── phase_e.py        # reasoning gate — PENDING Recommendation schema approval
└── rules/
    ├── __init__.py
    ├── engine.py         # validate(rec, ctx) → ValidationResult — PENDING
    ├── dak_tables.py     # DAK decision-logic spreadsheet parsed to dict — PENDING
    └── antigen_codes.py  # Hathor antigen → DAK ICD-11/SNOMED/LOINC — PENDING
```

## Relationship to the DAK rules engine (Phase B of `dak-mapping-plan.md`)

Phase E requires the rules engine. Build order:

1. Answer the clinical questions in `docs/dak-questions.md`. *Seven resolved; five
   deferred to `CLINICAL_DECISIONS.md` (pending).*
2. Build Phase D gate + extraction schema (this document). **In progress.**
3. Review `docs/schema-proposal.md` (Recommendation schema, `emit_recommendations` tool).
4. Build `api/src/hathor/rules/engine.py` + `dak_tables.py` — **scaffolding only**
   until `CLINICAL_DECISIONS.md` lands for Q2/Q4/Q5/Q6/Q11.
5. Add `emit_recommendations` tool + refit `agent_prompt.py`.
6. Build `phase_e.py` gate at the server boundary.
7. Build HITL UI in `web/`.
