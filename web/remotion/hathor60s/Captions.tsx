/**
 * KineticCaption — restrained sound-off captions, designed not bouncy.
 * Reads the active cue, fades it in/out with a clinical ease, and shows
 * a quiet progress underline so viewers can feel cadence without the
 * cue itself moving. No per-word kinetic typography (this is clinical
 * tooling, not TikTok).
 *
 * Position is at ~22% from the bottom edge per render-notes.md, which
 * keeps it above lower-third UI on Instagram / TikTok reposts.
 */

import { useCurrentFrame, interpolate } from "remotion";
import { CUES } from "./caption-data";
import { C, FONT, HEIGHT } from "./tokens";
import { EASE } from "./motion";

export function Captions() {
  const frame = useCurrentFrame();
  const cue = CUES.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  if (!cue) return null;

  const enter = interpolate(frame, [cue.fromFrame, cue.fromFrame + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });
  const exit = interpolate(frame, [cue.toFrame - 6, cue.toFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });
  const opacity = Math.min(enter, exit);

  // Small rise on entrance — a few px, not a flourish.
  const rise = interpolate(frame, [cue.fromFrame, cue.fromFrame + 8], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });

  // Cue progress for the underline (linear).
  const progress = interpolate(
    frame,
    [cue.fromFrame, cue.toFrame],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.linear },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: Math.round(HEIGHT * 0.22),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          maxWidth: 920,
          padding: "22px 30px",
          background: "rgba(15, 23, 42, 0.88)",
          backdropFilter: "blur(2px)",
          borderRadius: 16,
          color: "#FFFFFF",
          fontFamily: FONT.sans,
          fontSize: 58,
          lineHeight: 1.18,
          fontWeight: 600,
          letterSpacing: "-0.4px",
          textAlign: "center",
          whiteSpace: "pre-line",
          textShadow: "0 1px 2px rgba(0,0,0,0.35)",
          boxShadow: "0 12px 36px -16px rgba(15,23,42,0.55)",
          border: "1px solid rgba(255,255,255,0.06)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {cue.text}

        {/* Progress underline — restrained pacing cue, sound-off support. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: "rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: C.beam,
              opacity: 0.85,
            }}
          />
        </div>
      </div>
    </div>
  );
}
