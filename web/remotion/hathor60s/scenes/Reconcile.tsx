/**
 * Scene 4 — "reconcile" (15s, 3 shots).
 *
 *  reconcile-1 (0–5s): Two parallel rails (Nigeria · source / Egypt ·
 *                      destination). Evidence chips travel along the
 *                      connectors instead of static stroke-dash draws —
 *                      sequential reveal, not a one-shot diagram.
 *
 *  reconcile-2 (5–10s): Per-antigen coverage panel — pip grid filled
 *                       column by column. Combination products illuminate
 *                       across columns simultaneously (one injection ≠
 *                       one antigen), reinforcing the cue.
 *
 *  reconcile-3 (10–15s): Phase-E gate as a horizontal pipeline of
 *                        deterministic checks. Recommendation chips travel
 *                        left → right through Schedule → Interval →
 *                        Contraindication → Verdict nodes. The active node
 *                        lights up; chips emerge with a PASS or FAIL
 *                        stamp. Failed chips route back, never to the UI.
 *
 * Honesty notes:
 *   - Doses on the rails are illustrative scaffolding; the production pass
 *     must use the schedules in `data/` rather than these placeholders.
 *   - Rule IDs are placeholder strings — the production pass must use real
 *     DAK rule IDs from the engine, not invented ones.
 */

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, FPS, WIDTH } from "../tokens";
import { BEAT, EASE, reveal, rise as riseDist, stagger } from "../motion";
import { ReconcileNode, NodeGlyphs } from "../components/ReconcileNode";
import { FocusBackdrop } from "../components/FocusBackdrop";
import { Chyron } from "./Extract";
import { ShotTag } from "./Hook";

const R1 = 5 * FPS;
const R2 = 5 * FPS;
const R3 = 5 * FPS;

export function Reconcile() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={R1} name="reconcile-1">
        <Reconcile1 />
      </Sequence>
      <Sequence from={R1} durationInFrames={R2} name="reconcile-2">
        <Reconcile2 />
      </Sequence>
      <Sequence from={R1 + R2} durationInFrames={R3} name="reconcile-3">
        <Reconcile3 />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ============================================================== */
/* reconcile-1                                                    */
/* ============================================================== */

type RailEntry = {
  label: string;
  mappedTo?: number;
  unmapped?: boolean;
};

const NIGERIA: RailEntry[] = [
  { label: "BCG · birth",      mappedTo: 0 },
  { label: "OPV 0 · birth",    mappedTo: 1 },
  { label: "Penta 1 · 6 wk",   mappedTo: 2 },
  { label: "OPV 1 · 6 wk",     mappedTo: 3 },
  { label: "Measles 1 · 9 mo", unmapped: true },
];

const EGYPT: RailEntry[] = [
  { label: "BCG · birth" },
  { label: "OPV 0 · birth" },
  { label: "DTP-HepB-Hib 1 · 2 mo" },
  { label: "OPV (IPV) 1 · 2 mo" },
  { label: "MMR 1 · 12 mo" },
];

function Reconcile1() {
  const frame = useCurrentFrame();

  // NG rail entries reveal first (left-side baseline).
  const ngRev = stagger(frame, Math.round(0.2 * FPS), 5, BEAT.med);
  // EG rail entries appear as connectors arrive.
  const egRev = stagger(frame, Math.round(1.6 * FPS), 6, BEAT.med);

  const railLeftX = 60;
  const railRightX = WIDTH - 60 - 460;
  const topPad = 280;
  const rowH = 110;
  const pillW = 460;
  const pillH = 64;

  // Chip travel timings, one per mapped pair.
  const chipStart = (i: number) => Math.round((1.0 + i * 0.3) * FPS);
  const chipDur = Math.round(0.9 * FPS);

  // Unmapped pulse near the end.
  const pulse = interpolate(
    frame,
    [Math.round(3.4 * FPS), Math.round(3.4 * FPS) + 8, Math.round(3.4 * FPS) + 22],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <ScenePadding>
      <Chyron>Source ↔ destination.</Chyron>

      <div
        style={{
          marginTop: 28,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: FONT.mono,
          fontSize: 18,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.inkMuted,
          padding: "0 4px",
        }}
      >
        <span>Nigeria · source</span>
        <span>Egypt · destination</span>
      </div>

      {/* Pills */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 280 }}>
        {NIGERIA.map((entry, i) => (
          <Pill
            key={`n${i}`}
            entry={entry}
            side="left"
            top={i * rowH}
            opacity={ngRev(i)}
            pulse={entry.unmapped ? pulse : 0}
          />
        ))}
        {EGYPT.map((entry, i) => (
          <Pill
            key={`e${i}`}
            entry={entry}
            side="right"
            top={i * rowH}
            opacity={egRev(i)}
            pulse={0}
          />
        ))}
      </div>

      {/* Connectors + traveling chips */}
      <svg
        width="100%"
        height={rowH * NIGERIA.length + 60}
        viewBox={`0 0 ${WIDTH} ${rowH * NIGERIA.length + 60}`}
        style={{ position: "absolute", left: 0, top: 280, pointerEvents: "none" }}
      >
        {NIGERIA.map((entry, i) => {
          if (entry.unmapped || entry.mappedTo === undefined) return null;
          const y1 = i * rowH + pillH / 2;
          const y2 = entry.mappedTo * rowH + pillH / 2;
          const x1 = pillW + 12;
          const x2 = WIDTH - 120 - pillW;
          const draw = reveal(frame, chipStart(i), chipStart(i) + chipDur);
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={C.rule}
                strokeWidth={2}
              />
              <line
                x1={x1}
                y1={y1}
                x2={x1 + (x2 - x1) * draw}
                y2={y1 + (y2 - y1) * draw}
                stroke={C.ok}
                strokeWidth={2.5}
                opacity={0.9}
              />
              {/* Traveling chip dot */}
              <circle
                cx={x1 + (x2 - x1) * draw}
                cy={y1 + (y2 - y1) * draw}
                r={6}
                fill={C.ok}
                opacity={draw > 0 && draw < 0.98 ? 1 : 0}
              />
            </g>
          );
        })}
      </svg>

      <ShotTag id="reconcile-1" />
    </ScenePadding>
  );
}

function Pill({
  entry, side, top, opacity, pulse,
}: {
  entry: RailEntry; side: "left" | "right"; top: number; opacity: number; pulse: number;
}) {
  const isUnmapped = entry.unmapped;
  const tone = isUnmapped ? C.warn : C.ink;
  const bg = isUnmapped ? C.warnSoft : C.surface;
  const lift = riseDist(opacity, 14);
  return (
    <div
      style={{
        position: "absolute",
        top,
        [side]: 0,
        width: 460,
        background: bg,
        border: `1px solid ${isUnmapped ? C.warn : C.rule}`,
        borderRadius: 12,
        padding: "16px 20px",
        fontFamily: FONT.sans,
        fontSize: 22,
        color: tone,
        boxShadow: `0 0 0 ${pulse * 6}px ${C.warn}22, 0 6px 18px -10px rgba(15,23,42,0.18)`,
        opacity,
        transform: `translateY(${lift}px)`,
      }}
    >
      {entry.label}
    </div>
  );
}

/* ============================================================== */
/* reconcile-2                                                    */
/* ============================================================== */

type Antigen = { label: string; pips: number; filled: number; combo?: boolean };

const ANTIGENS: Antigen[] = [
  { label: "DTP",     pips: 4, filled: 3, combo: true },
  { label: "Polio",   pips: 5, filled: 4 },
  { label: "Hib",     pips: 4, filled: 3, combo: true },
  { label: "HepB",    pips: 4, filled: 3, combo: true },
  { label: "Measles", pips: 2, filled: 1 },
  { label: "PCV",     pips: 3, filled: 2 },
];

function Reconcile2() {
  const frame = useCurrentFrame();

  // Combination products glow window.
  const comboFlash = interpolate(
    frame,
    [
      Math.round(2.8 * FPS),
      Math.round(3.0 * FPS),
      Math.round(3.6 * FPS),
      Math.round(3.9 * FPS),
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.glide },
  );

  // Combination-product callout fades in with the flash.
  const calloutOpacity = reveal(frame, Math.round(2.6 * FPS), Math.round(3.2 * FPS));

  return (
    <ScenePadding>
      <Chyron>Coverage, per antigen.</Chyron>

      <div
        style={{
          marginTop: 36,
          display: "grid",
          gridTemplateColumns: `repeat(${ANTIGENS.length}, 1fr)`,
          gap: 14,
          background: C.surface,
          border: `1px solid ${C.rule}`,
          borderRadius: 14,
          padding: 28,
          boxShadow: "0 18px 48px -28px rgba(15,23,42,0.22)",
        }}
      >
        {ANTIGENS.map((a, ci) => (
          <div key={a.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 14,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: C.inkMuted,
                marginBottom: 14,
              }}
            >
              {a.label}
            </div>
            {Array.from({ length: a.pips }).map((_, pi) => {
              // Sequential reveal: column by column, top to bottom.
              const idx = ci * 6 + pi;
              const fillT = reveal(
                frame,
                Math.round((0.2 + idx * 0.06) * FPS),
                Math.round((0.5 + idx * 0.06) * FPS),
              );
              const filled = pi < a.filled;
              const comboGlow = a.combo ? comboFlash : 0;
              return (
                <div
                  key={pi}
                  style={{
                    width: 44,
                    height: 22,
                    borderRadius: 4,
                    marginBottom: 10,
                    background: filled ? C.ok : C.ruleSoft,
                    border: `1px solid ${filled ? C.ok : C.rule}`,
                    opacity: fillT,
                    boxShadow: filled
                      ? `0 0 ${comboGlow * 14}px ${C.ok}, 0 0 ${comboGlow * 4}px ${C.ok}`
                      : "none",
                    transform: `translateY(${riseDist(fillT, 6)}px)`,
                  }}
                />
              );
            })}
            {a.combo ? (
              <div
                style={{
                  marginTop: 6,
                  fontFamily: FONT.mono,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: C.ok,
                  opacity: comboFlash * 0.9,
                }}
              >
                combo
              </div>
            ) : (
              <div style={{ marginTop: 6, height: 16 }} />
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 28,
          fontFamily: FONT.sans,
          fontSize: 22,
          color: C.inkMuted,
          textAlign: "center",
          maxWidth: 760,
          marginLeft: "auto",
          marginRight: "auto",
          opacity: calloutOpacity,
          transform: `translateY(${riseDist(calloutOpacity, 8)}px)`,
        }}
      >
        One injection. Multiple antigens covered at once.
      </div>

      <ShotTag id="reconcile-2" />
    </ScenePadding>
  );
}

/* ============================================================== */
/* reconcile-3                                                    */
/* ============================================================== */

type Recommendation = {
  label: string;
  ruleId: string; // placeholder until real DAK IDs land
  result: "pass" | "fail";
};

const RECS: Recommendation[] = [
  { label: "OPV 1 due",         ruleId: "DAK-IMM-OPV-1.0", result: "pass" },
  { label: "Measles 1 overdue", ruleId: "DAK-IMM-MCV-2.1", result: "fail" },
  { label: "Catch-up: PCV 2",   ruleId: "DAK-IMM-PCV-1.3", result: "pass" },
];

const STAGES = [
  { key: "schedule",       label: "Schedule",       icon: NodeGlyphs.calendar },
  { key: "interval",       label: "Interval",       icon: NodeGlyphs.scale },
  { key: "contraindication", label: "Contraindication", icon: NodeGlyphs.check },
  { key: "verdict",        label: "Verdict",        icon: NodeGlyphs.user },
];

function Reconcile3() {
  const frame = useCurrentFrame();

  // Each chip moves through 4 stages over ~1.0s, staggered by 0.4s.
  const chipStart = (i: number) => Math.round((0.4 + i * 0.45) * FPS);
  const chipTraversal = Math.round(2.2 * FPS);

  // Determine active stage per chip from progress.
  const chipProgress = (i: number) =>
    reveal(frame, chipStart(i), chipStart(i) + chipTraversal);

  // Pipeline geometry — 4 nodes, 3 connectors.
  const pipelineW = WIDTH - 200;
  const stageGap = pipelineW / (STAGES.length - 1);
  const stageY = 720;
  const nodeW = 220;

  // Active stage per stage-index = max progress across chips.
  const stageActiveAt = STAGES.map((_, si) => {
    let max = 0;
    let any = false;
    for (let i = 0; i < RECS.length; i++) {
      const p = chipProgress(i);
      const slot = p * (STAGES.length - 1);
      if (Math.abs(slot - si) < 0.5) {
        max = Math.max(max, 1);
        any = true;
      } else if (slot > si) {
        max = Math.max(max, 0.5); // already passed
      }
    }
    return { active: any, after: max };
  });

  return (
    <ScenePadding>
      <Chyron>Every recommendation, gated.</Chyron>

      <div
        style={{
          marginTop: 36,
          background: C.surface,
          border: `1px solid ${C.rule}`,
          borderRadius: 18,
          padding: "32px 36px",
          minHeight: 1080,
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 18px 48px -28px rgba(15,23,42,0.22)",
        }}
      >
        {/* Section header for the gate */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: FONT.mono,
            fontSize: 13,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.inkMuted,
          }}
        >
          <span>Phase E · rules_engine.validate()</span>
          <span style={{ color: C.inkSoft }}>deterministic</span>
        </div>

        {/* Pipeline rail */}
        <svg
          width="100%"
          height={120}
          style={{ position: "absolute", left: 0, top: stageY - 60, overflow: "visible" }}
        >
          {STAGES.slice(0, -1).map((_, si) => {
            const x1 = 36 + si * stageGap + nodeW / 2;
            const x2 = 36 + (si + 1) * stageGap + nodeW / 2;
            return (
              <line
                key={si}
                x1={x1}
                y1={60}
                x2={x2}
                y2={60}
                stroke={C.rule}
                strokeWidth={2}
                strokeDasharray="6 8"
              />
            );
          })}
        </svg>

        {/* Pipeline nodes */}
        <div
          style={{
            position: "absolute",
            left: 36,
            top: stageY,
            display: "flex",
            justifyContent: "space-between",
            width: pipelineW,
          }}
        >
          {STAGES.map((stage, si) => {
            const state = stageActiveAt[si].active
              ? "active"
              : stageActiveAt[si].after > 0
                ? "done"
                : "idle";
            return (
              <ReconcileNode
                key={stage.key}
                label={stage.label}
                state={state}
                width={nodeW}
                icon={stage.icon}
              />
            );
          })}
        </div>

        {/* Recommendation chips traveling through the pipeline */}
        {RECS.map((rec, i) => {
          const p = chipProgress(i);
          const x = 36 + p * pipelineW * (1 - 1 / RECS.length) + nodeW / 2 - 110;
          const y = stageY - 220 - i * 90;
          const passedAll = p >= 0.98;
          const tone = rec.result === "pass" ? C.ok : C.warn;
          const bg = passedAll
            ? rec.result === "pass"
              ? C.okSoft
              : C.warnSoft
            : C.surface;
          const border = passedAll ? tone : C.inkSoft;

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: 220,
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: 12,
                padding: "12px 14px",
                fontFamily: FONT.sans,
                color: C.ink,
                opacity: p > 0 ? 1 : 0,
                boxShadow:
                  passedAll
                    ? `0 0 0 4px ${tone}22, 0 12px 28px -16px rgba(15,23,42,0.32)`
                    : "0 8px 22px -16px rgba(15,23,42,0.22)",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 600 }}>{rec.label}</div>
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: passedAll ? tone : C.inkMuted,
                  marginTop: 4,
                  letterSpacing: "0.06em",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{rec.ruleId}</span>
                {passedAll ? <span style={{ fontWeight: 700 }}>{rec.result.toUpperCase()}</span> : null}
              </div>
            </div>
          );
        })}

        {/* Output zone marker — what reaches the clinician */}
        <div
          style={{
            position: "absolute",
            right: 36,
            top: stageY - 240,
            fontFamily: FONT.mono,
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.inkSoft,
            textAlign: "right",
          }}
        >
          to clinician →
        </div>

        {/* Spotlight on the active stage to direct attention */}
        <FocusBackdrop
          active={interpolate(frame, [Math.round(0.5 * FPS), Math.round(3.5 * FPS)], [0, 0.5], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
          rect={null}
          feather={200}
          intensity={0.18}
        />
      </div>

      <ShotTag id="reconcile-3" />
    </ScenePadding>
  );
}

/* ------------------------------------------------------------------ */

function ScenePadding({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        padding: "120px 60px 540px 60px",
        boxSizing: "border-box",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
