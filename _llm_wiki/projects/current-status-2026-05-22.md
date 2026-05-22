# Current Status — Hathor (snapshot 2026-05-22)

What was in flight on the MacBook Pro working copy at the moment this
wiki was created. **Living dated snapshot:** the date in the filename
marks creation, not immutability. Per the wiki update policy in
`_llm_wiki/CLAUDE.md`, this file may be edited in place to correct
facts, align with policy changes, or refresh open questions. Log
every change in `_llm_wiki/log.md`. When the in-flight picture
changes materially enough that a single snapshot no longer fits, add
a new dated current-status file alongside this one.

## Branch and recent history

- Branch: `main`.
- Recent commits (most recent first):
  - `8884e9e` — feat: add passport export prototype (code only;
    deps deferred — see workstream-split decision below).
  - `eda03a4` — docs: reconcile Hathor agent instructions.
  - `eea3027` — docs: add general agent instructions (root
    `AGENTS.md` tracked).
  - `fc455a1` — docs: add Hathor LLM wiki (this wiki's birth).
  - `53724b8` — fix(reconcile): preserve combination products in
    vision; OPV birth-dose match; refresh caveat copy.
  - `9031b05` — fix(reconcile): per-component coverage, catch-up
    framing, HepB birth-dose distinction; Egypt v2.1 remodel.
  - `2c1cfc6` — feat(web): CountryPair verdict header on scan
    results.
  - `19d1cd7` — feat(web): standardize PageHeader + structured
    Coverage view on reconcile.
  - `56438ce` — feat(web): Pharos alignment — shared module,
    lighthouse beam, partial-coverage signal.

Theme of the latest run: **wiki + agent-rules canonicalization, then
isolation of the passport-export prototype as its own review unit.**

## Workstream split (canonical classification)

The dirty state that survived the passport-isolation commit `8884e9e`
breaks down into **four** independent workstreams. Future agents must
not mix them in a single commit. Full rationale and recommended
commit sequencing are in
[`decisions/workstream-split-2026-05-22.md`](../decisions/workstream-split-2026-05-22.md).

### 1. Passport / export prototype — **partially committed**
Code landed at `8884e9e feat: add passport export prototype`:

- `web/app/passport/verify/page.tsx`
- `web/components/PassportIssueModal.tsx`
- `web/components/ExportPanel.tsx` (modification)
- `web/lib/passport/{bundle-mapping,issue,issue.test,keys,schema}.ts`

Deferred until a dependency-strategy decision is made:

- Passport portion of `web/package.json` (`jose`, `qrcode.react`,
  `html5-qrcode`, + `lib/passport/issue.test.ts` test path).
- Corresponding `web/package-lock.json` entries.

**Build caveat:** a fresh checkout at `8884e9e` will not install the
passport deps and will fail to build until the dependency commit
lands. This is the explicit trade-off recorded in the commit body.

### 2. Remotion / video prototype — **all dirty (untracked)**
- `web/remotion.config.ts`
- `web/remotion/Root.tsx`
- `web/remotion/AgentFanOut.tsx`
- `web/remotion/CostAnimation.tsx`
- `web/remotion/SafetyGates.tsx`
- `web/remotion/hathor60s/`

Plus the Remotion portion of `web/package.json` (`@remotion/cli`,
`@remotion/renderer` devDeps + six `remotion:*` / `render:*` scripts)
and the matching `web/package-lock.json` entries.

Remotion is application code under `web/`, distinct from the in-repo
`video/` directory and the Desktop `Hathor-video-assets` symlink
target — see the manifest's three-way distinction table.

### 3. Phase D safety-loop / HITL UI — **all dirty (modified)**
- `web/app/scan/page.tsx`

Diff content: `CONFIDENCE_THRESHOLD` import from
`@/lib/trust-gate`; new `pendingReview` memo; new `reviewBlocked`
gate that pauses reconciliation, country-rules, and differences
surfaces until clinician resolution; new `<ReviewRequiredBanner>`;
new `onConfirm` plumbing through `DoseTable` → `DoseRow` with a
"Keep as read" affordance writing `clinician_action: "confirmed"`;
tightened amber-styling rule that respects clinician_action.

This implements the Phase D vision-safety-loop UI described in
`docs/SAFETY_LOOPS.md` and named in the project rules in
`CLAUDE.md` / `AGENTS.md`. It depends only on tracked
`@/lib/trust-gate`. The earlier hypothesis that
`web/app/scan/page.tsx` was passport scope was wrong; it is its own
clinical-safety workstream.

### 4. Shared / ambiguous — **all dirty, special handling required**
- `web/package.json` — **mixed** passport deps (`jose`,
  `qrcode.react`, `html5-qrcode`, passport test path) and Remotion
  deps (`@remotion/cli`, `@remotion/renderer` devDeps + six
  `remotion:*` / `render:*` scripts). **Source commits must not
  proceed via `git add web/package.json` until a dependency strategy
  is chosen** — see the options in
  `decisions/workstream-split-2026-05-22.md`.
- `web/package-lock.json` — derives mechanically from `package.json`.
  Cannot be split cleanly without re-running `npm install`, which
  this wiki's policy says agents must not do unilaterally.
- `web/app/layout.tsx` — single-line `suppressHydrationWarning`
  addition on `<body>`. Cheap polish whose attribution is ambiguous
  (passport's `html5-qrcode` widget mutates the DOM; Remotion's
  preview can also hydrate; or it's generic polish). **Ahmed
  decision needed** on which workstream's commit it should attach to.

The git-state listing in workstream sections 2–4 is a point-in-time
view at 2026-05-22 (after `8884e9e`). It may be corrected in place
if a specific entry is wrong, but do not wholesale-refresh it from a
later `git status` — that loses the snapshot's purpose. If the
in-flight picture has changed materially, add a new dated
current-status file alongside this one rather than overwriting these
lists.

## Prior agent context (do not re-cite tool-state paths)

Prior agent context was available in-session during wiki creation,
but user-level tool-state paths are not active project authorities
and should not be read or cited during normal Hathor work.

Two durable facts surfaced from that context and are recorded here
as wiki content (not as pointers back to tool-state):

- **Parallel specialist architecture (Apr 2026)** — five-specialist
  fan-out exists under `api/src/hathor/specialists/`. Crossbeam-style
  decomposition. Toggled by env flags.
- **Sub-agent A/B findings (Apr 2026)** — prior extract+enrich
  prototype results and prioritized roadmap.

Model-name note: `claude-opus-4-7` is the Claude Code stack's
project default per the tracked repo-root `CLAUDE.md`; do not flag
it as a suspect model name. The general-agent stack (Codex etc.) is
covered by tracked `AGENTS.md` and deliberately does not pin a model
— see the model-defaults paragraph in `index.md` and the resolution
in `decisions/agents-md-promotion-2026-05-22.md`.

## Known not-to-touch

- The five untracked `web/remotion/*` files and the `web/remotion/`
  directory are unreviewed agent output from the video work. Do not
  delete or refactor them.
- `web/app/passport/` and `web/lib/passport/` similarly.
- `cards/private/` — PII risk.
- Anything under project-local `.claude/` — Claude configuration
  directory. Not an active authority for this wiki and not owned by
  it; do not mutate from the wiki. Distinct from user-level
  `~/.claude`, which is forbidden in either direction.

## Open questions for Ahmed

- Should the in-repo `video/` directory and the desktop
  `Hathor-video-assets` folder be unified, or remain split?
- Is the passport export feature meant to ship in Phase 1
  (intra-Africa) or held for Phase 2?
- Should Remotion replace, augment, or compete with the existing
  DaVinci / Final Cut flow in `video/`?
- Which dependency-split strategy to use for `package.json` /
  `package-lock.json` — Option A, B, or C in
  `decisions/workstream-split-2026-05-22.md`?
- Which workstream owns `web/app/layout.tsx`'s
  `suppressHydrationWarning` polish line?

All marked **Ahmed decision needed**. Do not resolve them in code
without an explicit instruction.
