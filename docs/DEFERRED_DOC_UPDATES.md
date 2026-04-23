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

## 2. Stateless resumable HITL session model — architecture notes

**Trigger:** post-hackathon hardening work. Specifically, the commit that
replaces `api/src/hathor/server_sessions.py` (in-memory `SessionStore` dict)
with a durable store (Redis / signed token / DB-backed).

**Why deferred:** the hackathon-grade server uses a per-process in-memory
dict keyed by UUID, with a 15-minute TTL and `asyncio.Event` wakeups on the
SSE connection. This is simple enough for a live demo and is marked with a
`# SOVEREIGNTY NOTE` at the store definition. It **does not** survive a
server restart mid-HITL or horizontal scaling. The design conversation in
Commit 5's scoping captured two replacement options:

- **Stateful Redis-backed session store** — replaces the in-memory dict
  1:1, keeps the stream-held SSE pattern. Trivial migration, but still
  stateful on the server side.
- **Stateless resumable token model** — SSE stream closes after
  `hitl_required`; the client re-opens a second stream at `/reconcile/resume`
  with a server-signed token carrying the session state. More
  REST-idiomatic, survives restarts, trivially horizontally scalable.

**Scope of the doc update:** when the replacement lands, update
`docs/SAFETY_LOOPS.md` → Phase D → "Server integration" to describe the
chosen durable path, and update `CLAUDE.md` if the deployment/runtime rule
changes. Remove or tighten the `# SOVEREIGNTY NOTE` in
`server_sessions.py` in the same commit.

---

## Format for new entries

Each new entry must include:
- Trigger commit description (specific enough to spot in review).
- Why the doc can't land first.
- Scope of the update (file + section + ~line count).
