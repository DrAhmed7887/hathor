"use client";

/**
 * Client-side wrapper around the HeroIntro Remotion composition.
 *
 * Kept in components/ rather than remotion/ because it imports
 * @remotion/player (runtime, browser-only) while the composition
 * itself in remotion/HeroIntro.tsx imports only `remotion` (which
 * works in both browser Player and server-side rendering contexts).
 */

import { Player } from "@remotion/player";
import {
  HeroIntro,
  HERO_DURATION_FRAMES,
  HERO_FPS,
  HERO_HEIGHT,
  HERO_WIDTH,
} from "@/remotion/HeroIntro";

export interface HeroIntroPlayerProps {
  /** Upper bound on the rendered width — the Player scales to this
   * and preserves the 16:9 aspect. */
  maxWidth?: number;
  autoPlay?: boolean;
  loop?: boolean;
}

export function HeroIntroPlayer({
  maxWidth = 900,
  autoPlay = true,
  loop = false,
}: HeroIntroPlayerProps) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth,
        margin: "0 auto",
        aspectRatio: `${HERO_WIDTH} / ${HERO_HEIGHT}`,
        border: "1px solid #E7E2DA",
        overflow: "hidden",
      }}
    >
      <Player
        component={HeroIntro}
        durationInFrames={HERO_DURATION_FRAMES}
        fps={HERO_FPS}
        compositionWidth={HERO_WIDTH}
        compositionHeight={HERO_HEIGHT}
        autoPlay={autoPlay}
        loop={loop}
        clickToPlay={false}
        controls={false}
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
