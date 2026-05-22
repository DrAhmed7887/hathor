/**
 * ScanSweep — a clean horizontal scanner line that translates over a region
 * once. Visualizes "the system is reading the card" in a clinical key:
 * thin amber rail with soft glow, no chromatic noise, no movie-FX vibes.
 *
 * The sweep is one-shot. Loop the parent if needed.
 */

import { interpolate } from "remotion";
import { C } from "../tokens";
import { EASE } from "../motion";

export function ScanSweep({
  frame,
  startFrame,
  durationFrames,
  height,
  width = "100%",
  thickness = 3,
  glow = 38,
}: {
  frame: number;
  startFrame: number;
  durationFrames: number;
  height: number;
  width?: number | string;
  thickness?: number;
  glow?: number;
}) {
  const t = interpolate(
    frame,
    [startFrame, startFrame + durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.linear },
  );
  const fade = interpolate(t, [0, 0.08, 0.92, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = t * height;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: "none",
        opacity: fade,
        overflow: "hidden",
      }}
    >
      {/* Thin scanline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: y,
          height: thickness,
          background: `linear-gradient(90deg, transparent 0%, ${C.beam} 18%, ${C.beamCore} 50%, ${C.beam} 82%, transparent 100%)`,
          mixBlendMode: "screen",
        }}
      />
      {/* Bloom under the scanline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: y - glow / 2,
          height: glow,
          background: `linear-gradient(180deg, transparent 0%, ${C.beam} 50%, transparent 100%)`,
          opacity: 0.35,
          filter: "blur(14px)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
