/**
 * Scene 5 — "payoff" (17s, 2 shots).
 *
 *  payoff-1 (0–9s): Clinician review surface inside a DeviceFrame.
 *                   Header → Documented column → Gaps column reveal
 *                   sequentially with riseIn motion. A clinical cursor
 *                   glides toward Override; FocusBackdrop dims everything
 *                   except the footer controls at the end, signalling
 *                   "the clinician decides".
 *
 *  payoff-2 (9–17s): Closing card. Hathor wordmark fades up; a hairline
 *                    "scan" sweep draws beneath it. Three lines stagger
 *                    in. PharosBeam holds a quarter-rotation behind.
 *
 *  Per render-notes.md, payoff-1 should mirror the real reconcile UI
 *  shipped in web/. This scaffold uses a structural placeholder; before
 *  final export, replace it with a captured screenshot or render of the
 *  real Next.js component.
 */

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, FPS, HEIGHT, WIDTH } from "../tokens";
import { BEAT, EASE, reveal, rise as riseDist } from "../motion";
import { PharosBeam } from "../PharosBeam";
import { DeviceFrame } from "../components/DeviceFrame";
import { FocusBackdrop } from "../components/FocusBackdrop";
import { ShotTag } from "./Hook";

const P1 = 9 * FPS;
const P2 = 8 * FPS;

export function Payoff() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={P1} name="payoff-1">
        <Payoff1 />
      </Sequence>
      <Sequence from={P1} durationInFrames={P2} name="payoff-2">
        <Payoff2 />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ============================================================== */
/* payoff-1                                                       */
/* ============================================================== */

function Payoff1() {
  const frame = useCurrentFrame();

  const frameEnter = reveal(frame, 0, Math.round(0.5 * FPS));
  const headerOpacity = reveal(frame, Math.round(0.4 * FPS), Math.round(1.0 * FPS));
  const dosesOpacity = reveal(frame, Math.round(2.0 * FPS), Math.round(2.6 * FPS));
  const gapsOpacity = reveal(frame, Math.round(4.6 * FPS), Math.round(5.2 * FPS));

  // Cursor glides to the Override footer button around 6.6s, dwells.
  // Coordinates are scene-space; the DeviceFrame footer sits ~y=970.
  const cursorX = interpolate(
    frame,
    [Math.round(5.4 * FPS), Math.round(6.6 * FPS), Math.round(8.4 * FPS)],
    [240, 320, 320],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.glide },
  );
  const cursorY = interpolate(
    frame,
    [Math.round(5.4 * FPS), Math.round(6.6 * FPS), Math.round(8.4 * FPS)],
    [620, 980, 980],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.glide },
  );

  // Spotlight on Override footer in the final ~1.5s.
  const focusActive = reveal(frame, Math.round(7.0 * FPS), Math.round(7.6 * FPS));
  const focusRect = {
    left: 80,
    top: 940,
    width: WIDTH - 160,
    height: 110,
  };

  return (
    <AbsoluteFill style={{ background: C.bg, padding: "100px 60px 540px 60px", boxSizing: "border-box" }}>
      <FocusBackdrop active={focusActive * 0.6} rect={focusRect} feather={120} intensity={0.4}>
        <div
          style={{
            opacity: frameEnter,
            transform: `translateY(${riseDist(frameEnter, 18)}px)`,
          }}
        >
          <DeviceFrame
            variant="browser"
            url="hathor.local/reconcile"
            title="reconcile"
            showTodo
            shotId="payoff-1"
          >
            {/* Header */}
            <div
              style={{
                opacity: headerOpacity,
                transform: `translateY(${riseDist(headerOpacity, 12)}px)`,
                fontFamily: FONT.sans,
                background: C.surfaceMuted,
                borderBottom: `1px solid ${C.rule}`,
                padding: "20px 24px",
              }}
            >
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 14,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: C.inkMuted,
                }}
              >
                Reconcile · Phase 1 · synthetic
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 32,
                  fontWeight: 700,
                  color: C.ink,
                  letterSpacing: "-0.4px",
                }}
              >
                Child · 14 months
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 22,
                  color: C.inkMuted,
                }}
              >
                Nigeria → Egypt
              </div>
            </div>

            {/* Two-column body — height tuned so the footer Override / Confirm
                bar lands ABOVE the burned-in caption band. */}
            <div style={{ display: "flex", gap: 0, minHeight: 760 }}>
              {/* Documented doses */}
              <div
                style={{
                  flex: 1.4,
                  opacity: dosesOpacity,
                  transform: `translateY(${riseDist(dosesOpacity, 12)}px)`,
                  background: C.surface,
                  borderRight: `1px solid ${C.rule}`,
                  padding: 22,
                  fontFamily: FONT.sans,
                }}
              >
                <SectionTitle>Documented</SectionTitle>
                {[
                  ["BCG · birth",      "card · high"],
                  ["OPV 0 · birth",    "card · high"],
                  ["Penta 1 · 6 wk",   "card · high"],
                  ["OPV 1 · 6 wk",     "card · low → confirmed"],
                  ["PCV 1 · 6 wk",     "card · high"],
                ].map(([line, prov], i) => {
                  const lineRev = reveal(
                    frame,
                    Math.round((2.2 + i * 0.18) * FPS),
                    Math.round((2.6 + i * 0.18) * FPS),
                  );
                  return (
                    <div
                      key={line}
                      style={{
                        padding: "12px 0",
                        borderBottom: `1px solid ${C.ruleSoft}`,
                        opacity: lineRev,
                        transform: `translateY(${riseDist(lineRev, 6)}px)`,
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 500, color: C.ink }}>{line}</div>
                      <div style={{ fontSize: 15, color: C.inkMuted, fontFamily: FONT.mono, marginTop: 2 }}>
                        provenance · {prov}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Gaps */}
              <div
                style={{
                  flex: 1,
                  opacity: gapsOpacity,
                  transform: `translateY(${riseDist(gapsOpacity, 12)}px)`,
                  background: C.surface,
                  padding: 22,
                  fontFamily: FONT.sans,
                }}
              >
                <SectionTitle>Gaps</SectionTitle>
                {[
                  ["MMR 1",       "due now (catch-up)"],
                  ["Penta 3",     "due at 14 wk"],
                  ["Yellow fever","due at 9 mo"],
                ].map(([v, suggestion], i) => {
                  const lineRev = reveal(
                    frame,
                    Math.round((4.8 + i * 0.18) * FPS),
                    Math.round((5.2 + i * 0.18) * FPS),
                  );
                  return (
                    <div
                      key={v}
                      style={{
                        padding: "12px 0",
                        borderBottom: `1px solid ${C.ruleSoft}`,
                        opacity: lineRev,
                        transform: `translateY(${riseDist(lineRev, 6)}px)`,
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 500, color: C.ink }}>{v}</div>
                      <div style={{ fontSize: 16, color: C.warn, fontFamily: FONT.mono, marginTop: 2 }}>
                        {suggestion}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer controls */}
            <div
              style={{
                display: "flex",
                gap: 16,
                padding: "20px 24px",
                background: C.surfaceMuted,
                borderTop: `1px solid ${C.rule}`,
              }}
            >
              <FooterButton label="Override" tone="warn" emphasized={focusActive > 0.4} />
              <FooterButton label="Confirm"  tone="ok" />
            </div>
          </DeviceFrame>
        </div>

        {/* Cursor */}
        <div
          style={{
            position: "absolute",
            left: cursorX,
            top: cursorY,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        >
          <svg width={28} height={28} viewBox="0 0 28 28">
            <path
              d="M2 2 L22 14 L13 16 L18 26 L14 28 L9 18 L2 22 Z"
              fill={C.ink}
              stroke={C.surface}
              strokeWidth={1.5}
            />
          </svg>
        </div>
      </FocusBackdrop>

      <ShotTag id="payoff-1" />
    </AbsoluteFill>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 14,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: C.inkMuted,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function FooterButton({
  label, tone, emphasized = false,
}: { label: string; tone: "ok" | "warn"; emphasized?: boolean }) {
  const color = tone === "ok" ? C.ok : C.warn;
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        padding: "16px 0",
        border: `1.5px solid ${color}`,
        color,
        borderRadius: 10,
        fontFamily: FONT.sans,
        fontSize: 24,
        fontWeight: 600,
        background: C.surface,
        boxShadow: emphasized ? `0 0 0 4px ${color}22` : "none",
        transition: "box-shadow 200ms",
      }}
    >
      {label}
    </div>
  );
}

/* ============================================================== */
/* payoff-2                                                       */
/* ============================================================== */

function Payoff2() {
  const frame = useCurrentFrame();

  const wordmark = reveal(frame, Math.round(0.4 * FPS), Math.round(1.4 * FPS));
  const underline = reveal(frame, Math.round(1.0 * FPS), Math.round(2.0 * FPS));
  const line1 = reveal(frame, Math.round(1.8 * FPS), Math.round(2.5 * FPS));
  const line2 = reveal(frame, Math.round(2.6 * FPS), Math.round(3.3 * FPS));
  const line3 = reveal(frame, Math.round(3.6 * FPS), Math.round(4.4 * FPS));

  // Beam quarter-rotation across the full shot.
  const beamFrames = Math.round(6.0 * FPS);

  return (
    <AbsoluteFill
      style={{
        background: C.bgDeep,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <PharosBeam
        frame={frame}
        durationFrames={beamFrames}
        originX={0.5}
        originY={0.45}
        fromDeg={-45}
        toDeg={45}
        length={1300}
        width={520}
        intensity={0.55}
      />

      <div
        style={{
          opacity: wordmark,
          transform: `translateY(${(1 - wordmark) * 14}px)`,
          fontFamily: FONT.sans,
          fontSize: 132,
          fontWeight: 800,
          letterSpacing: "-3px",
          color: "#FFFFFF",
          textShadow: "0 2px 24px rgba(255, 230, 170, 0.18)",
          position: "relative",
          padding: "0 12px",
        }}
      >
        Hathor

        {/* Hairline scan-style underline draws across the wordmark. */}
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: -8,
            height: 2,
            background: `linear-gradient(90deg, transparent 0%, ${C.beam} 30%, ${C.beamCore} 50%, ${C.beam} 70%, transparent 100%)`,
            transform: `scaleX(${underline})`,
            transformOrigin: "left",
            mixBlendMode: "screen",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          fontFamily: FONT.sans,
          color: "#E2E8F0",
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: "-0.3px",
          zIndex: 1,
        }}
      >
        <div style={{ opacity: line1, transform: `translateY(${riseDist(line1, 8)}px)` }}>The agent reasons.</div>
        <div style={{ opacity: line2, transform: `translateY(${riseDist(line2, 8)}px)` }}>The rules verify.</div>
        <div style={{ opacity: line3, transform: `translateY(${riseDist(line3, 8)}px)` }}>The clinician decides — always.</div>
      </div>

      <ShotTag id="payoff-2" />
    </AbsoluteFill>
  );
}

void HEIGHT;
void BEAT;
