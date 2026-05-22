/**
 * SafetyGates — 12s Remotion composition for the hackathon video.
 *
 * Shows Phase D (Vision Safety Loop) and Phase E (Rules Engine Gate)
 * as two mandatory checkpoints in the clinical pipeline.
 *
 * Timing (30 fps, 360 frames, 12s):
 *     0–60    Title card
 *    60–180   Phase D builds: card → confidence check → HITL
 *   180–300   Phase E builds: agent output → rules engine → FHIR
 *   300–360   Both gates glow, "no path bypasses" stamp
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const GATES_FPS = 30;
export const GATES_DURATION_FRAMES = 360;
export const GATES_WIDTH = 1920;
export const GATES_HEIGHT = 1080;

const C = {
  bg:     "#080808",
  green:  "#39ff14",
  greenD: "rgba(57,255,20,0.10)",
  greenB: "rgba(57,255,20,0.20)",
  amber:  "#f59e0b",
  amberD: "rgba(245,158,11,0.15)",
  white:  "#ffffff",
  gray:   "#333",
  grayL:  "#666",
  grayM:  "#888",
};

function useSpring(frame: number, delay: number) {
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14 } });
}

function ArrowRight({ x, y, length, opacity, color }: {
  x: number; y: number; length: number; opacity: number; color: string;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y - 2, opacity }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{
          width: length - 12,
          height: 2,
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }} />
        <div style={{
          width: 0, height: 0,
          borderTop: "8px solid transparent",
          borderBottom: "8px solid transparent",
          borderLeft: `12px solid ${color}`,
          filter: `drop-shadow(0 0 4px ${color})`,
        }} />
      </div>
    </div>
  );
}

function GateBox({
  x, y, width, height, label, sublabel, color, colorD, scale, opacity, badgeText,
}: {
  x: number; y: number; width: number; height: number;
  label: string; sublabel: string;
  color: string; colorD: string;
  scale: number; opacity: number;
  badgeText?: string;
}) {
  return (
    <div style={{
      position: "absolute",
      left: x - (width / 2),
      top: y - (height / 2),
      width,
      height,
      background: colorD,
      border: `2px solid ${color}`,
      borderRadius: 12,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${scale})`,
      opacity,
      boxShadow: `0 0 30px ${color}40, 0 0 60px ${color}20`,
    }}>
      <div style={{
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        marginBottom: 8,
        textShadow: `0 0 10px ${color}`,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 17,
        fontWeight: 600,
        color: C.white,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        lineHeight: 1.4,
        padding: "0 16px",
      }}>
        {sublabel}
      </div>
      {badgeText && (
        <div style={{
          marginTop: 12,
          padding: "4px 12px",
          borderRadius: 999,
          background: `${color}22`,
          border: `1px solid ${color}60`,
          fontSize: 13,
          fontWeight: 700,
          color,
          fontFamily: "ui-monospace, monospace",
          letterSpacing: "0.06em",
        }}>
          {badgeText}
        </div>
      )}
    </div>
  );
}

function NodeBox({
  x, y, width, height, label, color, scale, opacity,
}: {
  x: number; y: number; width: number; height: number;
  label: string; color: string; scale: number; opacity: number;
}) {
  return (
    <div style={{
      position: "absolute",
      left: x - width / 2,
      top: y - height / 2,
      width,
      height,
      background: "#111",
      border: `1px solid #333`,
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${scale})`,
      opacity,
    }}>
      <div style={{
        fontSize: 16,
        fontWeight: 600,
        color: C.grayM,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        lineHeight: 1.4,
      }}>
        {label}
      </div>
    </div>
  );
}

export function SafetyGates() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title opacity
  const titleOpacity = interpolate(frame, [0, 20, 45, 55], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  // Phase D timeline
  const cardScale = useSpring(frame, 65);
  const cardOpacity = interpolate(frame, [65, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const arrow1Opacity = interpolate(frame, [95, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const gateD_scale = useSpring(frame, 115);
  const gateD_opacity = interpolate(frame, [115, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const arrow2Opacity = interpolate(frame, [140, 155], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const hitlScale = useSpring(frame, 155);
  const hitlOpacity = interpolate(frame, [155, 170], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Phase E timeline
  const agentScale = useSpring(frame, 185);
  const agentOpacity = interpolate(frame, [185, 200], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const arrow3Opacity = interpolate(frame, [210, 225], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const gateE_scale = useSpring(frame, 225);
  const gateE_opacity = interpolate(frame, [225, 240], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const arrow4Opacity = interpolate(frame, [250, 265], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fhirScale = useSpring(frame, 265);
  const fhirOpacity = interpolate(frame, [265, 280], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Final stamp
  const stampOpacity = interpolate(frame, [310, 340], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const W = GATES_WIDTH;
  const H = GATES_HEIGHT;

  // Phase D row: y = H * 0.33
  const dY = H * 0.35;
  // Phase E row: y = H * 0.67
  const eY = H * 0.67;

  const step1X = 220;
  const step2X = 580;
  const step3X = 980;
  const step4X = 1340;
  const step5X = 1700;

  const nodeW = 200;
  const nodeH = 80;
  const gateW = 260;
  const gateH = 120;
  const arrowY_D = dY + 2;
  const arrowY_E = eY + 2;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(57,255,20,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(57,255,20,0.025) 1px, transparent 1px)
        `,
        backgroundSize: "80px 80px",
      }} />

      {/* Title */}
      {frame < 60 && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          opacity: titleOpacity,
        }}>
          <div style={{
            fontSize: 15, fontWeight: 700, letterSpacing: "0.2em",
            textTransform: "uppercase", color: C.green,
            fontFamily: "ui-monospace, monospace", marginBottom: 16,
            textShadow: `0 0 20px ${C.green}`,
          }}>
            Hathor · Two Mandatory Safety Gates
          </div>
          <div style={{
            fontSize: 68, fontWeight: 900, color: C.white,
            fontFamily: "system-ui, sans-serif", letterSpacing: "-2px",
            textAlign: "center", lineHeight: 1.08,
          }}>
            No path<br />
            <span style={{ color: C.green, textShadow: `0 0 30px ${C.green}50` }}>bypasses the gates.</span>
          </div>
        </div>
      )}

      {/* --- PHASE D row --- */}
      {frame >= 65 && (
        <>
          {/* Phase D label */}
          <div style={{
            position: "absolute",
            left: 40, top: dY - 60,
            fontSize: 13, fontWeight: 700, letterSpacing: "0.16em",
            textTransform: "uppercase", color: C.amber,
            fontFamily: "ui-monospace, monospace",
            opacity: cardOpacity,
          }}>
            Phase D · Vision Safety Loop
          </div>

          <NodeBox x={step1X} y={dY} width={nodeW} height={nodeH}
            label="Card scan\nextracted" color={C.grayM}
            scale={cardScale} opacity={cardOpacity} />

          <ArrowRight x={step1X + nodeW / 2} y={arrowY_D}
            length={step2X - step1X - nodeW / 2 - gateW / 2 + 2}
            opacity={arrow1Opacity} color={C.amber} />

          <GateBox x={step2X + 80} y={dY} width={gateW} height={gateH}
            label="Phase D Gate" sublabel={"Confidence < 0.85\n→ HITL Review"}
            color={C.amber} colorD={C.amberD}
            scale={gateD_scale} opacity={gateD_opacity}
            badgeText="per field · not per doc" />

          <ArrowRight x={step2X + 80 + gateW / 2} y={arrowY_D}
            length={step3X - (step2X + 80 + gateW / 2) - nodeW / 2 + 2}
            opacity={arrow2Opacity} color={C.green} />

          <NodeBox x={step3X} y={dY} width={nodeW} height={nodeH}
            label={"Clinician\nconfirms"} color={C.green}
            scale={hitlScale} opacity={hitlOpacity} />
        </>
      )}

      {/* --- PHASE E row --- */}
      {frame >= 185 && (
        <>
          {/* Phase E label */}
          <div style={{
            position: "absolute",
            left: 40, top: eY - 60,
            fontSize: 13, fontWeight: 700, letterSpacing: "0.16em",
            textTransform: "uppercase", color: C.green,
            fontFamily: "ui-monospace, monospace",
            opacity: agentOpacity,
          }}>
            Phase E · Rules Engine Gate
          </div>

          <NodeBox x={step1X} y={eY} width={nodeW} height={nodeH}
            label={"Agent\nrecommendation"} color={C.grayM}
            scale={agentScale} opacity={agentOpacity} />

          <ArrowRight x={step1X + nodeW / 2} y={arrowY_E}
            length={step2X - step1X - nodeW / 2 - gateW / 2 + 2}
            opacity={arrow3Opacity} color={C.green} />

          <GateBox x={step2X + 80} y={eY} width={gateW} height={gateH}
            label="Phase E Gate" sublabel={"WHO DAK\nrules_engine.validate()"}
            color={C.green} colorD={C.greenD}
            scale={gateE_scale} opacity={gateE_opacity}
            badgeText="deterministic Python" />

          <ArrowRight x={step2X + 80 + gateW / 2} y={arrowY_E}
            length={step3X - (step2X + 80 + gateW / 2) - nodeW / 2 + 2}
            opacity={arrow4Opacity} color={C.green} />

          <NodeBox x={step3X} y={eY} width={nodeW} height={nodeH}
            label={"FHIR\nbundle"} color={C.green}
            scale={fhirScale} opacity={fhirOpacity} />
        </>
      )}

      {/* Final stamp */}
      {frame >= 310 && (
        <div style={{
          position: "absolute",
          bottom: 80, left: "50%",
          transform: "translateX(-50%)",
          opacity: stampOpacity,
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "20px 48px",
          background: C.greenD,
          border: `1px solid ${C.green}50`,
          borderRadius: 10,
        }}>
          <div style={{ width: 6, height: 40, borderRadius: 3, background: C.green, boxShadow: `0 0 12px ${C.green}` }} />
          <div style={{
            fontSize: 22, fontWeight: 700, color: C.green,
            fontFamily: "system-ui, sans-serif", letterSpacing: "-0.3px",
            textShadow: `0 0 12px ${C.green}40`,
          }}>
            Neither gate is optional · Code paths that bypass them are a bug.
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
