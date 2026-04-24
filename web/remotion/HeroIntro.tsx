/**
 * HeroIntro — ~8-second Remotion composition for the landing page.
 *
 * Opens the "reasoning over extraction" thesis per PRD §1.1 and the
 * build spec ("the 'wow' opener"). Frame-accurate, no external assets.
 *
 * Timing (30 fps, 240 frames total):
 *     0–60   HATHOR wordmark fades up + glyph draws in
 *    60–120  Tagline types on: "Most apps trust their eyes."
 *   120–180  Strike-through on "their eyes"; reveals "the WHO rules."
 *   180–240  Closing mark: "Reasoning over extraction."
 *
 * Pharos palette — matches the app so the landing transition from
 * video to page feels continuous, not like a separate "intro screen."
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const HERO_FPS = 30;
export const HERO_DURATION_FRAMES = 240;
export const HERO_WIDTH = 1280;
export const HERO_HEIGHT = 720;

const PALETTE = {
  paper:  "#F6F0E4",
  paper2: "#FBF6EC",
  card:   "#FFFDF7",
  copper: "#CC785C",
  copperInk: "#9A5743",
  stone:  "#CFC4B1",
  ink:    "#1C1917",
  mute:   "#44403C",
  meta:   "#6B6158",
  faint:  "#A8A29E",
  ok:     "#5F7A52",
  bad:    "#A3453B",
};

const FONTS = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export function HeroIntro() {
  return (
    <AbsoluteFill style={{ background: PALETTE.paper, overflow: "hidden" }}>
      <GrainTexture />

      <Sequence from={0} durationInFrames={90}>
        <BrandReveal />
      </Sequence>

      <Sequence from={60} durationInFrames={120}>
        <ThesisLine />
      </Sequence>

      <Sequence from={180} durationInFrames={60}>
        <ClosingMark />
      </Sequence>
    </AbsoluteFill>
  );
}

// ── Brand reveal (frames 0–90) ───────────────────────────────────────────────

function BrandReveal() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(frame, [0, 30], [20, 0], {
    extrapolateRight: "clamp",
  });
  const glyphProgress = spring({
    frame: frame - 10,
    fps,
    config: { damping: 18, stiffness: 90 },
  });

  // BrandReveal plays 0–90 (the parent Sequence). The wordmark fades
  // DOWN starting at frame 60 (relative frame 60) so the handoff to
  // ThesisLine at absolute frame 60 is seamless.
  const exitOpacity = interpolate(frame, [60, 90], [1, 0.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 32,
        opacity: opacity * exitOpacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <PharosGlyphAnimated progress={glyphProgress} />
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 140,
          fontWeight: 400,
          letterSpacing: "-0.045em",
          color: PALETTE.ink,
          lineHeight: 1,
        }}
      >
        HATHOR
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 18,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: PALETTE.copperInk,
        }}
      >
        Cross-border vaccination reconciliation
      </div>
    </AbsoluteFill>
  );
}

// ── Thesis line (frames 60–180, Sequence spans 120 frames) ───────────────────

function ThesisLine() {
  const frame = useCurrentFrame();

  // Enter
  const enter = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Typewriter on "Most apps trust their eyes."
  const firstLine = "Most apps trust their eyes.";
  const typeEnd = 60;
  const charsShown = Math.max(
    0,
    Math.min(firstLine.length, Math.floor(((frame - 10) / typeEnd) * firstLine.length)),
  );

  // Strike-through on "their eyes" starts at frame 70.
  const strikeProgress = interpolate(frame, [70, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Second line "HATHOR double-checks every date against WHO rules." fades in at 85.
  const secondLineOpacity = interpolate(frame, [85, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(frame, [100, 120], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 26,
        opacity: enter * exitOpacity,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 72,
          letterSpacing: "-0.025em",
          color: PALETTE.ink,
          position: "relative",
          padding: "0 60px",
        }}
      >
        {firstLine.slice(0, charsShown)}
        <span
          aria-hidden
          style={{
            display: charsShown >= firstLine.length ? "inline-block" : "none",
            width: 4,
            height: 70,
            background: PALETTE.copper,
            verticalAlign: "middle",
            marginLeft: 6,
            opacity: frame < 64 ? 1 : 0,
          }}
        />
        {/* Strike-through overlay on "their eyes" */}
        <Strike progress={strikeProgress} text={firstLine} target="their eyes" />
      </div>

      <div
        style={{
          fontFamily: FONTS.serif,
          fontStyle: "italic",
          fontSize: 44,
          color: PALETTE.copperInk,
          letterSpacing: "-0.02em",
          opacity: secondLineOpacity,
          padding: "0 60px",
          textAlign: "center",
          lineHeight: 1.35,
        }}
      >
        HATHOR double-checks every date against the{" "}
        <span style={{ color: PALETTE.copper, fontStyle: "normal" }}>
          WHO rules engine
        </span>
        .
      </div>
    </AbsoluteFill>
  );
}

function Strike({
  progress,
  text,
  target,
}: {
  progress: number;
  text: string;
  target: string;
}) {
  // Measure the strike bar with a rough character-width estimate. Not
  // pixel-perfect but good enough for a demo hero — serif 72px ≈ 36px
  // average glyph width; we over-render by a touch so the line
  // overshoots both sides slightly, which reads as intentional.
  const APPROX_CHAR_W = 33;
  const startIdx = text.indexOf(target);
  if (startIdx < 0) return null;

  const leftOffset = startIdx * APPROX_CHAR_W + 60; // +60 for parent padding
  const width = target.length * APPROX_CHAR_W * progress;

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: leftOffset,
        top: "50%",
        transform: "translateY(-2px)",
        height: 6,
        width,
        background: PALETTE.bad,
        transition: "none",
      }}
    />
  );
}

// ── Closing mark (frames 180–240) ────────────────────────────────────────────

function ClosingMark() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 120 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        opacity,
        transform: `scale(${0.96 + 0.04 * enter})`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 14,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: PALETTE.meta,
        }}
      >
        Reasoning over extraction
      </div>
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 100,
          letterSpacing: "-0.045em",
          color: PALETTE.ink,
          lineHeight: 1,
        }}
      >
        HATHOR
      </div>
      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "center",
          fontFamily: FONTS.mono,
          fontSize: 13,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: PALETTE.faint,
        }}
      >
        <span>Claude Opus 4.7</span>
        <span aria-hidden style={{ color: PALETTE.stone }}>
          ·
        </span>
        <span>WHO-DAK rules engine</span>
        <span aria-hidden style={{ color: PALETTE.stone }}>
          ·
        </span>
        <span>Phase 1.0</span>
      </div>
    </AbsoluteFill>
  );
}

// ── Pharos glyph with draw-in animation ──────────────────────────────────────

function PharosGlyphAnimated({ progress }: { progress: number }) {
  // Progress 0→1 draws a stacked-block lighthouse: base rail, then
  // three shrinking tiers, then the beacon dot + rays.
  const p = Math.max(0, Math.min(1, progress));
  const stages = [
    p >= 0.05, // base rail
    p >= 0.2,  // tier 1
    p >= 0.4,  // tier 2
    p >= 0.6,  // tier 3
    p >= 0.8,  // beacon
    p >= 0.92, // rays
  ];
  const color = PALETTE.copperInk;
  return (
    <svg width={120} height={120} viewBox="0 0 48 48" aria-hidden>
      {stages[0] && (
        <line
          x1="4" y1="44" x2="44" y2="44"
          stroke={color} strokeWidth="1.25" strokeLinecap="round"
        />
      )}
      {stages[1] && (
        <rect x="14" y="30" width="20" height="13" fill="none" stroke={color} strokeWidth="1.25" />
      )}
      {stages[2] && (
        <rect x="17" y="19" width="14" height="11" fill="none" stroke={color} strokeWidth="1.25" />
      )}
      {stages[3] && (
        <rect x="20" y="11" width="8" height="8" fill="none" stroke={color} strokeWidth="1.25" />
      )}
      {stages[4] && <circle cx="24" cy="8" r="1.75" fill={color} />}
      {stages[5] && (
        <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.85">
          <line x1="24"   y1="5"   x2="24"   y2="2"   />
          <line x1="20.5" y1="6.5" x2="18.5" y2="4.5" />
          <line x1="27.5" y1="6.5" x2="29.5" y2="4.5" />
        </g>
      )}
    </svg>
  );
}

// ── Subtle grain texture ─────────────────────────────────────────────────────

function GrainTexture() {
  // A faint repeated dot pattern so the paper color has texture at
  // 1280×720. Pure CSS via radial-gradient — no raster assets needed.
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.35,
        backgroundImage: `radial-gradient(${PALETTE.stone} 0.5px, transparent 0.6px)`,
        backgroundSize: "6px 6px",
        mixBlendMode: "multiply" as const,
      }}
    />
  );
}
