# Deferred Doc Updates

Doc updates that cannot land ahead of their code. Each entry has a trigger — the
code commit that must land first — and an owner. When the trigger fires, update
the docs **in the same commit** as the code. Never doc-ahead-of-code.

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
