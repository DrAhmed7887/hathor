# Hathor — PII hardening notes

> Hathor is a hackathon prototype. It is **not** a HIPAA-compliant medical device, and these notes do not claim it is. The fixtures in this repo are synthetic, but every vaccination card has names, dates of birth, and clinic stamps — i.e. the same shape as real patient data. So the code is written with PII discipline as a habit, not as a compliance posture.

## The three rules

1. **Don't echo user-provided text into logs or error responses.** A clinician who types a child's name into the wrong field should not see it printed back at them, and the server log should not preserve it for the next operator to glance at.
2. **Don't cache PII-bearing responses.** Anything that contains a child's record carries `Cache-Control: no-store` and a content-classification flag for proxies.
3. **Reject malformed input at the boundary.** Free-text "country" / "DOB" / "language" fields are the obvious places for a slip — validate format, reject the value, never echo the rejection back.

## What this branch changes

### Form-hint validation — `web/app/api/parse-card/route.ts`

| Field | Rule |
|---|---|
| `source_country` | ≤ 64 chars; letters, spaces, apostrophes, hyphens only (matches Latin + Arabic country names) |
| `card_language` | enum `{en, ar, fr, mixed}` |
| `child_dob` | strict `YYYY-MM-DD` |

Control characters are stripped before validation. Invalid hints return `400 invalid_hint` with the *names* of the failing fields — never their values.

### Error sanitization — `api/src/hathor/server.py`, `web/app/api/parse-card/route.ts`

SSE `error` events and JSON 5xx responses no longer carry `str(exc)`. Vision-pipeline exceptions can echo parsed antigens, dates, or filenames — those stay server-side.

- Server-side: `_log.exception(...)` records the full traceback with an opaque `error_id`.
- Client-side: gets only `{ "code": "ERR_…", "error_id": "<12-hex>", "message": "<generic>" }`.

Operators correlate the `error_id` to the server log when debugging.

### Diagnostic-log scrubbing — `web/app/api/parse-card/route.ts`

The per-upload diagnostic dropped its `warnings_preview` (which echoed model-generated text from the card). The line now logs counts only: row count, template id, region count, fragment count, orientation flag, warning count.

### Response headers

PHI-bearing responses (`/reconcile-stream`, `/reconcile/card`, `/api/parse-card`, anything under `/api/*`) carry:

- `Cache-Control: no-store, no-cache, must-revalidate, private`
- `Pragma: no-cache`
- `X-Content-Classification: PHI`

Baseline security headers (`web/next.config.ts`) on every response:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`

## What's deliberately out of scope

These are NOT addressed and are NOT claimed. They are real items for any real-clinic deployment, but they are not what a hackathon prototype is for.

- No authentication or identity binding. `clinician_id` is a placeholder.
- No Business Associate Agreement with Anthropic. Card images and reconciliation context go to the Anthropic API without a HIPAA-grade contract.
- No encryption at rest. HITL and override sessions live in-process memory; the FHIR Provenance override log is a plain JSONL file.
- No rate limiting, no per-request access audit log, no data-deletion API, no tamper-evident provenance.
- No strict Content-Security-Policy (Next 16 + Turbopack + Tailwind 4 need case-by-case CSP tuning).

## Demo posture

`README.md` says, and continues to say, "research prototype, not a medical device." The fixtures in `cards/fixtures/synthetic_vaccination_cards/` are synthetic. Real patient cards never enter version control — see `.gitignore` for the `cards/private/` defence-in-depth rule.

PII discipline in the code does not change that posture. It just keeps the demo from leaking what little it does see.

## Verifying the hardening

```bash
# Reject a "country" field that looks like a name (digits + comma):
curl -s -F file=@cards/demo.jpg \
        -F 'source_country=Ahmad Hassan, born 2022' \
        http://localhost:3000/api/parse-card | jq
# {
#   "error": "invalid_hint",
#   "details": ["source_country must be a country name or ISO code ..."]
# }

# Inspect headers on a parse-card response:
curl -sD - -F file=@cards/demo.jpg http://localhost:3000/api/parse-card -o /dev/null \
  | grep -iE 'cache-control|x-content-classification|x-frame-options|strict-transport'
```
