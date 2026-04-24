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

## 3. Demo-clinician placeholder — production authentication review

**Trigger:** the commit that introduces real clinician authentication on the
server (the first endpoint that actually verifies a Practitioner identity,
likely via OAuth2 / SMART-on-FHIR or an institutional SSO). Before that
commit lands, the demo uses a hardcoded `"demo-clinician"` string in three
call sites.

**Why deferred:** the Commit 8 Phase E override surface needed an identity
to attribute overrides to, but the server has no authentication layer yet.
Rather than stub out a half-auth system, the identity is a literal
placeholder flagged at each call site. A real implementation will:
- Replace the hardcoded string with the authenticated Practitioner's
  canonical reference (FHIR `Reference(Practitioner/{id})` or
  `Reference(PractitionerRole/{id})`).
- Replace `agent[0].who.display` with `agent[0].who.reference` in the
  Provenance emitter, optionally keeping `display` as a human label.
- Reject override submissions from unauthenticated sessions at the
  endpoint level.

**Scope of the doc update:** when the replacement lands, the following
specific sites must be reviewed and updated in the same commit:

- `api/src/hathor/server_sessions.py` — `ReconcileSession.clinician_id`
  field and its inline `NOTE:` comment in the dataclass. The
  `ReconcileSessionStore.create()` default parameter must be removed.
- `api/src/hathor/fhir/provenance.py` — the `agent[0].who` block in
  `_build_provenance()` and the inline `DEMO-CLINICIAN PLACEHOLDER` comment
  above it. Migrate from `{"display": ...}` to
  `{"reference": "Practitioner/{id}", "display": ...}`.
- `api/src/hathor/server.py` — the `RECONCILE_SESSIONS.create(...)` call
  inside `_stream_agent()` where the `clinician_id` is omitted (currently
  falls back to the store's default). Pass the authenticated identity
  explicitly.
- `CLAUDE.md` — if the authentication posture becomes a durable project
  rule, add a section. Otherwise update only `docs/SAFETY_LOOPS.md` →
  Phase E → "Clinician final authority" to describe the real identity
  flow.

---

## Format for new entries

Each new entry must include:
- Trigger commit description (specific enough to spot in review).
- Why the doc can't land first.
- Scope of the update (file + section + ~line count).
