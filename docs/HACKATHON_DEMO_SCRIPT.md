# Hathor — Hackathon Demo Script

Phase 1.0, Opus 4.7. Synthetic cards only. Not a signed clinical record.

---

## Story (one line)

> "Messy vaccination records are not reliably machine-readable. Hathor
> converts them into a structured clinician-confirmed review before
> schedule reconciliation."

## What this build proves

1. Hathor reads what it can off a vaccination card and surfaces what
   it cannot — uncertain or missing slots route to a clinician review,
   never to silent reconciliation.
2. The clinician can **confirm**, **edit**, **skip**, or **reject** any
   row. Skip and reject are first-class actions in the UI; the trust
   gate routes them to the right channel.
3. Reconciliation only consumes confirmed / high-confidence rows.
   Low-confidence and template-inferred rows never reach the engine.
4. The destination-country selector is **safety-gated**. Only Egypt is
   `partial_ready`; Sudan, South Sudan, Eritrea, Ethiopia, and Nigeria
   sit at `needs_review`. Hathor refuses to produce due/overdue
   verdicts against an unverified schedule.
5. The card-extraction pipeline recognises both the Egyptian MoHP
   mandatory-childhood-immunizations card AND the WHO/IHR
   International Certificate of Vaccination or Prophylaxis (ICVP).

## Demo path (≈ 4 minutes)

### 0. Open `/demo`

Pharos-styled fast-path route.

### 1. Phase A · intake chat (~30 s)

Type a DOB and answer the three follow-ups. The DOB regex flows into
the intake metadata form below so the clinician never retypes.

### 2. Phase A.1 · confirm prep details (15 s)

- **Card origin:** drop-down lists Egypt + Sudan + South Sudan +
  Eritrea + Ethiopia + Nigeria. Each non-Egypt country renders with a
  trailing `(needs review)` tag.
- **Destination schedule:** same six. The readiness banner immediately
  below the form switches between two states:
  - Egypt → copper banner: "Partial-ready schedule".
  - Anything else → amber banner: "Schedule under review — Hathor will
    extract and review the card, but will NOT produce definitive
    due / overdue / catch-up verdicts."

The disclosure paragraph spells the policy out underneath:

> Country schedules are source-backed where available and require
> clinician/public-health confirmation. Egypt is the current
> partial-ready schedule. Other country schedules are included for
> review-workflow demonstration and remain under verification.

### 3. Phase B · upload + redact (~30 s)

Use a synthetic Egyptian MoHP card from
`cards/fixtures/synthetic_vaccination_cards/`. The 02 (messy
handwriting) or 12 (Arabic handwritten with margin notes) fixture is a
good demo of the trust gate firing on real ambiguity. Drag a black box
over any PII before clicking Apply.

### 4. Phase D · parse + review (~90 s)

The /api/parse-card vision call returns rows with per-row crops, dose
kind pills (Birth dose / Booster), and a confidence badge. Every row
below the 0.85 threshold gets an amber border and a
`reasoning_if_uncertain` line.

For each amber row the clinician sees three controls:

- **Keep as read** — accept the model's value as-is.
- **Skip** — drop the row from this reconciliation. The visit stays
  unreviewed.
- **Reject** — assert the dose was definitively NOT given. Requires a
  reason (input is required; "Confirm reject" stays disabled until the
  reason is non-empty). Logged to the audit trail and routed to the
  trust gate's `definitively_absent` channel — NOT engine input.

The footer's "Cross-check against WHO rules →" button stays disabled
until every amber row has an outcome.

### 5. Phase E · validate

#### Path A — destination = Egypt
ScheduleView mounts and runs `/validate-schedule` against the
clinician-confirmed rows. Engine verdicts render per dose with valid /
invalid / needs-review channels.

#### Path B — destination = Sudan / South Sudan / Eritrea / Ethiopia / Nigeria
The amber `NeedsReviewSchedulePanel` mounts in place of ScheduleView
with the explicit message "Hathor will not produce due/overdue
verdicts against the {country} schedule." It states how many
clinician-confirmed doses cleared the trust gate and reminds the
clinician to confirm the destination schedule with public-health
guidance before suggesting catch-up.

### 6. Phase F · export
Only available on the Egypt path because it consumes engine verdicts.
The FHIR Immunization bundle and printable clinical letter both carry
the Phase 1.0 disclosure and the IMMZ-aligned-not-conformant stamp.

## WHO/ICVP demonstration (~60 s)

Use a synthetic ICVP fixture (the synthetic-card generator emits the
"SYNTHETIC TEST RECORD — NOT VALID FOR TRAVEL" disclosure stamp). The
parse-card route's tool schema includes the new template id
`who_icvp_international_certificate`, the recognizer flips on the IHR
title in EN/FR/ES, and the system prompt teaches the model the
ICVP-specific rules:

- Map traveller vaccines to canonical antigens (YellowFever, OPV/IPV,
  MenACWY, COVID-19, Cholera, Typhoid).
- Unknown disease/vaccine names are emitted verbatim with confidence
  below 0.85 — they surface for review, never silently dropped.
- Booster default: traveller vaccines are `primary` unless the row is
  explicitly labelled Booster / Rappel / Refuerzo. Yellow fever single
  doses → dose 1 unless the card numbers them differently.
- Passport / travel-document numbers MUST NOT be echoed into rows;
  the model is told to flag a redaction failure in the page-level
  warnings instead.

ICVP rows then flow through the same Phase D HITL review and the same
trust gate as Egyptian MoHP rows.

## Trust-gate invariant (do not skip this slide)

`web/lib/trust-gate.ts` enforces a single rule:

> No row reaches the engine wire unless source = vision AND
> confidence ≥ 0.85, **or** the clinician has confirmed / edited it.
> `skipped` rows drop with reason "clinician skipped"; `rejected` rows
> route to a separate `definitively_absent` channel; `template_inferred`
> rows never reach the engine without confirmation.

Pinned by `lib/trust-gate.test.ts` (parity-fixture exercised from
both TS and the Python `phase_d.py` mirror).

## What is still mocked / synthetic / honest about scope

- **Synthetic Egyptian MoHP cards only** for the parse demo. Real
  crooked, photographed cards still require an alignment / homography
  pre-pass — the ROI orchestrator in `web/lib/roi-extraction.ts` is
  built and tested but not yet wired into the parse-card route.
- **No private cards in git.** Sofia and any real traveller card stay
  on local disk only.
- **WHO/ICVP synthetic fixtures only.** No real passport numbers, no
  real stamps, no WHO endorsement claim. The synthetic disclosure
  stamp ("SYNTHETIC TEST RECORD — NOT VALID FOR TRAVEL") is preserved
  by the recognizer.
- **needs_review country schedules are NOT clinically verified** for
  this demo. The seed JSON in `data/schedules/` carries content for
  Egypt, Germany, Nigeria, and a generic WHO baseline; Sudan, South
  Sudan, Eritrea, and Ethiopia rely on the gate, not on a verified
  rule set, until a clinician signs them off.
- **No Africa-wide schedule accuracy claim.** Phase 1 scope is
  narrowly Egypt; the four needs_review African countries surfaced
  here are motivated by UNHCR Egypt refugee operational data.
- **No Germany / EU cards in this pass.** Phase 2 scope.
- **No homepage polish in this commit.** Pre-existing landing-page
  refactors are deliberately left out — the demo path lives at
  `/demo`.

## Tests + checks (green at commit)

- `npm --prefix web run typecheck` — clean.
- `npm --prefix web run test` — 239 / 239 passing.
- `npm --prefix web run smoke` — synthetic E2E harness; not run in CI.

## Files of interest

- `web/lib/countries.ts` — readiness metadata + `canRunReconciliation`.
- `web/lib/types.ts` — extended `CountryCode` and `CardLanguage`.
- `web/lib/document-intelligence.ts` — WHO/ICVP template registered;
  recognizer extended to fire on EN/FR/ES IHR titles.
- `web/lib/card-extraction-prompt.ts` — WHO/ICVP rules + passport
  redaction guardrail.
- `web/components/ParsedResults.tsx` — Skip / Reject controls with
  required-reason input; trust-gate-aware row resolution.
- `web/app/demo/page.tsx` — readiness banner + `NeedsReviewSchedulePanel`
  in place of ScheduleView for needs_review destinations.
- `data/templates/who_icvp.json` — synthetic WHO/ICVP layout schema.
- `web/lib/countries.test.ts` + `web/lib/who-icvp-recognizer.test.ts` —
  pin the gating contract and the new recognizer signatures.
