/**
 * Hathor60s — top-level Remotion composition for the 60-second vertical
 * short. Total: 60.000s · 1080×1920 · 30 fps · 1800 frames.
 *
 * Five scenes, eleven shots. Each scene component owns its internal
 * Sequence boundaries between shots; this file just stacks the scenes
 * end-to-end and overlays the burned-in caption track.
 *
 * Source of truth for the storyboard lives in
 * `video/hathor-60s-storyboard/` — that package is the authority on shot
 * intent, copy, and tone. The components in `./scenes/` are scaffolds.
 */

import { AbsoluteFill, Sequence } from "remotion";
import { C, FPS, HEIGHT, WIDTH, DURATION_FRAMES } from "./tokens";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Extract } from "./scenes/Extract";
import { Reconcile } from "./scenes/Reconcile";
import { Payoff } from "./scenes/Payoff";
import { Captions } from "./Captions";

export const HATHOR60S_FPS = FPS;
export const HATHOR60S_DURATION_FRAMES = DURATION_FRAMES;
export const HATHOR60S_WIDTH = WIDTH;
export const HATHOR60S_HEIGHT = HEIGHT;

export function Hathor60s() {
  // Scene durations (in seconds): 8, 10, 10, 15, 17 → 60s exact.
  const HOOK_F      = 8 * FPS;
  const PROBLEM_F   = 10 * FPS;
  const EXTRACT_F   = 10 * FPS;
  const RECONCILE_F = 15 * FPS;
  const PAYOFF_F    = 17 * FPS;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={HOOK_F} name="hook">
        <Hook />
      </Sequence>
      <Sequence from={HOOK_F} durationInFrames={PROBLEM_F} name="problem">
        <Problem />
      </Sequence>
      <Sequence
        from={HOOK_F + PROBLEM_F}
        durationInFrames={EXTRACT_F}
        name="extract"
      >
        <Extract />
      </Sequence>
      <Sequence
        from={HOOK_F + PROBLEM_F + EXTRACT_F}
        durationInFrames={RECONCILE_F}
        name="reconcile"
      >
        <Reconcile />
      </Sequence>
      <Sequence
        from={HOOK_F + PROBLEM_F + EXTRACT_F + RECONCILE_F}
        durationInFrames={PAYOFF_F}
        name="payoff"
      >
        <Payoff />
      </Sequence>

      {/* Burned-in captions (single track, derived from captions.srt). */}
      <Captions />
    </AbsoluteFill>
  );
}
