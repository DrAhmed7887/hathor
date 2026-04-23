# Deferred Doc Updates

Doc updates that cannot land ahead of their code. Each entry has a trigger — the
code commit that must land first — and an owner. When the trigger fires, update
the docs **in the same commit** as the code. Never doc-ahead-of-code.

---

## 1. `Recommendation.pre_hitl_snapshot` — SAFETY_LOOPS.md Phase E section

**Trigger:** the commit that creates `api/src/hathor/schemas/recommendation.py`
(Phase E schema scaffold). That commit must also update
`docs/SAFETY_LOOPS.md` → Phase E → "Recommendation schema" to describe the
`pre_hitl_snapshot: list[HITLCorrectionRecord]` field and how Phase E / the FHIR
Provenance builder consume it.

**Why deferred:** the schema itself is approved in `docs/schema-proposal.md` but
`SAFETY_LOOPS.md` currently only points at the proposal doc. When the concrete
schema lands, the safety-loops doc should reference the shipped module and
describe the Provenance round-trip in place.

**Scope of the update:** ~10 lines under "Recommendation schema" in the Phase E
section of `SAFETY_LOOPS.md`. Describe:
- what `pre_hitl_snapshot` contains (one `HITLCorrectionRecord` per corrected
  field on any source dose)
- how it round-trips into the FHIR Provenance resource
- that the snapshot is empty when no HITL corrections fired for the source doses

---

## Format for new entries

Each new entry must include:
- Trigger commit description (specific enough to spot in review).
- Why the doc can't land first.
- Scope of the update (file + section + ~line count).
