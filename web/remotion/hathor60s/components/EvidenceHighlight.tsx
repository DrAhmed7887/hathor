/**
 * EvidenceHighlight — restrained outline that draws around an evidence
 * point (a date, a field, a chip). Used to guide attention without
 * shouting: stroke draws on with stroke-dasharray, holds, then fades.
 *
 * One per shot at most. Stack only if you mean it.
 */

import { interpolate } from "remotion";
import { C } from "../tokens";
import { EASE } from "../motion";

export function EvidenceHighlight({
  frame,
  startFrame,
  width,
  height,
  left,
  top,
  tone = "warn",
  hold = 30,
  drawIn = 18,
  fadeOut: fadeOutFrames = 16,
  radius = 8,
}: {
  frame: number;
  startFrame: number;
  width: number;
  height: number;
  left: number;
  top: number;
  tone?: "warn" | "ok" | "ink";
  hold?: number;
  drawIn?: number;
  fadeOut?: number;
  radius?: number;
}) {
  const color = tone === "warn" ? C.warn : tone === "ok" ? C.ok : C.ink;

  const drawT = interpolate(frame, [startFrame, startFrame + drawIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });
  const fade = interpolate(
    frame,
    [
      startFrame,
      startFrame + 4,
      startFrame + drawIn + hold,
      startFrame + drawIn + hold + fadeOutFrames,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const peri = 2 * (width + height);
  const dashOffset = peri * (1 - drawT);

  return (
    <svg
      width={width + 6}
      height={height + 6}
      style={{
        position: "absolute",
        left: left - 3,
        top: top - 3,
        pointerEvents: "none",
        opacity: fade,
        overflow: "visible",
      }}
    >
      <rect
        x={3}
        y={3}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray={peri}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
      />
    </svg>
  );
}
