# Wiki Change Log

Append-only. One line per change. Format:

`YYYY-MM-DD — path/relative/to/_llm_wiki — one-sentence reason`

---

- 2026-05-22 — `CLAUDE.md` — Created. Encodes read-order, hard rules, and update protocol for the wiki.
- 2026-05-22 — `index.md` — Created. Wiki map and quick agent checklist.
- 2026-05-22 — `source_registry.md` — Created. External and in-repo authorities the wiki cites.
- 2026-05-22 — `decisions/source-of-truth-2026-05-22.md` — Created. Marks `projects/hathor` as candidate source of truth and `Desktop/Hathor-video-assets` as related media.
- 2026-05-22 — `manifests/repo-map-2026-05-22.md` — Created. Snapshot of top-level repo areas and what they own.
- 2026-05-22 — `projects/current-status-2026-05-22.md` — Created. Captures uncommitted work and in-flight initiatives at wiki-creation time.
- 2026-05-22 — `log.md` — Created. This file.
- 2026-05-22 — `CLAUDE.md`, `index.md`, `source_registry.md`, `decisions/source-of-truth-2026-05-22.md`, `manifests/repo-map-2026-05-22.md`, `projects/current-status-2026-05-22.md` — Codex review correction pass: reconciled AGENTS.md vs CLAUDE.md as co-canonical (Codex / Claude), removed `~/.claude` from active authorities (forbidden tool-state source), clarified wiki update policy (log append-only, decisions preserved/superseded, other docs editable in place), and corrected the Remotion / video / Desktop-assets three-way mapping.
- 2026-05-22 — `CLAUDE.md`, `index.md`, `source_registry.md`, `manifests/repo-map-2026-05-22.md`, `projects/current-status-2026-05-22.md` — Final correction pass after second Codex review: removed remaining "do not edit in place" lines from `repo-map` and `current-status` headers so the living-snapshot policy is consistent across all files; deleted the `~/.claude/projects/.../memory/` citation in `current-status` and replaced with policy-correct prior-agent-context wording; made model defaults stack-specific (Claude stack `claude-opus-4-7`; Codex stack untracked, template artifact, Ahmed decision needed); disambiguated project-local `.claude/` from user-level `~/.claude` (former is not-an-active-authority, latter is forbidden); marked root `AGENTS.md` as currently untracked candidate (not committed canon); changed `web/AGENTS.md` description to agent-neutral wording; clarified `video/assets-on-desktop/` is a verified symlink and hedged tracked/untracked claims with "per `git status` at wiki creation."
- 2026-05-22 — `index.md`, `manifests/repo-map-2026-05-22.md` — Final gate wording fix: reconciled Desktop Hathor-video-assets with `video/assets-on-desktop` symlink.
- 2026-05-22 — `index.md`, `manifests/repo-map-2026-05-22.md` — Final gate wording fix: clarified that Desktop Hathor-video-assets is referenced by `video/assets-on-desktop/` and both symlink and target are read-only unless Ahmed explicitly approves changes.
- 2026-05-22 — `AGENTS.md`, `index.md`, `source_registry.md` — Corrected root AGENTS.md from a template-derived Codex candidate into a general-agent rules file candidate pending commit; removed fake Codex model names and documented operator/tool-configured model guidance.
