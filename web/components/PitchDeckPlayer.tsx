"use client";

/**
 * Client wrapper for the PitchDeck Remotion composition.
 *
 * Hosted by /pitch. Full-bleed, autoPlay, controls ON (the pitch
 * audience or presenter may want to pause and step through slides
 * live). loop=false so the final slide holds.
 */

import { Player } from "@remotion/player";
import {
  PitchDeck,
  PITCH_DURATION_FRAMES,
  PITCH_FPS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
} from "@/remotion/PitchDeck";

export interface PitchDeckPlayerProps {
  autoPlay?: boolean;
  loop?: boolean;
}

export function PitchDeckPlayer({
  autoPlay = true,
  loop = false,
}: PitchDeckPlayerProps) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: `${PITCH_WIDTH} / ${PITCH_HEIGHT}`,
        maxWidth: "min(100%, calc(100vh * 16 / 9))",
        margin: "0 auto",
        border: "1px solid #E7E2DA",
        overflow: "hidden",
      }}
    >
      <Player
        component={PitchDeck}
        durationInFrames={PITCH_DURATION_FRAMES}
        fps={PITCH_FPS}
        compositionWidth={PITCH_WIDTH}
        compositionHeight={PITCH_HEIGHT}
        autoPlay={autoPlay}
        loop={loop}
        clickToPlay
        controls
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
