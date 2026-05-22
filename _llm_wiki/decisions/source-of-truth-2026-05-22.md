# Decision — Source of Truth for Hathor (snapshot 2026-05-22)

**Status:** candidate. Confirmed by Ahmed's audits as the active
MacBook Pro working copy on 2026-05-22. Treat as authoritative until
explicitly superseded.

## Decision

The single working copy of Hathor on this MacBook Pro is:

```
/Users/ahmedzayed/projects/hathor
```

All future agent work happens here. No other directory on this Mac
should be treated as an alternate Hathor codebase, and no merges
between locations are to be attempted.

## Related media and video work (not source of truth, but adjacent)

Three distinct things live around the video work — keep them straight:

1. **`/Users/ahmedzayed/projects/hathor/web/remotion/`** — Remotion
   source code and compositions. This is application code, lives in
   `web/`, and is governed by `web/AGENTS.md` like the rest of the
   frontend. Not a "video assets" folder.

2. **`/Users/ahmedzayed/projects/hathor/video/`** — in-repo video
   production area: scripts (`script_v1.md` → `v3`), prompts,
   storyboards, render workflow (`render_final.sh`,
   `generate_final_xml.mjs`, `davinci_build.py`), capture scripts,
   FCP/DaVinci XML, HTML overlays, voiceover. Production tooling,
   not Remotion code.

3. **`/Users/ahmedzayed/Desktop/Hathor-video-assets`** — external
   related media. Clips, B-roll, DaVinci Resolve project backups,
   voiceover audio, submission packaging. Numbered subfolders
   `01-proof-terminal` through `12-final-submission` track
   production stages. **Not part of the repo and not synced into
   it.** Reference read-only; do not move, rename, or copy its
   contents into the repo without Ahmed's explicit approval.

**Ahmed decision needed** on whether the in-repo `video/` directory
and the Desktop assets folder should be unified long-term or stay
split. The `web/remotion/` location is settled.

## Repo state at the moment of the decision

The working copy had **uncommitted changes** on 2026-05-22. See
`projects/current-status-2026-05-22.md` for the file list. Because of
this:

- **Do not** run `git stash`, `git reset`, `git clean`, `git checkout
  --`, or any operation that would discard or rewrite the working
  tree.
- **Do not** run `git commit` unless Ahmed explicitly asks. The
  uncommitted work spans a new passport feature and a new Remotion
  video pipeline — both are in-progress and should not be packaged
  by an agent.
- **Do not** branch, push, or pull. The branch is `main`; the most
  recent commits are reconcile / scan / Pharos work.

## Forbidden zones

Reaffirmed here for the agent that lands cold on this decision page:

- Google Drive — high-risk cloud sync. Do not read or write.
- `~/.claude`, `~/.codex`, `~/.gemini`, `~/.hermes` — tool state.
  Do not read or write.
- `cards/private/` inside the repo — private vaccination cards.
- Anything labelled secret, credential, passport, bank, legal, family,
  or private key. If you can see it in a path, that is enough — stop.

## What can change this decision

A future Ahmed instruction such as "the source of truth is now X" or
"merge these two copies." Until then, this page stands.
