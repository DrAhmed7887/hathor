"use client";

/**
 * Client wrapper for the ExplainerParse Remotion composition.
 *
 * Mounted via ParsedResults.headerSlot in /demo (see step 7's
 * pre-reserved prop). Plays once, freezes on the closing caption.
 */

import { Player } from "@remotion/player";
import {
  ExplainerParse,
  EXPLAIN_DURATION_FRAMES,
  EXPLAIN_FPS,
  EXPLAIN_HEIGHT,
  EXPLAIN_WIDTH,
} from "@/remotion/ExplainerParse";

export interface ExplainerParsePlayerProps {
  maxWidth?: number;
  autoPlay?: boolean;
  loop?: boolean;
}

export function ExplainerParsePlayer({
  maxWidth = 1040,
  autoPlay = true,
  loop = false,
}: ExplainerParsePlayerProps) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth,
        margin: "0 auto",
        aspectRatio: `${EXPLAIN_WIDTH} / ${EXPLAIN_HEIGHT}`,
        border: "1px solid #E7E2DA",
        overflow: "hidden",
      }}
    >
      <Player
        component={ExplainerParse}
        durationInFrames={EXPLAIN_DURATION_FRAMES}
        fps={EXPLAIN_FPS}
        compositionWidth={EXPLAIN_WIDTH}
        compositionHeight={EXPLAIN_HEIGHT}
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
