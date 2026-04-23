# Schema Proposal — Phase D & Phase E Data Models

Pydantic/dataclass schemas proposed for the Phase D vision gate and the Phase E
reasoning gate. **For Ahmed's review before Phase E implementation begins.**

Phase D schemas (§1) are being implemented now alongside the gate function, as
approved. Phase E schemas (§2–§4) are design-only until you approve.

---

## 1. CardExtractionOutput — Phase D input

Current stub (`api/src/hathor/tools/card_extraction.py`) emits no confidence info.
This is the new target shape; per-field confidence, per your Q1 decision.

```python
# api/src/hathor/schemas/extraction.py

from pydantic import BaseModel, Field

class FieldExtraction(BaseModel):
    value: str | None                     # None when illegible
    confidence: float = Field(ge=0.0, le=1.0)
    needs_review: bool = False
    ambiguity_reason: str | None = None   # required when needs_review=True

class ExtractedDose(BaseModel):
    transcribed_antigen: FieldExtraction | None = None
    date_administered: FieldExtraction | None = None
    lot_number: FieldExtraction | None = None
    provider_signature: FieldExtraction | None = None
    dose_number_on_card: FieldExtraction | None = None

class CardMetadata(BaseModel):
    detected_language: FieldExtraction | None = None
    overall_legibility: FieldExtraction | None = None
    patient_dob: FieldExtraction | None = None

class CardExtractionOutput(BaseModel):
    card_metadata: CardMetadata
    extracted_doses: list[ExtractedDose]
    extraction_method: str
```

**Why everything is `Optional`.** A blurry card may legitimately yield zero
legible fields. `None` means "not extracted or routed to HITL." The HITL queue
distinguishes the two cases.

**Migration path** (each step requires separate approval):
1. Update `card_extraction.py` stub to emit this schema (all confidences = 1.0 in
   happy-path stub; add a second stub variant with one low-confidence date for
   the Phase D demo scenario).
2. Update `_build_prompt` in `server.py` to consume the new shape.
3. Keep `DoseRecord` in `ReconcileRequest` as the "confirmed dose post-HITL"
   variant — no change needed.

---

## 2. Recommendation — Phase E input

Produced by the agent via a new `emit_recommendations` tool call. Includes a
`reasoning` field per your review note (HITL UI shows agent reasoning alongside
rules-engine verdict).

```python
# api/src/hathor/schemas/recommendation.py (proposed)

from datetime import date
from typing import Literal
from pydantic import BaseModel, Field

RecommendationKind = Literal[
    "due",           # Child is due for antigen X
    "overdue",       # Child is overdue for antigen Y
    "catchup_visit", # Visit plan entry
    "dose_verdict",  # A given dose is valid / invalid / marginal
    "contra",        # Contraindication flag
]

class HITLCorrectionRecord(BaseModel):
    """One clinician correction that affected a source dose for a recommendation.
    Captured for FHIR Provenance audit."""
    field_path: str                     # e.g. "extracted_doses[2].date_administered"
    pre_hitl_value: str | None
    pre_hitl_confidence: float
    ambiguity_reason: str | None
    post_hitl_value: str | None
    clinician_action: Literal["edit", "keep", "skip"]

class Recommendation(BaseModel):
    kind: RecommendationKind
    antigen: str                        # canonical Hathor antigen; maps to DAK
    dose_number: int | None = None
    target_date: date | None = None
    agent_rationale: str                # one-line summary the agent would say
    reasoning: str                      # fuller agent reasoning (shown in HITL UI)
    agent_confidence: float = Field(ge=0.0, le=1.0)
    source_dose_indices: list[int] = [] # indices into POST-HITL confirmed doses
    pre_hitl_snapshot: list[HITLCorrectionRecord] = []  # audit trail for Provenance
```

`source_dose_indices` points into the **post-HITL confirmed dose list** — that is
what the rules engine reasons from. `pre_hitl_snapshot` preserves the correction
delta for each source dose so the FHIR Provenance resource can reconstruct what
the extractor saw, what the clinician changed, and why.

---

## 3. ValidationResult — Phase E output (per recommendation)

```python
Severity = Literal["pass", "warn", "fail"]

class ValidationResult(BaseModel):
    severity: Severity
    dak_rule_id: str | None             # e.g. "IMMZ.D5.DT.MeaslesCatchup"
    reason: str                         # why pass/warn/fail
    egypt_moh_source: str | None = None # cite when Egypt-specific rule fires
    override_allowed: Literal[True] = True  # HARD RULE, enforced at type level
```

Severity mapping per your Q8 decision: `pass` and `warn` forward to clinician;
`fail` blocks and triggers override flow.

**`override_allowed` is typed as `Literal[True]`** so Pydantic itself forbids
`False`. Changing it requires a schema change, not a field change. This encodes
the clinician-final-authority hard rule at the type level.

---

## 4. `emit_recommendations` tool

New tool on the agent surface. The agent calls it **exactly once**, at the end of
reasoning, to hand its structured recommendations to Phase E.

```python
# api/src/hathor/tools/emit_recommendations.py (proposed)

@tool(
    "emit_recommendations",
    "Submit the final structured clinical recommendations. Call this EXACTLY ONCE "
    "at the end of your reasoning. Every 'due', 'overdue', 'catchup_visit', "
    "'dose_verdict', or 'contra' claim you want to make to the clinician must "
    "appear in this call. Do not make clinical claims in free-text that are not "
    "also in this list. Free narrative (summaries, educational notes, uncertainty "
    "annotations) goes in your text response, not here.",
    {"recommendations": list[dict]},
)
async def emit_recommendations(args: dict) -> dict:
    # validates against Recommendation schema, hands off to Phase E gate
    ...
```

**System-prompt implication** (`agent_prompt.py`): new section instructing the
agent to call `emit_recommendations` at end of reasoning. This is a
system-prompt change — requires separate approval per `CLAUDE.md`.

---

## Resolved decisions

1. **`source_dose_indices` target** → **post-HITL confirmed dose list.** The
   rules engine reasons from verified data. Correction history is preserved on
   the `Recommendation` itself via `pre_hitl_snapshot` (added to the schema
   above) so the UI and the FHIR Provenance resource can reconstruct what the
   extractor saw and what the clinician changed.
2. **UI placement of `warn` recommendations** → **inline with the recommendation,
   yellow badge, one-line explanation.** No separate advisories panel.
3. **`override_allowed` invariant** → **schema-level enforcement via
   `Literal[True]`.** Setting it to `False` requires a schema change, not a field
   change. Documented as invariant #4 in `SAFETY_LOOPS.md`.
4. **One `emit_recommendations` call or many** → **exactly once at end of
   reasoning, full list.** Phase E needs the full recommendation set to validate
   cross-recommendation rules.

---

## What is being implemented this turn

- `api/src/hathor/schemas/extraction.py` — FieldExtraction, ExtractedDose, CardMetadata, CardExtractionOutput
- `api/src/hathor/safety/__init__.py`
- `api/src/hathor/safety/phase_d.py` — `gate()` function
- `api/tests/test_phase_d.py` — stdlib `unittest` test suite (no new deps)

## What is NOT being implemented this turn (pending your review)

- Migration of `card_extraction.py` stub to new schema
- Server wiring (SSE `hitl_required` event, HITL correction POST endpoint)
- `agent_prompt.py` instructions for low-confidence field handling
- `Recommendation` / `ValidationResult` schemas (this doc §2–§3)
- `emit_recommendations` tool (this doc §4)
- Phase E gate (`phase_e.py`)
- Rules engine scaffold (`rules/engine.py`)
- HITL UI (`web/`)
