/**
 * Single-stylistic-flourish: a faint Pharos-style lighthouse beam.
 * Per storyboard tone discipline, this motif appears ONLY in:
 *   - hook-1 (one slow sweep across the right edge of the card)
 *   - payoff-2 (one slow quarter-rotation behind the wordmark)
 * It does not appear in any other shot.
 */

import { interpolate } from "remotion";
import { C } from "./tokens";

type Props = {
  /** Local frame within the parent <Sequence>. */
  frame: number;
  /** Total local frames over which the sweep happens. */
  durationFrames: number;
  /** Origin x/y in viewport-relative units (0..1). */
  originX: number;
  originY: number;
  /** Start and end angle in degrees (0 = pointing right). */
  fromDeg: number;
  toDeg: number;
  /** Beam length and width in px. */
  length?: number;
  width?: number;
  /** Optional opacity multiplier. */
  intensity?: number;
};

export function PharosBeam({
  frame,
  durationFrames,
  originX,
  originY,
  fromDeg,
  toDeg,
  length = 1600,
  width = 320,
  intensity = 1,
}: Props) {
  const t = Math.max(0, Math.min(1, frame / durationFrames));
  const angle = fromDeg + (toDeg - fromDeg) * easeOutCubic(t);

  // Fade in at start, fade out near the end — a single sweep, no loop.
  const fade = interpolate(
    t,
    [0, 0.15, 0.85, 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: `${originX * 100}%`,
        top: `${originY * 100}%`,
        width: 0,
        height: 0,
        pointerEvents: "none",
        opacity: fade * intensity,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -width / 2,
          width: length,
          height: width,
          transformOrigin: "0% 50%",
          transform: `rotate(${angle}deg)`,
          background: `linear-gradient(90deg, ${C.beamCore} 0%, ${C.beam} 35%, rgba(251,191,36,0.0) 100%)`,
          filter: "blur(28px)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
