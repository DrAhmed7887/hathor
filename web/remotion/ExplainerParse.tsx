/**
 * ExplainerParse — 12s Remotion composition that sits above ParsedResults
 * on first render.
 *
 * Tells the "reasoning over extraction" story concretely: a clean card
 * row at 97% confidence → a facility stamp slides across overlapping
 * the year digit → confidence drops → plain-language reasoning
 * appears → the row routes to clinician review.
 *
 * This is the visual payoff for PRD §5.6 Vision Safety Loop.
 *
 * Timing (30 fps, 360 frames, 12s):
 *     0-60   Kicker title — "Reasoning over extraction"
 *    60-150  Clean row — DTP / 24/04/2024 / dose 3 / 97% green
 *   150-210  Stamp slides in, rotates, lands overlapping the year
 *   210-300  Reasoning text appears; amber shell lights; 58% amber
 *   300-360  Caption — "Routes to clinician review"
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const EXPLAIN_FPS = 30;
export const EXPLAIN_DURATION_FRAMES = 360;
export const EXPLAIN_WIDTH = 1280;
export const EXPLAIN_HEIGHT = 360;

const PALETTE = {
  paper:     "#F6F0E4",
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  stone:     "#CFC4B1",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  ink:       "#1C1917",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  ok:        "#5F7A52",
  okSoft:    "#E8EEE1",
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
  bad:       "#A3453B",
};

const FONTS = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export function ExplainerParse() {
  return (
    <AbsoluteFill style={{ background: PALETTE.paper, overflow: "hidden" }}>
      <Sequence from={0} durationInFrames={80}>
        <Kicker />
      </Sequence>

      <Sequence from={40} durationInFrames={260}>
        <CardStage />
      </Sequence>

      <Sequence from={300} durationInFrames={60}>
        <ClosingCaption />
      </Sequence>
    </AbsoluteFill>
  );
}

// ── Kicker (frames 0-60, Sequence 80) ───────────────────────────────────────

function Kicker() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 50, 70], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 16,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: PALETTE.copperInk,
        }}
      >
        Reasoning over extraction
      </div>
    </AbsoluteFill>
  );
}

// ── Card stage (the main sequence) ──────────────────────────────────────────

function CardStage() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Absolute frame offsets inside the stage (this Sequence starts at 40).
  // For readability below, convert the local `frame` to absolute frames.
  const absoluteFrame = frame + 40;

  // Enter — card slides up
  const cardEnter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90 },
  });
  const cardTranslate = interpolate(cardEnter, [0, 1], [40, 0]);
  const cardOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Stamp slide-in — absolute frames 150 → 200
  const stampProgress = interpolate(absoluteFrame, [150, 200], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Stamp "settle wiggle" — a tiny rotation adjustment
  const stampSettle = interpolate(absoluteFrame, [200, 215], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Confidence collapse — from 97 → 58 over frames 210 → 250
  const confidenceValue = interpolate(absoluteFrame, [210, 250], [97, 58], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shellIsAmber = absoluteFrame >= 215;

  // Reasoning appears at frame 235
  const reasoningOpacity = interpolate(absoluteFrame, [235, 260], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Reasoning typewriter
  const reasoningText =
    "Facility stamp overlaps the year digit; ambiguous between 2021 and 2024.";
  const typeStartFrame = 245;
  const typeEndFrame = 295;
  const charsShown = Math.max(
    0,
    Math.min(
      reasoningText.length,
      Math.floor(
        ((absoluteFrame - typeStartFrame) /
          (typeEndFrame - typeStartFrame)) *
          reasoningText.length,
      ),
    ),
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 80px",
      }}
    >
      <article
        style={{
          width: "100%",
          maxWidth: 960,
          background: PALETTE.card,
          border: `1px solid ${shellIsAmber ? "#E2C998" : PALETTE.rule}`,
          borderLeft: `4px solid ${shellIsAmber ? PALETTE.amber : PALETTE.stone}`,
          padding: "26px 32px",
          display: "grid",
          gridTemplateColumns: "260px 1fr auto",
          gap: 28,
          alignItems: "center",
          opacity: cardOpacity,
          transform: `translateY(${cardTranslate}px)`,
          position: "relative",
        }}
      >
        {/* Crop pane — fake "card image" rendered inline */}
        <div
          style={{
            width: 260,
            height: 160,
            background: PALETTE.paper2,
            border: `1px solid ${PALETTE.rule}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <CardCropSketch stampProgress={stampProgress} settle={stampSettle} />
        </div>

        {/* Field cells */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <Field label="Antigen" value="DTP" mono={false} size="lg" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr",
              gap: 14,
            }}
          >
            <Field
              label="Date"
              value={absoluteFrame < 215 ? "24 / 04 / 2024" : "24 / 04 / 202?"}
              mono
            />
            <Field label="Dose #" value="3" mono />
            <Field label="Lot" value="HAL-4408" mono />
          </div>
        </div>

        {/* Confidence badge */}
        <ConfidenceBadgeAnimated
          value={confidenceValue}
          amber={shellIsAmber}
        />

        {/* Reasoning panel — anchored bottom */}
        {absoluteFrame >= 235 && (
          <div
            style={{
              gridColumn: "1 / -1",
              background: "rgba(184, 131, 59, 0.08)",
              borderLeft: `2px solid ${PALETTE.amber}`,
              padding: "12px 16px",
              fontFamily: FONTS.serif,
              fontSize: 22,
              fontStyle: "italic",
              color: PALETTE.amber,
              opacity: reasoningOpacity,
              lineHeight: 1.5,
            }}
          >
            {reasoningText.slice(0, charsShown)}
            {charsShown < reasoningText.length && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 3,
                  height: 22,
                  background: PALETTE.amber,
                  verticalAlign: "middle",
                  marginLeft: 4,
                  opacity: Math.floor(absoluteFrame / 8) % 2 === 0 ? 1 : 0.3,
                }}
              />
            )}
          </div>
        )}
      </article>
    </AbsoluteFill>
  );
}

function Field({
  label,
  value,
  mono,
  size = "md",
}: {
  label: string;
  value: string;
  mono?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: PALETTE.meta,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono ? FONTS.mono : FONTS.serif,
          fontSize: size === "lg" ? 32 : 22,
          color: PALETTE.ink,
          letterSpacing: "-0.005em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ConfidenceBadgeAnimated({
  value,
  amber,
}: {
  value: number;
  amber: boolean;
}) {
  const color = amber ? PALETTE.amber : PALETTE.ok;
  const bg = amber ? PALETTE.amberSoft : PALETTE.okSoft;
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 14,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color,
        padding: "8px 16px",
        background: bg,
        border: `2px solid ${color}`,
        whiteSpace: "nowrap",
        alignSelf: "start",
      }}
    >
      {Math.round(value)}% {amber ? "review" : "confident"}
    </div>
  );
}

// ── Stamp overlay inside the crop pane ──────────────────────────────────────

function CardCropSketch({
  stampProgress,
  settle,
}: {
  stampProgress: number;
  settle: number;
}) {
  // A simple hand-printed "row" — label + date + lot — rendered in SVG
  // so stamp rotation composites cleanly over the year digits.
  const stampX = interpolate(stampProgress, [0, 1], [320, 165]);
  const stampOpacity = interpolate(stampProgress, [0, 0.2, 1], [0, 0.3, 1]);
  const stampRotate = interpolate(stampProgress, [0, 1], [-5, -8]);
  const stampSettleRotate = interpolate(settle, [0, 0.5, 1], [0, 3, -2]);

  return (
    <svg viewBox="0 0 260 160" width="260" height="160">
      {/* Row label (left) */}
      <text
        x="14"
        y="36"
        fontFamily="Georgia, serif"
        fontSize="17"
        fill={PALETTE.ink}
      >
        DTP 3
      </text>

      {/* Hand-printed date */}
      <text
        x="14"
        y="82"
        fontFamily="'Bradley Hand', 'Noteworthy', cursive"
        fontSize="34"
        fill={PALETTE.ink}
      >
        24/04/2024
      </text>

      {/* Lot */}
      <text
        x="14"
        y="118"
        fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
        fontSize="14"
        fill={PALETTE.meta}
      >
        HAL-4408
      </text>
      <text
        x="14"
        y="146"
        fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
        fontSize="12"
        fill={PALETTE.faint}
      >
        Nigerian EPI · MCH clinic
      </text>

      {/* Facility stamp — a rotated rectangle with text */}
      <g
        transform={`translate(${stampX} 55) rotate(${stampRotate + stampSettleRotate})`}
        opacity={stampOpacity}
      >
        <rect
          x="-70"
          y="-22"
          width="140"
          height="44"
          fill="none"
          stroke={PALETTE.bad}
          strokeWidth="2.5"
          rx="4"
        />
        <text
          x="0"
          y="-3"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          letterSpacing="0.18em"
          fill={PALETTE.bad}
          fontWeight="600"
        >
          MCH LAGOS
        </text>
        <text
          x="0"
          y="14"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          letterSpacing="0.12em"
          fill={PALETTE.bad}
        >
          04 · 2024 · VAC
        </text>
      </g>
    </svg>
  );
}

// ── Closing caption (frames 300-360) ────────────────────────────────────────

function ClosingCaption() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, 50, 60], [0, 1, 1, 0.95], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        background: "rgba(246, 240, 228, 0.92)",
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 12,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: PALETTE.copperInk,
        }}
      >
        Phase D · vision safety loop
      </div>
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 40,
          letterSpacing: "-0.02em",
          color: PALETTE.ink,
          textAlign: "center",
        }}
      >
        Routes to clinician review.
      </div>
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 18,
          fontStyle: "italic",
          color: PALETTE.meta,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.5,
        }}
      >
        Never auto-committed. Per field, not per document.
      </div>
    </AbsoluteFill>
  );
}
