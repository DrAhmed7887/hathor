/**
 * Scene 2 — "problem" (10s, 2 shots).
 *
 *  problem-1 (0–5s): Two horizontal schedule rails (Nigeria above, Egypt
 *                    below). Dose markers reveal sequentially along each
 *                    rail. Mismatch connectors draw between doses that do
 *                    not align across schedules — making the ambiguity
 *                    structural and visible, not implied by text.
 *
 *  problem-2 (5–10s): Card centered with restrained ambiguity markers.
 *                    Three rows are flagged with EvidenceHighlight outlines
 *                    rather than loud question marks. FocusBackdrop dims
 *                    everything except the flagged region.
 */

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, FPS, HEIGHT, WIDTH } from "../tokens";
import { BEAT, EASE, reveal, rise as riseDist, stagger } from "../motion";
import { EvidenceHighlight } from "../components/EvidenceHighlight";
import { FocusBackdrop } from "../components/FocusBackdrop";
import { ShotTag } from "./Hook";

const P1 = 5 * FPS;
const P2 = 5 * FPS;

export function Problem() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={P1} name="problem-1">
        <Problem1 />
      </Sequence>
      <Sequence from={P1} durationInFrames={P2} name="problem-2">
        <Problem2 />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ============================================================== */
/* problem-1                                                      */
/* ============================================================== */

type Dose = { label: string; xPct: number; mismatch?: boolean };

const NG_RAIL: Dose[] = [
  { label: "BCG",     xPct: 0.04 },
  { label: "OPV 0",   xPct: 0.06 },
  { label: "Penta 1", xPct: 0.18 },
  { label: "OPV 1",   xPct: 0.20 },
  { label: "Penta 2", xPct: 0.34, mismatch: true },
  { label: "Measles 1", xPct: 0.62, mismatch: true },
  { label: "Yellow F",  xPct: 0.66, mismatch: true },
];

const EG_RAIL: Dose[] = [
  { label: "BCG",      xPct: 0.04 },
  { label: "OPV 0",    xPct: 0.06 },
  { label: "DTP-HepB-Hib 1", xPct: 0.24 },
  { label: "OPV(IPV) 1",     xPct: 0.26 },
  { label: "DTP-HepB-Hib 2", xPct: 0.40 },
  { label: "MMR 1",          xPct: 0.78 },
];

function Problem1() {
  const frame = useCurrentFrame();

  // Rails draw progressively over the first ~1.5s.
  const ngRail = reveal(frame, 0, Math.round(1.5 * FPS));
  const egRail = reveal(frame, Math.round(0.6 * FPS), Math.round(2.1 * FPS));

  // Dose markers stagger after the rail starts drawing.
  const ngDose = stagger(frame, Math.round(0.4 * FPS), 6, BEAT.fast);
  const egDose = stagger(frame, Math.round(1.0 * FPS), 6, BEAT.fast);

  // Mismatch connectors fade in after both rails settle.
  const mismatchOpacity = reveal(frame, Math.round(2.6 * FPS), Math.round(3.4 * FPS));

  const railLeft = 80;
  const railRight = WIDTH - 80;
  const railWidth = railRight - railLeft;

  const ngY = 700;
  const egY = 1180;
  const tickH = 14;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <ScenePadding>
        <RailHeading>Same dates · two schedules.</RailHeading>

        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ position: "absolute", inset: 0 }}
        >
          {/* Rail spines */}
          <line
            x1={railLeft}
            y1={ngY}
            x2={railLeft + railWidth * ngRail}
            y2={ngY}
            stroke={C.inkSoft}
            strokeWidth={2}
          />
          <line
            x1={railLeft}
            y1={egY}
            x2={railLeft + railWidth * egRail}
            y2={egY}
            stroke={C.inkSoft}
            strokeWidth={2}
          />

          {/* Mismatch dashed connectors */}
          {NG_RAIL.filter((d) => d.mismatch).map((d, i) => {
            const x = railLeft + railWidth * d.xPct;
            return (
              <line
                key={i}
                x1={x}
                y1={ngY + tickH}
                x2={x}
                y2={egY - tickH}
                stroke={C.warn}
                strokeWidth={1.6}
                strokeDasharray="6 6"
                opacity={mismatchOpacity * 0.85}
              />
            );
          })}
        </svg>

        {/* Country labels */}
        <RailLabel y={ngY - 40} country="Nigeria" opacity={ngRail} />
        <RailLabel y={egY + 20} country="Egypt" opacity={egRail} />

        {/* NG markers */}
        {NG_RAIL.map((d, i) => (
          <DoseMarker
            key={`ng-${i}`}
            label={d.label}
            x={railLeft + railWidth * d.xPct}
            y={ngY}
            tone={d.mismatch ? "warn" : "ink"}
            opacity={ngDose(i)}
            anchor="above"
          />
        ))}
        {/* EG markers */}
        {EG_RAIL.map((d, i) => (
          <DoseMarker
            key={`eg-${i}`}
            label={d.label}
            x={railLeft + railWidth * d.xPct}
            y={egY}
            tone="ink"
            opacity={egDose(i)}
            anchor="below"
          />
        ))}

        <ShotTag id="problem-1" />
      </ScenePadding>
    </AbsoluteFill>
  );
}

function DoseMarker({
  label, x, y, tone, opacity, anchor,
}: {
  label: string;
  x: number;
  y: number;
  tone: "ink" | "warn";
  opacity: number;
  anchor: "above" | "below";
}) {
  const color = tone === "warn" ? C.warn : C.ink;
  const yOffset = anchor === "above" ? -56 : 28;
  const lift = riseDist(opacity, 8);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x - 6,
          top: y - 6,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: tone === "warn" ? C.warn : C.ink,
          opacity,
          boxShadow:
            tone === "warn"
              ? `0 0 0 4px ${C.warn}26`
              : `0 0 0 3px rgba(15,23,42,0.08)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x,
          top: y + yOffset + lift,
          transform: "translateX(-50%)",
          fontFamily: FONT.mono,
          fontSize: 16,
          letterSpacing: "0.04em",
          color,
          opacity,
          whiteSpace: "nowrap",
          background: "rgba(245, 245, 244, 0.85)",
          padding: "2px 6px",
          borderRadius: 4,
        }}
      >
        {label}
      </div>
    </>
  );
}

function RailLabel({
  y, country, opacity,
}: {
  y: number; country: string; opacity: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        top: y,
        opacity,
        fontFamily: FONT.mono,
        fontSize: 18,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: C.inkMuted,
      }}
    >
      {country}
    </div>
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 40,
        fontFamily: FONT.mono,
        fontSize: 22,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: C.inkMuted,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/* ============================================================== */
/* problem-2                                                      */
/* ============================================================== */

function Problem2() {
  const frame = useCurrentFrame();

  // Card slides in from the right with restrained spring-feel ease.
  const cardEnter = reveal(frame, 0, Math.round(0.8 * FPS));
  const cardX = (1 - cardEnter) * 60;

  // Highlight rows reveal one at a time, slowly.
  const highlightStart = (i: number) =>
    Math.round((1.0 + i * 0.55) * FPS);

  const ambiguousRows = ["OPV 1", "Hib 1", "Measles 1"];

  // Card geometry — used for FocusBackdrop spotlight.
  const cardW = 880;
  const cardH = 1180;
  const cardLeft = (WIDTH - cardW) / 2;
  const cardTop = 320;

  // Spotlight is centered on the ambiguous block (rows ~3..6).
  const focusActive = reveal(frame, Math.round(1.0 * FPS), Math.round(1.6 * FPS));
  const focusRect = {
    left: cardLeft + 28,
    top: cardTop + 230,
    width: cardW - 56,
    height: 320,
  };

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <FocusBackdrop active={focusActive * 0.7} rect={focusRect} feather={140} intensity={0.4}>
        <div
          style={{
            position: "absolute",
            left: cardLeft,
            top: cardTop,
            width: cardW,
            height: cardH,
            background: "#FBF8F1",
            border: `1px solid ${C.rule}`,
            borderRadius: 18,
            opacity: cardEnter,
            transform: `translateX(${cardX}px) rotate(-1.5deg)`,
            transformOrigin: "center",
            padding: 48,
            boxSizing: "border-box",
            boxShadow: "0 30px 80px -32px rgba(15,23,42,0.45)",
            fontFamily: FONT.sans,
          }}
        >
          <div
            style={{
              fontFamily: FONT.mono,
              fontSize: 18,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: C.inkMuted,
              marginBottom: 24,
            }}
          >
            What counts here?
          </div>

          {[
            ["BCG",       "birth"],
            ["OPV 0",     "birth"],
            ["Penta 1",   "6 wk"],
            ["OPV 1",     "6 wk"],
            ["Hib 1",     "—"],
            ["HepB 2",    "10 wk"],
            ["Measles 1", "9 mo"],
          ].map(([label, age]) => {
            const isAmbiguous = ambiguousRows.includes(label as string);
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  padding: "20px 0",
                  borderBottom: `1px solid ${C.ruleSoft}`,
                  fontSize: 30,
                }}
              >
                <span style={{ fontWeight: 500, color: C.ink }}>{label}</span>
                <span
                  style={{
                    fontFamily: "Caveat, 'Bradley Hand', cursive",
                    color: isAmbiguous ? C.warn : C.inkMuted,
                    fontSize: 32,
                  }}
                >
                  {age}
                </span>
              </div>
            );
          })}
        </div>

        {/* Outline the ambiguous rows one by one */}
        {ambiguousRows.map((row, i) => {
          const rowIndex = ["BCG", "OPV 0", "Penta 1", "OPV 1", "Hib 1", "HepB 2", "Measles 1"].indexOf(row);
          const yInside = 24 + 18 + rowIndex * 67;
          return (
            <EvidenceHighlight
              key={row}
              frame={frame}
              startFrame={highlightStart(i)}
              left={cardLeft + 32}
              top={cardTop + yInside}
              width={cardW - 64}
              height={56}
              tone="warn"
              hold={interpolate(i, [0, 2], [40, 22])}
              radius={6}
            />
          );
        })}
      </FocusBackdrop>

      <ShotTag id="problem-2" />
    </AbsoluteFill>
  );
}

function ScenePadding({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        background: "transparent",
        padding: "120px 60px 600px 60px",
        boxSizing: "border-box",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
