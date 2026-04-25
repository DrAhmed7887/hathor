# Hathor — HIPAA & PII Compliance Assessment

> **Status:** Phase 1 prototype. Hathor is currently a research demo, **not a HIPAA-compliant medical device.** This document is the gap analysis and remediation roadmap so the project can pilot with real PHI in a defined, auditable environment when the time comes.
>
> **Posture:** Treat every vaccination card image, child DOB, and extracted dose row as PHI. Even synthetic fixtures are handled as if they were real — that is the only honest dev habit.

---

## Quick verdict

Hathor's *clinical* architecture is sound:

- AMBER vision-confidence gate (`api/src/hathor/safety/phase_d.py`) — fields with confidence < 0.85 cannot auto-commit.
- RED rules-engine gate (`api/src/hathor/safety/phase_e.py`) — every recommendation re-validated against deterministic WHO-DAK rules before reaching FHIR or the clinician.
- Clinician-in-the-loop with override logging — every override writes a FHIR R4 Provenance record (`api/src/hathor/fhir/provenance.py`).

The *governance* posture is not yet HIPAA-eligible. The two largest blockers are operational, not architectural:

1. **No Business Associate Agreement (BAA) with Anthropic.** Every vision call and every agent reasoning step transmits PHI to a third party. Without a BAA, that transmission alone is a HIPAA violation.
2. **No authentication.** The FastAPI server and the Next.js routes have no identity binding — `clinician_id` is hardcoded to `"demo-clinician"` in `api/src/hathor/server_sessions.py:150`. Any HTTP client can submit a child's card and receive a reconciliation plan.

The remaining gaps (PHI in logs, in-memory sessions, no rate limiting, no deletion policy, plain-file provenance log) follow from those two and the hackathon-prototype scope.

---

## What's already in place (preserve these)

| Control | Where | Status |
|---|---|---|
| Per-field confidence gate (Phase D / AMBER) | `api/src/hathor/safety/phase_d.py` | Strong |
| Deterministic rules engine (Phase E / RED) | `api/src/hathor/safety/phase_e.py` | Strong |
| Override audit trail (FHIR Provenance) | `api/src/hathor/fhir/provenance.py` | Storage backend needs hardening, but the schema is right |
| Image-path allowlist (no traversal) | `api/src/hathor/server.py:_validate_image_path` | Good |
| Image-size limit on inline vision (5 MB) | `web/app/api/parse-card/route.ts:69` | Good |
| Image MIME whitelist | `web/app/api/parse-card/route.ts:362-373` | Good |
| Real card images gitignored | `.gitignore:58-80` (with explicit `cards/private/` defence-in-depth) | Good |
| `evaluation/provenance_log.jsonl` gitignored | `.gitignore:50` | Good |
| Forced tool-call structured output (no free-form JSON) | `web/app/api/parse-card/route.ts:436` | Good |
| Honest disclaimers ("research, not a medical device") | `README.md`, `CLAUDE.md` | Good |

---

## Findings — by severity

### CRITICAL (would cause a breach if real PHI were processed today)

1. **No BAA with Anthropic.**
   - Vision OCR (`web/app/api/parse-card/route.ts:421`), agent reasoning (`api/src/hathor/server.py:_stream_agent`), chat intake (`web/app/api/chat/route.ts:105`), and Haiku antigen normalization (`web/lib/antigen-normalizer.ts`) all send card image bytes, child DOB, and vaccine details to the Anthropic API.
   - **Action (cannot be solved in code):** Obtain a signed BAA with Anthropic before any real patient data enters the system. Verify the BAA covers Claude vision, the Agent SDK, and any models invoked (Opus 4.7, Haiku 4.5). Document the BAA reference in `docs/COMPLIANCE.md`.

2. **No authentication or authorization on any route.**
   - `api/src/hathor/server.py:69` — FastAPI app has CORS to `localhost:3000` only, but no auth middleware. Anyone who can reach the server can POST `/reconcile/card`, `/reconcile-stream`, `/session/{id}/override`.
   - `api/src/hathor/server_sessions.py:150` — `clinician_id` defaults to the literal `"demo-clinician"` and is written into FHIR Provenance (`agent[0].who.display`).
   - **Action:** Introduce OIDC/OAuth2 with a clinician identity provider before any pilot. Bind every session to a real `clinician_id`. Reject unauthenticated requests on `/reconcile/*` and `/session/*`. Carry the verified identity through to FHIR Provenance.

3. **PHI may leak via SSE error responses.**
   - `api/src/hathor/server.py:699`, `833`, `836`, `867` previously yielded `{"message": str(exc)}` directly to the client. The exception text from the vision pipeline can include parsed antigen names, dates, or filenames.
   - **Status:** **Partially remediated in this branch** — see "Hardened in this branch" below. Still need to audit downstream SSE consumers (`web/app/scan/page.tsx`) for any place a raw error string is displayed verbatim or persisted.

4. **Sessions are per-process in-memory dicts.**
   - `api/src/hathor/server_sessions.py:41` (`SessionStore`), `:143` (`ReconcileSessionStore`).
   - On restart or horizontal scale, every active HITL correction round-trip and every pending override window is lost. A clinician's correction made 14 minutes into a 15-minute window vanishes if the process is killed.
   - **Action:** Replace with durable, encrypted backing (per-session encryption keys; on-prem Redis with TLS, or a FHIR-native store). The `# SOVEREIGNTY NOTE:` block at the top of `server_sessions.py` already plans this.

### HIGH (blockers for handling real PHI)

5. **No encryption at rest.**
   - In-memory sessions: not encrypted (Python process memory).
   - `evaluation/provenance_log.jsonl`: plain JSONL on disk, no encryption, no integrity proof.
   - **Action:** Encrypt session payloads with a per-deployment key (envelope encryption preferred — KEK in HSM, DEK rotated). For provenance, migrate to a tamper-evident log (each record signed; chained via SHA-256 of prior record).

6. **No data-retention or deletion mechanism.**
   - There is no API to delete a child's reconciliation record once the visit is closed. The provenance log is append-only and never pruned.
   - **Action:** Define a retention policy (e.g., transient session data: 24h after close; FHIR Provenance: 6 years; vaccination card images: never persisted server-side beyond the request lifetime). Implement a background job that enforces it. Provide an admin DELETE endpoint that itself logs the deletion event.

7. **No rate limiting.**
   - `api/src/hathor/server.py` has no rate-limit middleware. `web/app/api/parse-card/route.ts` has no rate limit on uploads.
   - **Action:** Add rate limiting per authenticated clinician (e.g., FastAPI's `slowapi`, or middleware at the reverse proxy / edge). Without rate limits, a credentialled-but-malicious user can exfiltrate reconciliation patterns or burn API quota.

8. **No PHI-access audit log.**
   - Override events are logged via FHIR Provenance, but there is no audit entry for the *initial* request — "clinician X requested reconciliation for child with DOB Y at time Z."
   - **Action:** Emit a FHIR `AuditEvent` (or equivalent structured record) on every `/reconcile/card` and `/reconcile-stream` invocation. Include user identity, endpoint, hashed child identifier, source country, outcome, and timestamp.

9. **No `Cache-Control: no-store` on PHI responses.**
   - **Status:** **Partially remediated in this branch** for `/reconcile-stream`, `/reconcile/card`, and `/api/parse-card`. Other PHI-bearing endpoints (`/session/{id}/override` JSON response, `/validate-schedule`) still need it.

10. **No HTTPS / HSTS enforcement in production config.**
    - The Next.js config does not declare HSTS. Production deployment must terminate TLS and force HTTP→HTTPS redirects, then add `Strict-Transport-Security`.
    - **Status:** **Hardened in this branch** — `web/next.config.ts` now sets `Strict-Transport-Security` and other baseline security headers. Operators are still responsible for actually serving over HTTPS.

### MEDIUM (needed before pilot deployment)

11. **No Content Security Policy (CSP).**
    - A strict CSP that disallows inline scripts and limits external connect sources is the strongest browser-side defence against XSS / token exfiltration.
    - **Not done in this branch** — Next.js with Tailwind 4 and Turbopack needs CSP tuning to avoid breaking dev mode and `next/font`. Recommend a separate, tested PR.

12. **Form-field validation against PII contamination.**
    - `web/app/api/parse-card/route.ts` accepted `source_country`, `card_language`, and `child_dob` as free-form strings. A clinician pasting a child's name into "country" would echo PII into the vision model and into logs.
    - **Status:** **Hardened in this branch** — hint fields are now validated and oversized values rejected.

13. **Provenance log is not tamper-evident.**
    - JSONL on disk, no signatures, no chain.
    - **Action:** Sign each Provenance record (server private key); chain by including the SHA-256 of the prior record. Migrate from local file to durable append-only storage.

14. **Synthetic card fixtures use realistic names.**
    - `cards/fixtures/synthetic_vaccination_cards/` generates fictional but plausible names (e.g., "Mahmoud Ali"). Low real-world risk, but a stray fixture in production would be ambiguous.
    - **Action:** Use obviously-fake placeholders (`TEST_CHILD_001`) in synthetic data, or watermark each fixture image with "SYNTHETIC TEST DATA — NOT A REAL PATIENT".

### LOW / hygiene

15. **Console.log diagnostic in `parse-card` echoed warning text.**
    - **Status:** **Hardened in this branch** — the `warnings_preview` field is removed; only counts and template ID remain.

16. **Unstructured server logging.**
    - Both API and web log via plain `_log.info` / `console.log`. Not a leakage problem on its own, but harder to centralise, redact, or forward to a SIEM.
    - **Action:** Move to structured (JSON) logging once a logging stack is chosen.

17. **README does not describe data handling.**
    - **Status:** **Hardened in this branch** — README now has a "Data handling & privacy" section.

---

## Hardened in this branch

The following changes are applied in `hipaa-pii-compliance`. Each is scoped to *modify existing surfaces only* — no new dependencies, no new endpoints, no auth scaffolding.

| Change | File | What it does |
|---|---|---|
| Sanitize SSE error payloads | `api/src/hathor/server.py` | Replaces `str(exc)` in client-facing SSE `error` events with a generic message + opaque error code. The full exception is still logged server-side via `_log.exception()` for debugging. |
| Validate `parse-card` hints | `web/app/api/parse-card/route.ts` | `source_country` capped at 64 chars + control-char strip; `card_language` restricted to enum `{en, ar, fr, mixed}`; `child_dob` must match `YYYY-MM-DD`. Invalid hints are dropped (not echoed) and surfaced as an `unsupported_hint` 400. |
| Remove free-text echo from diagnostic log | `web/app/api/parse-card/route.ts` | `warnings_preview` removed; only counts and template ID are logged. |
| PHI cache-control + classification headers | `api/src/hathor/server.py`, `web/app/api/parse-card/route.ts` | Add `Cache-Control: no-store, no-cache, must-revalidate, private`, `Pragma: no-cache`, and `X-Content-Classification: PHI` on every PHI-bearing response. |
| Baseline security headers (web) | `web/next.config.ts` | HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a no-store/PHI classification on `/api/*`. |
| README data-handling section | `README.md` | Brief, public-facing statement of the prototype's data posture: no real patient data accepted; what the system would need before it could. |

These are hygiene fixes, not a HIPAA compliance certification. The CRITICAL items (BAA, auth, durable storage, encryption-at-rest) are not addressed in this branch.

---

## Remediation roadmap (ordered)

The order matters: do not skip steps. Each step gates the next.

1. **BAA with Anthropic.** Operational, not code. Without this, no further compliance work matters.
2. **Authentication & identity binding.** OIDC/OAuth2 in front of every route. Real `clinician_id` carried into Provenance. Without this, audit logging is meaningless.
3. **Durable, encrypted session storage.** Replace `SessionStore` and `ReconcileSessionStore`. Per-session encryption.
4. **Audit logging on every PHI-access event.** FHIR `AuditEvent` per request. Forwarded to a SIEM.
5. **Tamper-evident provenance log.** Per-record signature + chain. Migrate off local JSONL.
6. **Rate limiting + abuse protection.** Per-authenticated-user, not per-IP.
7. **Data retention & deletion.** Policy + enforcement job + admin DELETE endpoint.
8. **Strict Content Security Policy.** Tested in dev + prod.
9. **Penetration test + HIPAA risk assessment.** Independent third party. Document findings.
10. **Clinician training + access-acknowledgement banner.** Legal record of awareness and consent.

Only after step 10 should the system see real patient data, and even then in a defined pilot scope (e.g., one clinic, one country pair, with informed consent for each child).

---

## How to verify the hardening in this branch

```bash
cd /Users/ahmedzayed/projects/hathor

# API tests still pass — no behavioural regression in the safety loops.
cd api && uv run pytest -q

# Web tests still pass.
cd ../web && npm test -- --run

# Headers: spin up the server and curl the /api/parse-card route with an
# obviously-bad hint and confirm the 400 response does not echo the hint.
```

---

## Open questions for Ahmed

These need a decision before the next PR can land:

1. Is a Phase 1 pilot likely in 2026, and which clinic / country pair? Compliance scope flows from this.
2. Acceptable storage backend for durable sessions — Redis (operational simplicity) vs. PostgreSQL (transactional guarantees) vs. FHIR-native (HAPI)?
3. Identity provider — institutional (e.g., MoH-issued credentials), Auth0/Okta, or self-hosted OIDC?
4. Retention policy — what is the maximum acceptable retention for transient session data? For the Provenance trail?
5. Who owns the BAA with Anthropic — the project, the clinic, or the institutional partner?
