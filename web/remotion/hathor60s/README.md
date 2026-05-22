# `hathor60s` — Remotion scaffold for the 60-second vertical short

Source-of-truth storyboard package: `video/hathor-60s-storyboard/`. This
folder is the **first scaffold** that compiles that storyboard into a
runnable Remotion composition. It is intentionally minimal — placeholder
geometry where real product UI captures will go, captions wired from the
locked SRT, exact 60-second timing.

> **Status:** scaffold. Do not export an MP4 as a final video yet; several
> shots still require real screen captures. See "What's still needed" below.

## Layout

```
remotion/hathor60s/
├── Hathor60s.tsx          # top-level composition, stacks 5 scenes
├── tokens.ts              # design tokens, FPS, dimensions, shot table
├── caption-data.ts        # parsed cues (mirror of captions.srt)
├── Captions.tsx           # burned-in caption overlay
├── PharosBeam.tsx         # the only stylistic flourish (hook-1, payoff-2)
├── Placeholder.tsx        # "TODO: capture" placeholder card
└── scenes/
    ├── Hook.tsx           # hook-1, hook-2 (8s)
    ├── Problem.tsx        # problem-1, problem-2 (10s)
    ├── Extract.tsx        # extract-1, extract-2 (10s)
    ├── Reconcile.tsx      # reconcile-1, reconcile-2, reconcile-3 (15s)
    └── Payoff.tsx         # payoff-1, payoff-2 (17s)
```

Format: **9:16 vertical · 1080×1920 · 30 fps · 1800 frames (60.000s)**.

The composition is registered in `web/remotion/Root.tsx` as id `Hathor60s`.
Existing compositions (`AgentFanOut`, `CostAnimation`, `SafetyGates`,
`HeroIntro`, `PitchDeck`, `ExplainerParse`) are untouched.

## Preview (Remotion Studio)

From `web/`:

```bash
npm run remotion:studio
```

Then pick `Hathor60s` from the sidebar. Studio gives you a live preview of
each shot; pan the timeline to inspect transitions.

## Render to MP4

> Only after the asset gaps below are filled and `qa-checklist.md` is
> re-walked. **Do not ship a stylized mock as if it were product UI.**

```bash
npm run render:hathor60s
# → ../video/hathor-60s-storyboard/out/hathor-60s.mp4
```

The output path is per `render-notes.md`. Codec is h264, CRF 18.

## What's still needed before a final export

These items come from `render-notes.md` and `qa-checklist.md`. The scaffold
intentionally does not paper over any of them.

| Shot         | Asset / capture                                                                                  | Where to get it |
|--------------|--------------------------------------------------------------------------------------------------|-----------------|
| `hook-1`     | Photo of a synthetic paediatric vaccine card on a plain desk                                     | Pick from `/cards/` or photograph a synthetic prop. No real patient data. |
| `hook-2`     | Same card centered with Source / Destination labels                                              | Same photo as hook-1, restaged. |
| `problem-1`  | Stylized regional path                                                                           | Current scaffold uses an abstract SVG region; replace if a designed asset exists. |
| `problem-2`  | Over-the-shoulder framing of clinician's hand on the card                                        | Photo capture. Suggest using the same synthetic card. |
| `extract-1`  | Real extraction-table screen capture with non-numeric ("high"/"low") chips, *or* a real run with reproducible numeric values | `web/app/scan` once the extraction view is capture-ready. |
| `extract-2`  | Real Phase D HITL review tray for a low-confidence field                                         | `web/app/scan` (HITL panel). Must match the same synthetic card as extract-1. |
| `reconcile-1`| Two-rail layout with real Nigeria → Egypt mappings from `data/`                                  | `web/app/reconcile`. Doses must come from the schedules in `data/`, not invented. |
| `reconcile-2`| Per-antigen Coverage view from `web/`                                                            | `web/app/reconcile` (Coverage panel introduced in commit `19d1cd7`). |
| `reconcile-3`| Stylized rules-engine gate                                                                       | Scaffold uses a structural placeholder. Rule IDs shown are *placeholders* (`DAK-IMM-OPV-1.0` etc.) — replace with **real DAK rule IDs from the engine** before export. |
| `payoff-1`   | Real clinician review panel from `web/app/reconcile`                                             | Capture the real reconcile output for a synthetic Nigeria → Egypt case. |
| `payoff-2`   | Hathor wordmark file + Pharos beam motif                                                         | Wordmark file pending; current shot uses the system-font wordmark as a placeholder. |

Other gates from `render-notes.md`:

- VO recording at 48 kHz / 24-bit, mono, −16 LUFS integrated.
- After VO is locked, re-time `captions.srt` against the waveform, then
  update `caption-data.ts` to match (it is a hand-mirror of the SRT).
- A low atmospheric bed (≤ −24 LUFS, no melodic motif) is acceptable;
  no music drop, no stings.

## Honesty posture preserved by this scaffold

Per the storyboard's `notes` block and `script.md`'s "What this script does
NOT say" section:

- **No accuracy / recall / precision / latency numbers** appear anywhere
  in the components.
- **No "first / only / fastest / most accurate"** claims.
- **No WHO / CDC / MoH / IHME endorsement language**.
- **No country pair other than Nigeria → Egypt** (Phase 1 scope per
  `CLAUDE.md`).
- The on-card details, rail mappings, and rule IDs are **clearly marked as
  placeholders** in the source comments — they exist so the scaffold
  renders, not as claims about the system.

If a future revision adds any number on screen, the storyboard's
`NEEDS_SOURCE` list must be updated first — not the components.

## Caption sync

`captions.srt` is the human source of truth. `caption-data.ts` mirrors it
in TypeScript so Remotion can drive it without filesystem reads. If the
SRT is re-timed against a locked VO take, port the new timestamps into
`caption-data.ts` (the cues are listed in the same order; conversion is
`Math.round(seconds * FPS)`).

## Risks / TODOs

- **Beam motif tone.** `PharosBeam` is intentionally subtle and only
  appears in `hook-1` and `payoff-2`. If it reads as decorative or
  distracts from the clinical posture, dial `intensity` down or remove it.
- **`reconcile-3` is the most clinically loaded shot.** Per
  `engine-decision.md`, if the SVG/DOM rendition reads as toy, revisit.
  Do not let visual style undermine the line "every output is checked by
  deterministic rules."
- **Synthetic card on screen.** The scaffold renders an inline DOM card.
  If the camera asset arrives, replace `CardProp` in `scenes/Hook.tsx`
  with `<Img src={staticFile('hathor60s/card.jpg')} />` and put the file
  in `web/public/hathor60s/`.
- **System-font wordmark.** Replace with a tracked logo file in
  `web/public/hathor60s/wordmark.svg` once available.
- **No audio is wired into the composition.** When VO and atmos bed are
  locked, add `<Audio src={staticFile('hathor60s/vo.wav')} />` inside
  `Hathor60s.tsx` (and an atmos `<Audio>` with `volume` ramped down per
  the music/SFX policy). They can live behind the same `staticFile` flow.

## Related infrastructure

- `web/remotion/SafetyGates.tsx` is a pre-existing landscape (1920×1080)
  composition with its own dark "neon" styling. It is **not** reused by
  `hathor60s` because the 60s short demands a neutral high-trust palette
  (see `tokens.ts`). The two compositions intentionally look different.
- `video/hathor-60s-storyboard/qa-checklist.md` is the exit criteria
  before a final MP4 ships. Re-walk it before the export gate, not after.
