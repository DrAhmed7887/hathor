# Decision — Hathor dirty-work split into four independent workstreams (2026-05-22)

**Status:** preserved snapshot. Records the canonical workstream split
discovered during the passport-isolation pass and the dependency
strategy options Ahmed must choose between before any further source
commit proceeds.

## Decision

The Hathor working copy on 2026-05-22 contained code from **four
independent workstreams** entangled in a single dirty state. They must
not be mixed in a single commit. Future agents that find dirty files
matching the lists below must classify them against this decision
file first.

The four workstreams are:

| # | Workstream | Status at 2026-05-22 after commit `8884e9e` |
|---|---|---|
| 1 | Passport / export prototype | Code committed; deps deferred. |
| 2 | Remotion / video prototype | All dirty (untracked). |
| 3 | Phase D safety-loop / HITL UI | All dirty (modified). |
| 4 | Shared / ambiguous package + layout | All dirty; special handling. |

The full file-level classification is mirrored in
`projects/current-status-2026-05-22.md`; the lists here are the
canonical source if the two ever drift.

## Workstream 1 — Passport / export prototype

**Already committed** at `8884e9e feat: add passport export prototype`:

- `web/app/passport/verify/page.tsx`
- `web/components/PassportIssueModal.tsx`
- `web/components/ExportPanel.tsx` (modification)
- `web/lib/passport/bundle-mapping.ts`
- `web/lib/passport/issue.ts`
- `web/lib/passport/issue.test.ts`
- `web/lib/passport/keys.ts`
- `web/lib/passport/schema.ts`

Pending: passport portion of `web/package.json` and the matching
`web/package-lock.json` entries — see Workstream 4 / Options below.

## Workstream 2 — Remotion / video prototype

All currently dirty (untracked):

- `web/remotion.config.ts`
- `web/remotion/Root.tsx`
- `web/remotion/AgentFanOut.tsx`
- `web/remotion/CostAnimation.tsx`
- `web/remotion/SafetyGates.tsx`
- `web/remotion/hathor60s/`

Plus the Remotion portion of `web/package.json`:

- devDeps: `@remotion/cli ^4.0.451`, `@remotion/renderer ^4.0.451`
- scripts: `remotion:studio`, `render:fanout`, `render:cost`,
  `render:gates`, `render:hathor60s`, `render:all`

Recommended commit when Ahmed is ready:
`feat: scaffold Remotion video pipeline`.

Note the wiki-canon distinction: `web/remotion/` is **application
code**, not "video assets." The in-repo `video/` directory is the
production / render workflow; the Desktop `Hathor-video-assets`
folder reached via the `video/assets-on-desktop` symlink holds the
external media. See the manifest's three-way distinction table.

## Workstream 3 — Phase D safety-loop / HITL UI

All currently dirty (modified):

- `web/app/scan/page.tsx`

Diff content summary:

- Imports `CONFIDENCE_THRESHOLD` from `@/lib/trust-gate`.
- Adds `pendingReview` memo: rows below confidence threshold that the
  clinician has not yet resolved.
- Adds `reviewBlocked` gate that pauses the reconciliation,
  country-rules, and differences surfaces until every flagged row is
  resolved.
- Adds a `<ReviewRequiredBanner>` (amber, Phase D framing) that
  explains the pause and the resolution affordance.
- Adds an `onConfirm` prop pipeline through `DoseTable` → `DoseRow`
  with a per-row "Keep as read" button that writes
  `clinician_action: "confirmed"` with a timestamp.
- Tightens the amber-styling rule so it respects
  `clinician_action` (edited / confirmed → green).

This is the **Phase D vision-safety-loop UI** named in
`docs/SAFETY_LOOPS.md` and required by both `CLAUDE.md` and
`AGENTS.md`. It is **not** part of passport scope, despite the
original goal's hypothesis that it might be. It depends only on
tracked `@/lib/trust-gate` and stands alone.

Recommended commit:
`feat(scan): wire Phase D review-resolution UI`.

## Workstream 4 — Shared / ambiguous files

### `web/package.json` and `web/package-lock.json` — **the blocker**

The dirty `web/package.json` mixes Workstream 1 and Workstream 2
additions in a single diff:

| Belongs to | What |
|---|---|
| Passport (#1) | deps `jose`, `qrcode.react`, `html5-qrcode`; appends `lib/passport/issue.test.ts` to the `test` script. |
| Remotion (#2) | devDeps `@remotion/cli`, `@remotion/renderer`; six `remotion:*` / `render:*` scripts. |

`web/package-lock.json` (3321/861 line diff) derives mechanically
from the mixed `package.json` and cannot be split cleanly without
re-running `npm install` on the chosen subset.

**Rule:** source commits must not stage `web/package.json` or
`web/package-lock.json` until Ahmed chooses a dependency strategy
(Options A / B / C below). Until then, both passport-code commit
(`8884e9e`) and any future Remotion-code commit produce branches
that need a follow-up dep commit before they will build on a fresh
checkout.

### `web/app/layout.tsx` — ambiguous polish

Single-line `suppressHydrationWarning` addition on `<body>`. Three
plausible owners:

- **Passport** — `html5-qrcode` mutates the DOM directly, which can
  trip Next 16's hydration check.
- **Remotion** — preview iframes can hydrate.
- **Generic polish** — could simply be Ahmed cleaning up a Next 16
  warning unrelated to either feature.

**Ahmed decision needed** on attribution. Attaching to the passport
or Remotion commit at the time of the dep-commit is the lowest-cost
option.

## Recommended commit-strategy options

Three options are on the table; all are safe, none is unambiguously
best.

### Option A — Single combined dep commit, code first

1. Commit Workstream 1 code (already done at `8884e9e`).
2. Commit Workstream 3 code: `feat(scan): wire Phase D review-resolution UI`.
3. Commit Workstream 2 code: `feat: scaffold Remotion video pipeline`.
4. Commit the full dirty `web/package.json` + `web/package-lock.json`
   as a single dep-bump: `chore(web): add passport + remotion deps`.

Pros: simplest; no `npm install` between commits; preserves the
existing lockfile diff. Cons: each of commits 1–3 produces a
branch that does not build until commit 4 lands; reviewers must
read across four commits to understand the dep additions.

### Option B — Split `package.json` manually, regenerate lockfile, passport-first

1. Open `web/package.json` and remove the Remotion lines (devDeps +
   six scripts). Keep the passport additions.
2. Run `npm install` to regenerate `web/package-lock.json` from the
   passport-only `package.json`.
3. Commit Workstream 1 deps alongside (or amended onto) `8884e9e`:
   `chore(web): add passport deps`.
4. Restore the Remotion lines to `web/package.json`.
5. Run `npm install` again to regenerate the lockfile with both
   passport and Remotion deps present.
6. Commit Workstream 2 code + Remotion deps:
   `feat: scaffold Remotion video pipeline`.
7. Commit Workstream 3 code separately.

Pros: passport branch builds standalone; cleaner per-PR history.
Cons: requires two `npm install` runs and careful manual editing of
`package.json`; risk of lockfile drift; lockfile churn appears in
both dep commits.

### Option C — Combine passport code with a passport-only dep commit; reset Remotion separately

1. Edit `web/package.json` to remove the Remotion additions, keeping
   passport.
2. Run `npm install` to regenerate the lockfile (passport-only).
3. Either amend `8884e9e` or add a follow-up commit that includes
   the passport-only `package.json` + lockfile:
   `chore(web): add passport deps` (or amend to
   `feat: add passport export prototype` if Ahmed prefers a fused
   single passport commit).
4. Later, treat Remotion as a fully new workstream: re-add Remotion
   deps to `package.json`, `npm install`, commit Remotion code +
   deps together.

Pros: passport ships as a clean, self-building unit; less ambiguity
about which deps belong to which feature. Cons: amending the
already-pushed `8884e9e` is destructive history-rewriting (only
viable if `8884e9e` is not yet on a shared branch); two `npm install`
runs; Remotion's package-lock baseline shifts after passport lands.

## Hard constraints carried forward

These are the rules an agent acting on this decision must honor:

- Do not edit source code beyond what each commit's stated scope
  requires.
- Do not stage `web/package.json` / `web/package-lock.json` while
  they still mix workstreams.
- Do not run `npm install` without Ahmed's explicit instruction; the
  wiki's general policy is that lockfile-mutating commands need
  user authorization.
- Do not `git push`, `pull`, `branch`, `stash`, `reset`, `clean`,
  `rebase`, `merge`, `tag`. The commits prescribed in each option
  are local-only until Ahmed pushes.
- Workstreams 2, 3, 4 stay strictly separate from passport in
  commits. Mixing forfeits reviewability.

## Pointers

- Passport commit: `8884e9e feat: add passport export prototype`.
- Earlier wiki/docs commits: `eda03a4 docs: reconcile Hathor agent instructions`, `eea3027 docs: add general agent instructions`, `fc455a1 docs: add Hathor LLM wiki`.
- Project rules: repo-root `CLAUDE.md` (Claude Code), `AGENTS.md`
  (general agents), `web/AGENTS.md` (Next 16 frontend).
- Safety-loop reference: `docs/SAFETY_LOOPS.md`.
- Wiki manifest: `manifests/repo-map-2026-05-22.md`.
- Mirror of this split in the projects ledger:
  `projects/current-status-2026-05-22.md`.
