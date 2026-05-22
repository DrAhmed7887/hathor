/**
 * AgentFanOut — 15s Remotion composition for the hackathon video.
 *
 * Shows the 5-specialist parallel fan-out from the Opus orchestrator.
 * Dark background + lime green (#39ff14) to match the video style.
 *
 * Timing (30 fps, 450 frames, 15s):
 *     0–60    Title card: "Parallel Specialist Architecture"
 *    60–120   Orchestrator node appears in center
 *   120–240   5 specialist nodes fan out with animated lines
 *   240–360   Specialists pulse as they "work", status labels appear
 *   360–420   Results merge back to orchestrator
 *   420–450   Final state — "10 tool calls · $1.19"
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FAN_FPS = 30;
export const FAN_DURATION_FRAMES = 450;
export const FAN_WIDTH = 1920;
export const FAN_HEIGHT = 1080;

const C = {
  bg:     "#080808",
  bg2:    "#0e0e0e",
  green:  "#39ff14",
  greenD: "rgba(57,255,20,0.15)",
  greenG: "rgba(57,255,20,0.06)",
  white:  "#ffffff",
  gray:   "#555555",
  grayL:  "#888888",
  red:    "#ff4444",
  redD:   "rgba(255,68,68,0.15)",
};

const SPECIALISTS = [
  { id: 0, label: "Source-Country\nDetector",    angle: -90, color: C.green },
  { id: 1, label: "Attending\nPhysician",         angle: -30, color: C.green },
  { id: 2, label: "WHO Baseline\nSchedule",       angle:  30, color: C.green },
  { id: 3, label: "Multilingual\nTranslator",     angle:  90, color: C.green },
  { id: 4, label: "Catch-Up\nPlanner",            angle: 150, color: C.green },
];

function useSpring(frame: number, delay: number, config = { damping: 14 }) {
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
}

function GlowCircle({
  x, y, r, color, opacity = 1,
}: { x: number; y: number; r: number; color: string; opacity?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        opacity,
        boxShadow: `0 0 20px ${color}, 0 0 40px ${color}40`,
      }}
    />
  );
}

function AnimatedLine({
  x1, y1, x2, y2, progress, color,
}: {
  x1: number; y1: number; x2: number; y2: number;
  progress: number; color: string;
}) {
  const cx = x1 + (x2 - x1) * progress;
  const cy = y1 + (y2 - y1) * progress;
  const dx = cx - x1;
  const dy = cy - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  if (len < 1) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: x1,
        top: y1 - 1,
        width: len,
        height: 2,
        background: `linear-gradient(90deg, ${color}80, ${color})`,
        transformOrigin: "0 50%",
        transform: `rotate(${angle}deg)`,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );
}

function OrchestratorNode({ scale, opacity }: { scale: number; opacity: number }) {
  const cx = FAN_WIDTH / 2;
  const cy = FAN_HEIGHT / 2;
  const r = 80;

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {/* Outer glow ring */}
      <div style={{
        position: "absolute",
        left: cx - r * 1.8,
        top: cy - r * 1.8,
        width: r * 3.6,
        height: r * 3.6,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${C.greenG} 0%, transparent 70%)`,
        transform: `scale(${scale})`,
      }} />

      {/* Main circle */}
      <div style={{
        position: "absolute",
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: `radial-gradient(circle at 40% 35%, #1a2a0a, #080808)`,
        border: `2px solid ${C.green}`,
        boxShadow: `0 0 30px ${C.green}60, 0 0 60px ${C.green}20`,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          fontSize: 13,
          fontWeight: 800,
          color: C.green,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          textAlign: "center",
          lineHeight: 1.3,
          textShadow: `0 0 12px ${C.green}`,
        }}>
          claude-<br />opus-4-7
        </div>
      </div>

      {/* Label below */}
      <div style={{
        position: "absolute",
        left: cx - 120,
        top: cy + r + 20,
        width: 240,
        textAlign: "center",
        fontSize: 18,
        fontWeight: 600,
        color: C.grayL,
        fontFamily: "system-ui, -apple-system, sans-serif",
        letterSpacing: "0.04em",
        transform: `scale(${scale})`,
        transformOrigin: "50% 0",
      }}>
        Orchestrator
      </div>
    </div>
  );
}

function SpecialistNode({
  angle, label, scale, opacity, pulsing, color,
}: {
  angle: number; label: string; scale: number; opacity: number;
  pulsing: boolean; color: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const dist = 340;
  const cx = FAN_WIDTH / 2 + Math.cos(rad) * dist;
  const cy = FAN_HEIGHT / 2 + Math.sin(rad) * dist;
  const r = 56;
  const frame = useCurrentFrame();
  const pulseScale = pulsing ? 1 + 0.06 * Math.sin((frame / 6) * Math.PI * 2) : 1;

  const lines = label.split("\n");

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {/* Glow */}
      <div style={{
        position: "absolute",
        left: cx - r * 2,
        top: cy - r * 2,
        width: r * 4,
        height: r * 4,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`,
        transform: `scale(${scale * pulseScale})`,
        transformOrigin: "50% 50%",
      }} />

      {/* Circle */}
      <div style={{
        position: "absolute",
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: "#0a0a0a",
        border: `1.5px solid ${color}`,
        boxShadow: pulsing ? `0 0 20px ${color}80, 0 0 40px ${color}30` : `0 0 10px ${color}40`,
        transform: `scale(${scale * pulseScale})`,
        transformOrigin: "50% 50%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            fontSize: 11,
            fontWeight: 700,
            color,
            textAlign: "center",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: "ui-monospace, 'SF Mono', monospace",
            lineHeight: 1.4,
            textShadow: `0 0 8px ${color}`,
          }}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function TitleCard({ opacity }: { opacity: number }) {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      opacity,
    }}>
      <div style={{
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: C.green,
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        marginBottom: 20,
        textShadow: `0 0 20px ${C.green}`,
      }}>
        Hathor · Architecture
      </div>
      <div style={{
        fontSize: 72,
        fontWeight: 900,
        color: C.white,
        fontFamily: "system-ui, -apple-system, sans-serif",
        letterSpacing: "-2px",
        lineHeight: 1.05,
        textAlign: "center",
      }}>
        Parallel Specialist<br />
        <span style={{ color: C.green, textShadow: `0 0 30px ${C.green}60` }}>Architecture</span>
      </div>
    </div>
  );
}

function StatBadge({
  x, y, label, opacity,
}: { x: number; y: number; label: string; opacity: number }) {
  return (
    <div style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      background: C.greenD,
      border: `1px solid ${C.green}60`,
      borderRadius: 8,
      padding: "10px 20px",
      fontFamily: "ui-monospace, 'SF Mono', monospace",
      fontSize: 22,
      fontWeight: 700,
      color: C.green,
      whiteSpace: "nowrap",
      boxShadow: `0 0 20px ${C.green}20`,
    }}>
      {label}
    </div>
  );
}

export function AgentFanOut() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title card
  const titleOpacity = interpolate(frame, [0, 20, 40, 55, 65], [0, 1, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Orchestrator
  const orchScale = useSpring(frame, 65);
  const orchOpacity = interpolate(frame, [65, 80], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });

  // Lines and specialists — staggered
  const specDelays = [120, 140, 160, 180, 200];
  const lineProgress = SPECIALISTS.map((_, i) => {
    const s = spring({ frame: frame - specDelays[i], fps, config: { damping: 18 } });
    return Math.min(s, 1);
  });

  const specScales = SPECIALISTS.map((_, i) => {
    return spring({ frame: frame - (specDelays[i] + 15), fps, config: { damping: 14 } });
  });

  const specOpacity = SPECIALISTS.map((_, i) =>
    interpolate(frame, [specDelays[i] + 15, specDelays[i] + 30], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  // Pulsing (240–360)
  const pulsing = frame >= 240 && frame < 365;

  // Return lines (360–420)
  const returnProgress = SPECIALISTS.map((_, i) => {
    const delay = 362 + i * 8;
    const s = spring({ frame: frame - delay, fps, config: { damping: 18 } });
    return Math.min(s, 1);
  });

  // Final stats (420+)
  const statsOpacity = interpolate(frame, [420, 440], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cx = FAN_WIDTH / 2;
  const cy = FAN_HEIGHT / 2;
  const dist = 340;
  const orchR = 80;
  const specR = 56;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      {/* Subtle grid */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(57,255,20,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(57,255,20,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "80px 80px",
      }} />

      {/* Title card */}
      <Sequence from={0} durationInFrames={70}>
        <TitleCard opacity={titleOpacity} />
      </Sequence>

      {/* Main diagram — visible from frame 65+ */}
      {frame >= 65 && (
        <>
          {/* Lines outward */}
          {SPECIALISTS.map((sp, i) => {
            const rad = (sp.angle * Math.PI) / 180;
            const x2 = cx + Math.cos(rad) * dist;
            const y2 = cy + Math.sin(rad) * dist;
            const x1end = cx + Math.cos(rad) * orchR;
            const y1end = cy + Math.sin(rad) * orchR;
            const x2end = x2 - Math.cos(rad) * specR;
            const y2end = y2 - Math.sin(rad) * specR;
            return (
              <AnimatedLine
                key={`out-${i}`}
                x1={x1end} y1={y1end}
                x2={x2end} y2={y2end}
                progress={lineProgress[i]}
                color={sp.color}
              />
            );
          })}

          {/* Return lines */}
          {frame >= 360 && SPECIALISTS.map((sp, i) => {
            const rad = (sp.angle * Math.PI) / 180;
            const x1 = cx + Math.cos(rad) * dist - Math.cos(rad) * specR;
            const y1 = cy + Math.sin(rad) * dist - Math.sin(rad) * specR;
            const x2 = cx + Math.cos(rad) * orchR;
            const y2 = cy + Math.sin(rad) * orchR;
            return (
              <AnimatedLine
                key={`ret-${i}`}
                x1={x1} y1={y1}
                x2={x2} y2={y2}
                progress={returnProgress[i]}
                color="#ffffff"
              />
            );
          })}

          {/* Orchestrator */}
          <OrchestratorNode scale={orchScale} opacity={orchOpacity} />

          {/* Specialists */}
          {SPECIALISTS.map((sp, i) => (
            <SpecialistNode
              key={sp.id}
              angle={sp.angle}
              label={sp.label}
              scale={specScales[i]}
              opacity={specOpacity[i]}
              pulsing={pulsing}
              color={sp.color}
            />
          ))}

          {/* Final stats */}
          <StatBadge
            x={FAN_WIDTH / 2 - 240}
            y={FAN_HEIGHT - 160}
            label="10 tool calls"
            opacity={statsOpacity}
          />
          <StatBadge
            x={FAN_WIDTH / 2 + 20}
            y={FAN_HEIGHT - 160}
            label="$1.19 / card"
            opacity={statsOpacity}
          />
        </>
      )}
    </AbsoluteFill>
  );
}
