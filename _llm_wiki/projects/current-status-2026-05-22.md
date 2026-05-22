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
  - `5c57c6e` — chore(web): suppress body hydration warning
    (`web/app/layout.tsx` `suppressHydrationWarning` on `<body>`).
  - `dd25b8a` — feat(scan): add Phase D review gate UI
    (`web/app/scan/page.tsx`; closes workstream 3).
  - `2633f79` — feat(video): add Remotion Hathor compositions
    (all Remotion source files; closes workstream 2).
  - `8a841a6` — chore(web): add passport and remotion dependencies
    (`web/package.json` + `web/package-lock.json`; Option A dep
    strategy chosen — combined bump for both workstreams).
  - `8884e9e` — feat: add passport export prototype (code only;
    deps landed in `8a841a6` above).
  - `eda03a4` — docs: reconcile Hathor agent instructions.
  - `eea3027` — docs: add general agent instructions (root
    `AGENTS.md` tracked).
  - `fc455a1` — docs: add Hathor LLM wiki (this wiki's birth).
  - `53724b8` — fix(reconcile): preserve combination products in
    vision; OPV birth-dose match; refresh caveat copy.
  - `9031b05` — fix(reconcile): per-component coverage, catch-up
    framing, HepB birth-dose distinction; Egypt v2.1 remodel.

Theme of the latest run: **wiki + agent-rules canonicalization, then
cleanup lane committing all four workstreams. Repo is clean on `main`
after `5c57c6e`.**

## Workstream split (canonical classification)

The dirty state that survived the passport-isolation commit `8884e9e`
breaks down into **four** independent workstreams. Future agents must
not mix them in a single commit. Full rationale and recommended
commit sequencing are in
[`decisions/workstream-split-2026-05-22.md`](../decisions/workstream-split-2026-05-22.md).

### 1. Passport / export prototype — **fully committed**
Code landed at `8884e9e feat: add passport export prototype`:

- `web/app/passport/verify/page.tsx`
- `web/components/PassportIssueModal.tsx`
- `web/components/ExportPanel.tsx` (modification)
- `web/lib/passport/{bundle-mapping,issue,issue.test,keys,schema}.ts`

Dependencies landed at `8a841a6 chore(web): add passport and remotion
dependencies` (Option A — combined dep bump for passport + Remotion):

- Passport portion of `web/package.json` (`jose`, `qrcode.react`,
  `html5-qrcode`, + `lib/passport/issue.test.ts` test path).
- Corresponding `web/package-lock.json` entries.

### 2. Remotion / video prototype — **committed at `2633f79`**
All Remotion source landed at `2633f79 feat(video): add Remotion Hathor
compositions`:

- `web/remotion.config.ts`
- `web/remotion/Root.tsx`
- `web/remotion/AgentFanOut.tsx`
- `web/remotion/CostAnimation.tsx`
- `web/remotion/SafetyGates.tsx`
- `web/remotion/hathor60s/`

The Remotion portion of `web/package.json` (`@remotion/cli`,
`@remotion/renderer` devDeps + six `remotion:*` / `render:*` scripts)
and the matching `web/package-lock.json` entries landed together with
passport deps in `8a841a6`.

Remotion is application code under `web/`, distinct from the in-repo
`video/` directory and the Desktop `Hathor-video-assets` symlink
target — see the manifest's three-way distinction table.

### 3. Phase D safety-loop / HITL UI — **committed at `dd25b8a`**
- `web/app/scan/page.tsx`

Landed at `dd25b8a feat(scan): add Phase D review gate UI`. Diff
content: `CONFIDENCE_THRESHOLD` import from `@/lib/trust-gate`; new
`pendingReview` memo; new `reviewBlocked` gate that pauses
reconciliation, country-rules, and differences surfaces until clinician
resolution; new `<ReviewRequiredBanner>`; new `onConfirm` plumbing
through `DoseTable` → `DoseRow` with a "Keep as read" affordance
writing `clinician_action: "confirmed"`; tightened amber-styling rule
that respects clinician_action.

This implements the Phase D vision-safety-loop UI described in
`docs/SAFETY_LOOPS.md` and named in the project rules in
`CLAUDE.md` / `AGENTS.md`. It depends only on tracked
`@/lib/trust-gate`.

### 4. Shared / ambiguous — **all committed**
- `web/package.json` — committed at `8a841a6 chore(web): add passport
  and remotion dependencies`. Option A (combined dep bump) was applied:
  passport deps (`jose`, `qrcode.react`, `html5-qrcode`, passport test
  path) and Remotion devDeps (`@remotion/cli`, `@remotion/renderer` +
  six `remotion:*` / `render:*` scripts) committed together.
- `web/package-lock.json` — committed in the same `8a841a6` bump.
- `web/app/layout.tsx` — single-line `suppressHydrationWarning` on
  `<body>` committed at `5c57c6e chore(web): suppress body hydration
  warning` as standalone polish (no ambiguous workstream attribution
  needed — committed independently).

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

Resolved (no longer open):

- ~~Which dependency-split strategy?~~ → **Option A chosen**: combined
  passport + Remotion dep bump at `8a841a6`.
- ~~Which workstream owns `layout.tsx`?~~ → **committed standalone**
  at `5c57c6e` as generic polish.

All remaining questions marked **Ahmed decision needed**. Do not
resolve them in code without an explicit instruction.
