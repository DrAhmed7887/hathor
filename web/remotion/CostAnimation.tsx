/**
 * CostAnimation — 12s Remotion composition for the hackathon video.
 *
 * Animated cost table: V1 → V2 (bad) → V3 (win).
 * Dark background, lime green + red, matches video aesthetic.
 *
 * Timing (30 fps, 360 frames, 12s):
 *     0–60    Title fades in: "Three-way A/B"
 *    60–160   V1 column counts up
 *   160–260   V2 column counts up (red — worse)
 *   260–360   V3 column counts up (green — win)
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const COST_FPS = 30;
export const COST_DURATION_FRAMES = 360;
export const COST_WIDTH = 1920;
export const COST_HEIGHT = 1080;

const C = {
  bg:    "#0a0a0a",
  green: "#39ff14",
  red:   "#ff4444",
  white: "#ffffff",
  gray:  "#333333",
  grayL: "#666666",
  greenD: "rgba(57,255,20,0.06)",
  greenB: "rgba(57,255,20,0.15)",
  redD:   "rgba(255,68,68,0.10)",
};

function useCount(frame: number, from: number, to: number, startFrame: number, endFrame: number, decimals = 0) {
  const t = interpolate(frame, [startFrame, endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  const val = from + (to - from) * eased;
  return decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString();
}

function ColHeader({ label, color, opacity }: { label: string; color: string; opacity: number }) {
  return (
    <div style={{
      fontSize: 20,
      fontWeight: 800,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color,
      opacity,
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    }}>
      {label}
    </div>
  );
}

function MetricRow({
  label, v1, v2, v3,
  v1Color, v2Color, v3Color,
  v1Opacity, v2Opacity, v3Opacity,
  highlighted,
}: {
  label: string;
  v1: string; v2: string; v3: string;
  v1Color: string; v2Color: string; v3Color: string;
  v1Opacity: number; v2Opacity: number; v3Opacity: number;
  highlighted: boolean;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "320px 1fr 1fr 1fr",
      alignItems: "center",
      padding: "28px 0",
      borderBottom: `1px solid #1a1a1a`,
      background: highlighted ? C.greenD : "transparent",
    }}>
      <div style={{
        fontSize: 20,
        fontWeight: 500,
        color: C.grayL,
        fontFamily: "system-ui, -apple-system, sans-serif",
        paddingLeft: 40,
      }}>
        {label}
      </div>
      <div style={{ textAlign: "center", opacity: v1Opacity }}>
        <span style={{ fontSize: 52, fontWeight: 700, color: v1Color, fontFamily: "system-ui, sans-serif" }}>{v1}</span>
      </div>
      <div style={{ textAlign: "center", opacity: v2Opacity }}>
        <span style={{ fontSize: 52, fontWeight: 900, color: v2Color, fontFamily: "system-ui, sans-serif" }}>{v2}</span>
      </div>
      <div style={{ textAlign: "center", opacity: v3Opacity }}>
        <span style={{
          fontSize: 56, fontWeight: 900, color: v3Color,
          fontFamily: "system-ui, sans-serif",
          textShadow: v3Color === C.green ? `0 0 20px ${C.green}60` : "none",
        }}>{v3}</span>
      </div>
    </div>
  );
}

export function CostAnimation() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title
  const titleOpacity = interpolate(frame, [0, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Column opacities
  const v1ColOpacity = interpolate(frame, [55, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const v2ColOpacity = interpolate(frame, [155, 180], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const v3ColOpacity = interpolate(frame, [255, 280], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Counting values
  const toolV1 = useCount(frame, 0, 19, 60, 130);
  const toolV2 = useCount(frame, 0, 25, 160, 230);
  const toolV3 = useCount(frame, 0, 10, 260, 330);

  const costV1 = useCount(frame, 0, 1.26, 60, 130, 2);
  const costV2 = useCount(frame, 0, 1.61, 160, 230, 2);
  const costV3 = useCount(frame, 0, 1.19, 260, 330, 2);

  const linesV1 = useCount(frame, 0, 247, 60, 130);
  const linesV2 = useCount(frame, 0, 247, 160, 230);
  const linesV3 = useCount(frame, 0, 169, 260, 330);

  // V3 column highlight pulse
  const v3Glow = interpolate(frame, [260, 360], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      {/* Subtle grid */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(57,255,20,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(57,255,20,0.025) 1px, transparent 1px)
        `,
        backgroundSize: "80px 80px",
      }} />

      {/* V3 column background highlight */}
      <div style={{
        position: "absolute",
        right: 0,
        top: 0,
        width: "25%",
        bottom: 0,
        background: `linear-gradient(180deg, transparent 0%, rgba(57,255,20,0.04) 20%, rgba(57,255,20,0.04) 80%, transparent 100%)`,
        borderLeft: `2px solid rgba(57,255,20,${0.15 * v3Glow})`,
        opacity: v3Glow,
      }} />

      <div style={{ position: "absolute", inset: 0, padding: "80px 80px 60px" }}>
        {/* Eyebrow */}
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: C.green,
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          marginBottom: 16,
          opacity: titleOpacity,
          textShadow: `0 0 16px ${C.green}`,
        }}>
          Three-way A/B · Arabic Egyptian card · Opus 4.7
        </div>

        {/* Headline */}
        <div style={{
          fontSize: 64,
          fontWeight: 900,
          color: C.white,
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: "-1.5px",
          lineHeight: 1.08,
          marginBottom: 56,
          opacity: titleOpacity,
        }}>
          Specialists alone{" "}
          <span style={{ color: C.red }}>cost more.</span>
          <br />
          Specialists + lean prompt{" "}
          <span style={{ color: C.green, textShadow: `0 0 30px ${C.green}50` }}>win.</span>
        </div>

        {/* Table */}
        <div style={{ width: "100%" }}>
          {/* Header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr 1fr 1fr",
            paddingBottom: 16,
            borderBottom: `2px solid #1e1e1e`,
            marginBottom: 4,
          }}>
            <div />
            <ColHeader label="V1  Baseline" color={C.grayL} opacity={v1ColOpacity} />
            <ColHeader label="V2  + Specialists" color={C.red} opacity={v2ColOpacity} />
            <ColHeader label="V3  Lean Prompt ✦" color={C.green} opacity={v3ColOpacity} />
          </div>

          {/* Rows */}
          <MetricRow
            label="Tool calls per card"
            v1={toolV1} v2={toolV2} v3={toolV3}
            v1Color={C.grayL} v2Color={C.red} v3Color={C.green}
            v1Opacity={v1ColOpacity} v2Opacity={v2ColOpacity} v3Opacity={v3ColOpacity}
            highlighted={false}
          />
          <MetricRow
            label="Cost per card"
            v1={`$${costV1}`} v2={`$${costV2}`} v3={`$${costV3}`}
            v1Color={C.grayL} v2Color={C.red} v3Color={C.green}
            v1Opacity={v1ColOpacity} v2Opacity={v2ColOpacity} v3Opacity={v3ColOpacity}
            highlighted={true}
          />
          <MetricRow
            label="System prompt lines"
            v1={linesV1} v2={linesV2} v3={linesV3}
            v1Color={C.grayL} v2Color={C.red} v3Color={C.green}
            v1Opacity={v1ColOpacity} v2Opacity={v2ColOpacity} v3Opacity={v3ColOpacity}
            highlighted={false}
          />
        </div>

        {/* Bottom callout */}
        {frame >= 300 && (
          <div style={{
            marginTop: 40,
            padding: "20px 32px",
            background: C.greenB,
            border: `1px solid ${C.green}40`,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            opacity: interpolate(frame, [300, 330], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            <div style={{
              width: 6, height: 36, borderRadius: 3,
              background: C.green,
              boxShadow: `0 0 12px ${C.green}`,
            }} />
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              color: C.green,
              fontFamily: "system-ui, -apple-system, sans-serif",
              letterSpacing: "-0.3px",
              textShadow: `0 0 12px ${C.green}40`,
            }}>
              247 → 169 lines pruned · Specialists own the blocks at runtime
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
