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

Theme of recent committed work: **reconciliation correctness + Pharos
visual alignment + scan-result verdict header.**

## Uncommitted work (do not stash, reset, or commit)

### Modified
- `web/app/layout.tsx`
- `web/app/scan/page.tsx`
- `web/components/ExportPanel.tsx`
- `web/package.json`
- `web/package-lock.json`

### Untracked (new)
- `web/app/passport/` — new passport / export route.
- `web/components/PassportIssueModal.tsx` — passport issuance modal.
- `web/lib/passport/` — passport helper module.
- `web/remotion.config.ts` — Remotion config (frontend code).
- `web/remotion/Root.tsx` — Remotion entry composition.
- `web/remotion/AgentFanOut.tsx` — agent fan-out animation.
- `web/remotion/CostAnimation.tsx` — cost animation.
- `web/remotion/SafetyGates.tsx` — safety-gates animation.
- `web/remotion/hathor60s/` — 60-second piece.

Remotion code lives under `web/remotion/` — it is application code,
not "video assets." The in-repo `video/` directory and the desktop
`Hathor-video-assets` folder are separate concerns; see the
manifest's three-way distinction table.

The git-state listing above is a point-in-time capture from
`git status` at wiki creation (2026-05-22). It may be corrected in
place if a specific entry is wrong, but do not wholesale-refresh it
from a later `git status` — that loses the snapshot's purpose. If
the in-flight picture has changed materially, add a new dated
current-status file alongside this one rather than overwriting this
list.

### Inferred in-flight initiatives
1. **Passport export feature** in `web/` — new route, modal, lib,
   and `ExportPanel` edits all point to a shareable
   passport/credential output. **Ahmed decision needed** on intended
   scope and whether the underlying data should ever leave the
   browser.
2. **Remotion video pipeline** — fresh `remotion/` directory and
   `remotion.config.ts`, plus `package.json` deltas (likely Remotion
   deps). Complements `video/` (scripts) and the desktop
   `Hathor-video-assets` (raw media). **Ahmed decision needed** on
   whether Remotion replaces or augments the DaVinci flow.
3. **Layout-level touches** in `app/layout.tsx` and `scan/page.tsx`
   — likely to wire the new passport route into the global surface.
   Read the diff before touching either file.

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
- Is the current uncommitted work intended for a single commit, or
  should it split into a passport PR and a Remotion PR?

All four are marked **Ahmed decision needed**. Do not resolve them
in code without an explicit instruction.
