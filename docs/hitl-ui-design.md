# Clinician review UI — slot states, audit, and the schema contract

PR 3 implements the clinician review UI on top of the slot-state model
that PR 2 must encode in the data layer. **This document is a
specification, not a proposal.** Decisions are committed; reasoning is
captured in one line each. Genuine uncertainties live in the
**Open questions** section at the bottom.

The Egyptian MoHP card is the only target. No other card layout is in
scope. See **Non-goals**.

---

## 1. Slot states

The clinician reviews exactly **three** slot states. Every row the UI
renders belongs to one of them. State is computed deterministically
from the data; it is never authored by hand.

| State | Definition | Source enum value |
|---|---|---|
| `extracted` | Vision read this visit confidently. Aggregate row confidence and required field confidences both clear `CONFIDENCE_THRESHOLD` (0.85). | `source = "vision"` |
| `ambiguous` | Vision saw a row at this visit but at least one signal is below the threshold or was flagged `needs_review`. Held for clinician confirmation. | `source = "vision_low_confidence"` |
| `predicted` | The Egyptian MoHP template expects a visit at this age point and no vision row claimed the corresponding template spec. Synthesised AMBER slot. | `source = "template_inferred"` |

`predicted_from_schedule` remains a reserved future source enum and is
not produced by any code path in PR 2 or PR 3. The trust gate already
bars it.

The state mapping is enforced in TS at the `ParsedCardRow → SlotState`
derivation site (Section 6). Tests assert that no other source values
exist in the wire output of `/api/parse-card`.

---

## 2. Visual treatment per state

Every visual choice must read at a tired clinician's bedside phone at
2am with smudged glasses. Color carries meaning but is **never the
sole channel** — see Section 8 for the redundant-channel requirement.

| State | Background | Border | Left rail icon | Label text | Type weight |
|---|---|---|---|---|---|
| `extracted` | `#FFFDF7` (paper) | `1px solid #E7E2DA` (rule) | `check-circle` (filled) in `#5F7A52` (ok) | "Extracted" | regular |
| `ambiguous` | `#FBF6EC` (paper2) | `1px solid #CC785C`, **`3px left rail #CC785C`** (copper) | `help-circle` in `#9A5743` (copperInk) | "Ambiguous — review" | medium |
| `predicted` (missed) | `#FBF6EC` (paper2) | **`1px dashed #CC785C`**, **`3px left rail #CC785C`** | `plus-circle` (outlined) in `#9A5743` | "Predicted — vision missed this visit" | medium |
| `predicted` (zero-vision) | `#F3E3DF` (badSoft) | **`1px solid #A3453B`**, **`3px left rail #A3453B`** (bad) | `alert-triangle` in `#A3453B` | "Predicted — entire schedule synthesized from template" | bold |

Notes:
- `predicted (missed)` and `predicted (zero-vision)` share the AMBER
  semantic family but never share *visual* tokens. Border style is the
  primary differentiator: dashed copper for missed-on-legible, solid
  red for zero-vision-template.
- A persistent banner appears above the row list whenever **any** row
  is `predicted (zero-vision)`: "Vision could not read any visit on
  this card. Every visit below is synthesised from the Egyptian MoHP
  template. Confirm each one before proceeding." The banner is `bad`
  background, full width, dismissable only after every zero-vision
  row has a clinician action.
- Iconography library is `lucide-react` (already a dependency).

---

## 3. The two `predicted` sub-flavors

The critical distinction is whether the clinician is filling **gaps in
an otherwise-legible card** or **recreating an entire schedule from
the template** with no vision evidence.

### `predicted (missed)` — vision missed this visit on an otherwise-legible card

Emitted when the run has at least one `extracted` or `ambiguous` row
AND one or more template specs are unfilled. Clinician should
confirm or skip per slot. Cognitive load is local: the card is
mostly readable; this slot is a gap.

### `predicted (zero-vision)` — vision saw no visits, the template is the only signal

Emitted when **zero** vision rows survive (zero `extracted` and zero
`ambiguous`) AND the recognised template still produces predicted
slots. The clinician is being asked to confirm a fully synthesised
schedule. Cognitive load is global: nothing on the card was
machine-read; the predictions ARE the data.

Discriminator rule (deterministic, computed at parse time):

```
predicted_subkind =
    "zero_vision"   if total_vision_rows == 0
    "missed"        otherwise
```

A run produces predicted rows of one sub-flavor or the other, never
both. The boundary at zero is the clean rule because that is the
exact case the existing fixture-harness `zero_vision` mode exercises.

---

## 4. Affordances per state

Four actions. **`skip` and `reject` are clinically distinct** — they
must not be collapsed into a single "dismiss" verb in the UI or in
the data layer.

| Action | Clinical meaning | Reaches reconciliation? | Free-text reason required? |
|---|---|---|---|
| `confirm` | "I am asserting this row is correct as shown." | Yes — gate admits with confidence rewritten to 1.0. | No |
| `edit` | "The values shown are wrong; here is the correct value." | Yes — gate admits the edited values with confidence 1.0. | No (the new value is the artifact) |
| `skip` | **Absence of confirmation.** "I have not reviewed this visit; treat it as unreviewed. Catch-up logic may still apply." | No — held back; reconciliation continues without this row but knows the visit is unreviewed. | No |
| `reject` | **Confirmation of absence.** "This visit definitively did not occur." | No — but the reconciler is told the visit did not happen, which suppresses catch-up scheduling for it. | **Yes** (mandatory clinician note) |

Action availability per state:

| State | confirm | edit | skip | reject |
|---|---|---|---|---|
| `extracted` | (implicit, default) | yes | no | yes |
| `ambiguous` | yes | yes | yes | yes |
| `predicted` (missed) | yes | yes | yes | yes |
| `predicted` (zero-vision) | yes | yes | yes | yes |

Rationale for the matrix:
- `extracted` rows are auto-confirmed at render time; the only
  meaningful clinician actions are `edit` (vision was wrong) or
  `reject` (visit definitively did not occur — rare but valid).
  `skip` makes no sense on an extracted row because the clinician has
  by definition reviewed it.
- All three other states offer the full action set because the
  clinician is making a positive claim either way.

The reconciliation layer treats `skip` and `reject` as different
inputs:
- A `skip`ped visit is invisible to catch-up logic in the same way an
  unreviewed row is — it may resurface as "missing dose" in the final
  plan.
- A `reject`ed visit is a definitive claim that the dose was not
  given. The catch-up logic treats it as confirmed-absent and
  schedules the dose.

---

## 5. Audit trail

Every `confirm`, `edit`, `skip`, and `reject` produces one immutable
audit log entry. The entry is sufficient to reconstruct, after the
fact, **what the clinician saw and what they decided**, even if the
PR 3 UI does not yet surface a full audit view.

### Required audit-entry fields

| Field | Type | Nullability | Rationale |
|---|---|---|---|
| `audit_entry_id` | string (UUID v4) | required | Stable identifier for cross-referencing. |
| `row_id` | string | required | The slot the action targets. Stable across re-renders. |
| `clinician_id` | string | required at FHIR-export time; **optional at PR 3 demo time** | A demo session has no real identity; FHIR Provenance later requires it. See open question (a). |
| `clinician_display_name` | string | optional | UI convenience only; never the load-bearing identifier. |
| `timestamp` | ISO 8601 string with timezone | required | When the action was committed. |
| `action` | enum: `confirm` \| `edit` \| `skip` \| `reject` | required | The clinician verb. |
| `slot_state_at_action` | enum: `extracted` \| `ambiguous` \| `predicted_missed` \| `predicted_zero_vision` | required | The state the slot was in when the clinician acted. |
| `predicted_value` | object (snapshot of antigen, date, dose_number, dose_kind, lot_number, source, confidence, fieldConfidences) | required | What the clinician saw. Snapshot at the moment the row was rendered to them. |
| `confirmed_value` | object (same shape) | required for `confirm`/`edit`; null for `skip`/`reject` | What the clinician committed. |
| `reason` | string | required for `reject`; optional otherwise | Free-text clinician note explaining the action. |
| `predicted_subkind` | enum: `missed` \| `zero_vision` \| null | nullable; non-null only when `slot_state_at_action` is a predicted state | Lets the post-hoc audit distinguish the two predicted flavors without re-deriving. |

The audit log is **append-only**. Editing a previously-confirmed row
appends a new entry; it does not mutate the existing entry. The most
recent entry per `row_id` is the authoritative state.

### Storage

- In-memory: `auditLog: AuditEntry[]` on the review session state.
- Wire (PR 3 → server): the entire audit log accompanies the
  validate-schedule request. The server logs it to the FHIR
  Provenance sink (existing `evaluation/provenance_log.jsonl`,
  gitignored) keyed by `row_id`.
- The trust gate inspects the latest audit entry per row, not the
  raw row state. This is how `confirm` translates into a confidence
  rewrite to 1.0 without mutating the source row.

---

## 6. Schema contract for PR 2

This section is the **load-bearing output of this design note**. PR 2
must produce these fields. PR 3 consumes them. If a field is vague
here, PR 2 gets reworked when PR 3 lands.

### 6.1 `ParsedCardRow` extensions

The existing `ParsedCardRow` interface in `web/lib/types.ts` extends
as follows. All new fields are populated by the parse pipeline (vision
or template inference) at the moment the row is produced.

| Field | Type | Nullability | Enables |
|---|---|---|---|
| `row_id` | `string` | **required** (UUID v4 generated at parse time) | Stable identity for audit-log keying, edit operations, React reconciliation. Currently rows are keyed by array index — that is wrong because edits and re-renders can shift positions. |
| `slot_state` | `"extracted" \| "ambiguous" \| "predicted"` | **required** | UI state derivation, audit log, trust-gate routing. Computed from `source` and confidence; never authored. |
| `predicted_subkind` | `"missed" \| "zero_vision" \| null` | nullable; non-null iff `slot_state === "predicted"` | UI distinction between the two predicted visual treatments (Section 3). Computed at parse time from total vision row count. |
| `template_spec_index` | `number \| null` | nullable; non-null for `predicted` rows; nullable for `extracted`/`ambiguous` rows that happen to align with a template spec | Lets the UI position the slot under the right age-point header without re-running the matcher. |
| `clinician_action` | `"none" \| "confirmed" \| "edited" \| "skipped" \| "rejected"` | **required**, defaults to `"none"` | UI treatment after a clinician acts; reconciliation routing. Not the audit trail itself — see Section 5. |
| `clinician_action_at` | `string \| null` (ISO timestamp) | nullable; non-null when `clinician_action !== "none"` | Cache of the latest audit entry's timestamp for cheap UI rendering. |
| `clinician_reason` | `string \| null` | nullable; required (non-null) when `clinician_action === "rejected"`; optional otherwise | UI display + audit pointer. |
| `prediction_id` | `string \| null` | nullable; non-null for `predicted` rows; null for `extracted`/`ambiguous` | **Replaces** `sourceEvidenceFragmentId` for predicted rows. Format: `T:<template_spec_index>` for predicted, `V:<fragment_id>` for vision. The structural distinction is required so that downstream logs and FHIR exports can tell them apart **without** copy. (Limitation 3 fix from PR 1.) |

### 6.2 Card-level metadata extensions

The existing `ParsedCardOutput` object grows two card-level fields:

| Field | Type | Nullability | Enables |
|---|---|---|---|
| `orientation_acknowledged` | `boolean` | **required**, defaults to `false` | Orientation-warning blocking (Section 7). The trust gate refuses to admit any row from a card with `orientation_warning !== null && orientation_acknowledged === false`. |
| `audit_log` | `AuditEntry[]` | **required**, defaults to `[]` | Section 5. The audit log lives on the card output, not per-row, so it is one concatenated history per session. |

### 6.3 `AuditEntry` interface

```ts
interface AuditEntry {
  audit_entry_id: string;            // UUID v4
  row_id: string;                    // ParsedCardRow.row_id
  clinician_id: string | null;       // null at demo time; required for FHIR export
  clinician_display_name: string | null;
  timestamp: string;                 // ISO 8601 with timezone
  action: "confirm" | "edit" | "skip" | "reject";
  slot_state_at_action:
    | "extracted"
    | "ambiguous"
    | "predicted_missed"
    | "predicted_zero_vision";
  predicted_value: SlotValueSnapshot;
  confirmed_value: SlotValueSnapshot | null;  // null for skip/reject
  reason: string | null;             // required for reject
  predicted_subkind: "missed" | "zero_vision" | null;
}

interface SlotValueSnapshot {
  antigen: string;
  date: string | null;
  dose_number: number | null;
  dose_kind: "primary" | "booster" | "birth" | "unknown";
  lot_number: string | null;
  source: ParsedCardRow["source"];
  confidence: number;
  field_confidences?: {
    antigen?: number;
    date?: number;
    dose_number?: number;
    lot_number?: number;
  };
}
```

### 6.4 Migration strategy for PR 2

- The legacy `rows[]` array on `ParsedCardOutput` becomes a derived
  alias of the new visit-first `visits[].rows[]` shape.
- `sourceEvidenceFragmentId` is **deprecated for predicted rows**.
  Predicted rows must use `prediction_id` going forward. Vision rows
  continue to populate `sourceEvidenceFragmentId`. **No row carries
  both fields**; the parse-time logic chooses one. PR 2 emits both for
  one cycle; PR 3 removes `sourceEvidenceFragmentId` from predicted
  rows.
- `rows[]` alias deletion date: **removed when PR 3 lands**, recorded
  in `web/lib/types.ts` next to the alias declaration and in the PR
  2 commit message. Not negotiable past PR 3 merge.

### 6.5 Trust gate update

`filterConfirmedDoses` (TS and Python) gains an additional admission
branch:

```
admit_row(row) :=
  row.clinician_action ∈ {"confirmed", "edited"}
    OR
  (row.source = "vision" AND row.confidence >= 0.85
   AND row.fieldConfidences.* >= 0.85
   AND row.clinician_action ≠ "rejected")
    OR
  row.clinician_action = "rejected"  -- emitted with a "definitively absent" wire flag, see below
```

Rejected rows still leave the gate, but on a **separate output
channel**: `confirmed_doses` (engine-eligible) vs `definitively_absent`
(catch-up suppression input). The engine sees confirmed; the
reconciler sees both.

```ts
interface ConfirmedDoseFilterResult {
  confirmed: ParsedCardRow[];
  definitively_absent: ParsedCardRow[];   // NEW — clinician-rejected
  dropped: DroppedRow[];
  confirmedIndices: number[];
}
```

Rejected rows are NOT dropped. Dropping them would lose the clinical
claim "the visit did not happen."

The Python `filter_confirmed_doses` mirrors this. The shared parity
fixture grows two cases:

- `clinician_rejected_routes_to_definitively_absent` — admit-equivalent
  outcome, but on the `definitively_absent` channel.
- `clinician_skipped_dropped` — drop, no admit.

Both implementations must agree on the channel routing.

---

## 7. Orientation-warning blocking

Orientation warnings are **blocking**, not advisory. A tired clinician
will dismiss an advisory toast.

### Mechanism

- `LayoutAnalysisResult.orientation_warning !== null` causes
  `ParsedCardOutput.orientation_acknowledged` to default to `false`.
- The trust gate reads `orientation_acknowledged`. While it is
  `false` and `orientation_warning !== null`, **all rows are dropped**
  with reason `"orientation unconfirmed"`. The validate-schedule
  request never builds.
- The UI presents a full-card modal at first render: "This card
  appears rotated/tilted. Confirm orientation before reviewing
  vaccinations." The clinician must explicitly acknowledge or
  re-shoot the image. Acknowledgement sets the flag to `true`.
- Acknowledgement is logged as an `AuditEntry` with
  `action = "confirm"`, `row_id = "card_orientation"` (a sentinel
  reserved row id), `predicted_value = { warning: <text> }`,
  `confirmed_value = { acknowledged: true }`.

### Tests in PR 2

- TS: `trust-gate.test.ts` asserts that `buildValidationRecords`
  returns zero records when `orientation_warning !== null` and
  `orientation_acknowledged === false`, regardless of row state.
- TS: same suite asserts records build normally once
  `orientation_acknowledged === true`.
- Python: `test_phase_d.py` adds the equivalent on the Python side.

---

## 8. Accessibility and visual redundancy

Color alone never carries the state distinction. Every state uses
**at least three** non-color channels — color + icon + border-style or
border-color + label.

### Redundancy matrix

| State | Color | Icon | Border style | Label | Background pattern |
|---|---|---|---|---|---|
| `extracted` | green (`ok`) | `check-circle` filled | thin solid neutral | "Extracted" | flat |
| `ambiguous` | copper | `help-circle` | thin solid copper + 3px left rail | "Ambiguous — review" | flat |
| `predicted (missed)` | copper | `plus-circle` outlined | **dashed** copper + 3px left rail | "Predicted — vision missed this visit" | flat |
| `predicted (zero-vision)` | red (`bad`) | `alert-triangle` | **solid red** + 3px left rail | "Predicted — entire schedule synthesized from template" | subtle diagonal hatch overlay at 5% opacity |

### Concrete WCAG / clinical-context requirements

- Minimum contrast ratio 4.5:1 between every state's foreground text
  and background. The Pharos token pairs already satisfy this; PR 3
  will spot-check.
- Icon size minimum 16px at standard render; 20px on the slot row.
- Border-style differences (dashed vs solid) are visible at 100%
  zoom on a 320×568 viewport (iPhone SE).
- The persistent zero-vision banner uses red + `alert-triangle` icon
  + bold serif heading. Three channels.
- Color-blind pass: protanopia, deuteranopia, tritanopia simulated
  via stylesheet variants in PR 3 dev pages. Manual visual
  verification before PR 3 merge.
- No state distinction depends on hue alone. Verified by a
  greyscale-rendered screenshot test in PR 3 (`__visual__/states.png`).

---

## Non-goals

- **Spanish, EU, or any non-Egyptian card.** This design covers the
  Egyptian MoHP `egypt_mohp_mandatory_childhood_immunization`
  template only. No multi-country visual language. Other templates
  fall back to the existing pre-PR-3 review surface (or do not
  render at all if the template is `unknown_vaccine_card`).
- **Phase 2 / German / STIKO surfaces.** Out of scope per
  `CLAUDE.md`.
- **Full FHIR Provenance UI.** PR 3 captures the audit data; a
  clinician-facing audit view ships in a later PR.
- **Multi-clinician handoff.** A session is one clinician end-to-end
  in PR 3.
- **Offline / sync conflict handling.** Out of scope. The session is
  online and single-device.
- **Translating slot-state strings into Arabic.** PR 3 ships English
  labels only. Arabic localization is a follow-up PR.

---

## Open questions

Two genuine uncertainties. Each lists the options I considered and the
choice I would commit to absent your input.

### (a) Clinician identity at demo time

**Question.** PR 3 ships in a hackathon demo where there is no real
authenticated clinician. The audit log requires a `clinician_id` for
FHIR Provenance later. What should `clinician_id` be at demo time?

**Options.**
1. `null` — schema-explicit "no identity captured at this entry."
2. `"demo-clinician"` — sentinel string, unambiguous in logs.
3. Browser fingerprint hash — looks like an id but is not a person.

**Recommended:** option 2 (`"demo-clinician"` as a sentinel).
Reasoning: option 1 makes the field nullable forever, which weakens
the FHIR contract; option 3 introduces tracking that has no clinical
meaning. A literal sentinel string is honest and easy to grep out
when a real auth layer lands.

### (b) `reject` reason field — required at the schema level or only at the UI level?

**Question.** Section 4 says reject requires a clinician reason.
Should the schema enforce non-null `reason` for reject entries, or
should only the UI block submit until reason is filled?

**Options.**
1. Schema-enforced (Pydantic / TypeScript narrowing on the discriminated
   union). Submit with empty reason fails validation server-side.
2. UI-enforced only. Schema accepts null reason; UI does not let it
   submit.

**Recommended:** option 1 (schema-enforced). Reasoning: the audit
trail is the authoritative record. If the schema admits a
reason-less reject, a non-UI client (CLI export, automated test,
future API consumer) can produce one. Closing that door at the
schema is cheap; the UI enforcement is then just a convenience layer.
