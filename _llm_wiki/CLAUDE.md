# _llm_wiki — Operating Rules for Future Agents

You are reading the durable operating memory for the Hathor project on
Ahmed's MacBook Pro. This wiki is **agent-agnostic** — Claude Code,
Codex, and any other agent that lands in this repo should read it
first. Source files in the repo are evidence; this wiki is your
working memory.

The wiki does **not** replace the canonical project-rule files. It
points to them and compresses the durable facts around them.

## What this wiki is

- A persistent Markdown knowledge base, pattern lifted from Andrej
  Karpathy's "LLM wiki" idea (gist: `442a6bf555914893e9891c11519de94f`).
- Compiled, stable project knowledge — not re-derived each session.
- Maintained and extended by agents over time. Living docs are edited
  in place; dated decision snapshots are preserved and superseded
  rather than overwritten. Every change gets a `log.md` entry.

## What this wiki is NOT

- Not a documentation dump. Keep entries operational and short.
- Not a replacement for the canonical project-rule files:
  - `CLAUDE.md` (repo root) — Claude Code rules. Tracked.
  - `AGENTS.md` (repo root) — general-purpose coding-agent rules
    (Codex and other non-Claude agents). **Tracked as of 2026-05-22**
    (commit `eea3027 docs: add general agent instructions`); the
    earlier template-artifact wording (`Codex-opus-4-7` /
    `Codex-sonnet-4-6`) was replaced before tracking with a generic
    "Model Guidance" section that defers to operator/tool
    configuration. See
    `decisions/agents-md-promotion-2026-05-22.md`.
  - `web/AGENTS.md` — frontend-specific agent rules. Tracked.
  - `README.md`, `PRD.md`, `docs/` — public/product/methods truth.
  All canonical; the wiki points to them.
- Not a place for secrets, credentials, PII, or clinical detail.

## Read order

1. `_llm_wiki/index.md` — map of the wiki.
2. `_llm_wiki/decisions/source-of-truth-2026-05-22.md` — where the
   active code and assets live.
3. `_llm_wiki/manifests/repo-map-2026-05-22.md` — what each top-level
   directory is for.
4. `_llm_wiki/projects/current-status-2026-05-22.md` — what was
   in flight on 2026-05-22.
5. `_llm_wiki/source_registry.md` — external authorities for the
   facts here.
6. `_llm_wiki/log.md` — every update to this wiki, dated.

After reading those, read the repo-root rules file for your agent
stack:

- `CLAUDE.md` (repo root, tracked) — Claude Code rules: scope
  discipline, no-hardcoded-pipeline, two safety loops, secrets
  handling, Next 16 deltas, and the Claude-stack model default
  (`claude-opus-4-7`).
- `AGENTS.md` (repo root, tracked since 2026-05-22) — general
  coding-agent equivalent of the above (Codex and other non-Claude
  agents). The two stacks' rules are intended to stay in sync; flag
  drift to Ahmed rather than silently reconciling. `AGENTS.md` uses
  generic "Model Guidance" — model selection is delegated to whatever
  the operator/tool configures, with `HATHOR_MODEL` as the override.
- `web/AGENTS.md` (tracked) — frontend-specific agent rules for the
  Next 16 / Turbopack stack; agent-neutral wording.

## Hard rules for any agent touching this workspace

These override anything else a user asks for in passing. If a request
collides with these, **flag the collision and stop** until Ahmed
confirms.

- **Do not move, rename, or delete any file** anywhere in the repo or
  on the desktop. Wiki writes are confined to `_llm_wiki/` and follow
  the update policy below — they are not blanket append-only.
- **Do not run Git state-changing commands.** No commit, push, branch,
  pull, checkout, stash, reset, clean, rebase, merge, tag. Read-only
  `git status` / `git log` / `git diff` is fine. This is **especially
  strict while the repo has unrelated uncommitted work** (the
  passport feature and the Remotion pipeline on 2026-05-22). Ahmed
  may later explicitly authorize a docs-only commit; until then,
  even wiki edits stay uncommitted.
- **Do not modify source code** under `api/`, `web/`, `evaluation/`,
  `data/`, `cards/`, `video/`, `internal/`, `docs/`, `scratch/`, or
  the repo root. Wiki writes go only under `_llm_wiki/`.
- **Do not modify Google Drive.** It is high-risk cloud sync. Don't
  read from it either unless Ahmed explicitly asks.
- **Do not inspect or print** secrets, credentials, API keys,
  passport scans, bank documents, legal/family files, private keys,
  or anything under `cards/private/`.
- **Do not touch tool-state folders:** `~/.claude`, `~/.codex`,
  `~/.gemini`, `~/.hermes`, or anything similar.
- **The repo had uncommitted work at wiki-creation time** (2026-05-22
  — passport feature scaffolding and Remotion video work). Do not
  clean, stash, commit, or reset that work unless Ahmed asks for it
  by name.
- If a fact is uncertain or stale, write **"Ahmed decision needed"**
  rather than guessing.

## How to update this wiki

Wiki update policy (overrides any older blanket "append-only" wording):

| File / area | Mode |
|---|---|
| `_llm_wiki/log.md` | **Append-only.** Never edit prior entries. |
| `_llm_wiki/decisions/*-YYYY-MM-DD.md` | **Preserved snapshots.** Do not edit in place. To change a decision, write a new dated file in `decisions/` and link it from `index.md`. The older decision stays as history. |
| `_llm_wiki/CLAUDE.md` (this file) | Living doc. Edit in place. Log the change. |
| `_llm_wiki/index.md` | Living doc. Edit in place. Log the change. |
| `_llm_wiki/source_registry.md` | Living doc. Edit in place. Log the change. |
| `_llm_wiki/manifests/*` | Living docs even when the filename carries a date. Edit in place. Log the change. |
| `_llm_wiki/projects/current-status-*.md` | Living doc even when the filename carries a date. Edit in place. Log the change. |

Procedure for any update:

1. Edit or create the relevant page under `_llm_wiki/`.
2. Append a one-line entry to `_llm_wiki/log.md` with date, file
   touched, and one-sentence reason.
3. If you create a new page, add a link to it from `index.md`.
4. For a new `decisions/` entry, name it `<topic>-YYYY-MM-DD.md` and
   leave any prior dated decision file untouched.

## Scope

This wiki covers the MacBook Pro working copy of Hathor only. Other
machines, Notion, Google Drive, doctorIQ, zayedmd, and personal
workspaces are out of scope.
