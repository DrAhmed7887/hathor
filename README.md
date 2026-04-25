# Hathor

An autonomous clinical reasoning agent that reconciles a child's vaccination history across national immunization schedules.

---

## Why

Millions of African families move between countries every year — within the continent, for work, study, or safety. A child vaccinated correctly under one national schedule often arrives in a new country where no one can quickly tell the family which doses count, which are missing, and what is needed before the child can enrol in school or nursery. The schedules look similar on paper but diverge in important ways: the antigens covered by combined products, the ages of administration, the vaccines that are routine in one country and not another, and the strict age windows on products like rotavirus.

I am an Egyptian physician. I built Hathor because I kept running into this problem myself and in my clinical work — and because no open-source tool exists for autonomous cross-schedule reconciliation. The closest prior work (AI-VaxGuide, arXiv 2507.03493) does clinician Q&A over a single country's guidelines, not reconciliation across schedules.

---

## How it works

Hathor is built on the Claude Agent SDK with extended thinking enabled. Eight custom clinical tools are exposed via an in-process MCP server: card extraction, age computation, vaccine equivalence lookup, interval validation, per-dose validation, schedule retrieval, gap analysis, and catch-up scheduling. The agent decides which tools to call, in what order, based on what it discovers — there is no hardcoded pipeline. The reasoning is dynamic: the agent reads a card, resolves trade names to canonical antigens, checks every dose against the destination country's rules, and synthesises a visit-by-visit catch-up plan entirely on its own.

The frontend is Next.js with SSE streaming, so the agent's reasoning is visible live — tool calls, thinking blocks, and the final report all appear in real time as the agent works.

---

## CrossBeam-inspired document intelligence

Hathor treats a vaccination card the way a blueprint-analysis tool treats a
permit drawing: decompose first, interpret second, and preserve the evidence
so the clinician can audit every conclusion. The pipeline is staged, not
multi-agent — a single vision call emits both the final parsed rows and a
layout/evidence trace in the same tool call, and the downstream code reads
the trace for transparency without letting it override clinician-facing
data.

Pipeline, in order:

1. **Decompose the card into layout regions.** The vision pass classifies
   each visible area — child-info block, vaccine table, individual rows,
   dose labels, date cells, clinic stamps, free-text notes — and records a
   confidence for every region.
2. **Extract evidence from row labels and date cells separately.** For each
   row the model emits two kinds of evidence fragment: the *printed row
   label* ("جرعة ثالثة" / "3rd dose" / "booster") verbatim, and the *raw
   date text* as it appears on the card. The interpreted ISO date lives on
   the parsed row; the fragment preserves what the eye actually saw.
3. **Preserve uncertainty and source text.** Orientation, crop, and
   low-confidence warnings surface at both the page level and the fragment
   level. Nothing is silently smoothed.
4. **Merge evidence conservatively.** A pure helper
   (`web/lib/document-intelligence.ts`) passes parsed rows through
   unchanged and attaches warnings when the layout evidence disagrees with
   the parsed row. It never auto-corrects a date or a dose number.
5. **Hand reviewed rows to the deterministic vaccine rules.** The existing
   AMBER and RED gates still own every clinical decision — the trace
   informs them, it does not replace them.
6. **Require clinician confirmation before action.** A public-health nurse
   or physician is always the party who authorises administration.

The `/demo` review screen exposes a "Document intelligence trace" panel
with the region count, the raw row-label and date evidence, and any
warnings — so a judge can see exactly what layout the model inferred
before any clinical claim is made.

This is **lightweight staged document intelligence, not autonomous medical
decision-making.** If the model omits the trace or emits a malformed one,
the route falls back to the direct parse and the panel says so
transparently. The safety gates are unchanged either way.

---

## Clinical safety architecture

Hathor does not autonomously decide vaccination. It reads, it reconciles, and
it asks a licensed clinician to confirm. Two deterministic gates bracket the
agent's reasoning; the clinician has final authority over both.

- **AMBER gate — Vision Safety Loop (per field).** Every value extracted
  from a vaccination card carries a confidence score. Anything below 0.85 —
  including whole rows flagged amber by the vision pass, Arabic-digit
  ambiguity (for example ٣ vs ١ on handwritten years), or rows on a card
  detected to be rotated 90°/180° — routes to the clinician for review
  before any downstream step sees the value.
- **RED gate — Reasoning Safety Loop (per recommendation).** Every
  clinical recommendation passes through a deterministic rules engine
  derived from the WHO DAK. Biologically impossible records (a dose date
  earlier than the child's DOB), minimum-age violations, and interval
  violations are rejected; the row stays in the review surface with a
  specific engine-authored reason string. The clinician can override a
  RED verdict; overrides are logged with rule ID and reason to the FHIR
  Provenance resource.

Agents read → rules reconcile → clinician confirms. A public-health nurse or
physician is always the party who authorises administration. Code paths that
bypass either gate are a bug.

**Booster-dose handling.** Egyptian MoHP cards print an explicit booster row
("جرعة منشطة") alongside the numbered primary series. The vision pass
classifies every row with a `dose_kind` of `primary`, `booster`, `birth`, or
`unknown`; booster rows travel through the rules engine with
`dose_number=null` and are validated by antigen + age + interval instead of
a dose position the engine does not encode. When the engine cannot safely
prove a booster valid or invalid, it returns `needs_clinician_confirmation`
so the row surfaces as amber rather than either auto-approving or silently
disappearing.

**Arabic / Egyptian card support.** Eastern Arabic digits (٠–٩) are
recognised alongside Western numerals; known handwriting confusions (٣/١,
٢/٧) drop the relevant cell's field confidence and surface an explicit
reason string that the clinician can audit in one second. Clinician edits
use native `<input type="date">` so Egyptian DD/MM/YYYY order cannot
silently corrupt the wire format.

**Rotation / orientation flagging.** The vision pass reads the printed
header and flags 90°/180° rotations in `reasoning_if_uncertain` for every
row on that card, so the clinician can re-photograph instead of guessing.

**Outputs.** Only engine-validated rows enter the FHIR R4 Immunization
bundle (IMMZ-aligned, not IMMZ-conformant — Phase 1.0 demo scope). Booster
rows are preserved through `Immunization.protocolApplied.series = "booster"`.
The printable clinical letter shows every reviewed row — valid, awaiting
clinician review, or RED — so the physician has complete visibility even
when the data bundle does not.

---

## Demo

The flagship case: a 22-month-old child born in Lagos, relocating to Cairo. Her Nigerian NPI card shows the full 6/10/14-week primary series (Pentavalent, OPV, PCV13, Rotavirus, IPV at 14 weeks), plus Measles monovalent and Yellow Fever at 9 months. Target schedule: Egypt's EPI.

The agent identifies that the Nigerian Measles-monovalent dose at 9 months does **not** satisfy Egyptian EPI's MMR requirement — Mumps and Rubella are uncovered, and Egyptian EPI calls for two MMR doses (at 12 and 18 months). It preserves the Yellow Fever dose on the record but does not count it as an Egyptian EPI requirement (Egypt is not yellow-fever-endemic). It recognises Nigeria's BCG-at-birth as satisfying Egypt's BCG-at-1-month requirement, and confirms that the Nigerian Pentavalent + separate IPV doses together cover the same antigens as Egypt's Hexavalent. The output is a visit-by-visit catch-up plan focused on the real gaps: MMR ×2, DPT booster, and OPV booster.

---

## Run locally

```bash
# Terminal 1 — API
cd hathor/api
export ANTHROPIC_API_KEY=sk-ant-...
uv sync
uv run uvicorn hathor.server:app --port 8000

# Terminal 2 — Frontend
cd hathor/web
npm install
npm run dev
```

Visit `localhost:3000`. Click **Use flagship demo scenario**, then **Reconcile**.

---

## What this is and isn't

This is a research prototype, not a medical device. All outputs are clinical decision support — they require confirmation by a licensed paediatrician before any action is taken. The Nigeria schedule is composed from UNICEF Nigeria, the WHO 2024 Nigeria country profile, and the Paediatric Association of Nigeria (2020, reviewed periodically); the Egypt schedule is composed from Egypt MoHP EPI, WHO EMRO, and UNICEF Egypt. The tool currently supports reconciliation into Egypt as the destination country, with Nigeria as the validated source pair; additional African country pairs are future work. MIT licensed.

---

## PII discipline

Hathor is a hackathon prototype, not a HIPAA-compliant medical device. Fixtures are synthetic; real patient cards never enter version control (`.gitignore` carries a `cards/private/` defence-in-depth rule).

The code is still written with PII discipline as a habit:

- **Form hints validated at the boundary.** `source_country`, `card_language`, and `child_dob` are checked against strict patterns. A name pasted into the country field is rejected with `400 invalid_hint` — the offending value is never echoed back.
- **Errors don't leak.** SSE and JSON error responses carry an opaque `error_id`; the full exception is logged server-side. Vision-pipeline exceptions can echo parsed antigens, dates, or filenames — those stay on the server.
- **No-store on PHI-bearing responses.** Reconciliation streams and `parse-card` responses set `Cache-Control: no-store` and an `X-Content-Classification: PHI` flag.
- **Baseline security headers.** HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation off).
- **Diagnostic logs carry counts only**, never card-derived text.

Authentication, BAAs, encryption-at-rest, audit logging, rate limiting — all out of scope for the hackathon and explicitly not claimed. Full notes in [`docs/PII_HARDENING.md`](docs/PII_HARDENING.md).

---

## Built with

Claude Agent SDK · FastAPI · Next.js · Tailwind CSS
