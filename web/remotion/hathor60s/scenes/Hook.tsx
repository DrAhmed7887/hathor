/**
 * Scene 1 — "hook" (8s, 2 shots).
 *
 *  hook-1 (0–4s):  Tight overhead of a synthetic paediatric vaccine card.
 *                  Card enters slightly blurred and offset (handwritten-feel
 *                  jitter). A scan sweep passes top to bottom; after the
 *                  sweep, the card resolves crisp — signalling "messy
 *                  analog record → structured clinical evidence". A faint
 *                  Pharos beam grazes the right edge once.
 *
 *  hook-2 (4–8s):  Same card centered, with Source · Nigeria / Destination
 *                  · Egypt labels rising on either side and diverging rails
 *                  drawing outward. Subtle context tags read "complete" /
 *                  "incomplete" — language taken directly from the cue, not
 *                  invented validation copy.
 */

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, FPS, HEIGHT, WIDTH } from "../tokens";
import { BEAT, EASE, cameraGlide, reveal, rise as riseDist } from "../motion";
import { PharosBeam } from "../PharosBeam";
import { ScanSweep } from "../components/ScanSweep";
import { EvidenceHighlight } from "../components/EvidenceHighlight";

const HOOK1_FRAMES = 4 * FPS;
const HOOK2_FRAMES = 4 * FPS;

export function Hook() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={HOOK1_FRAMES} name="hook-1">
        <Hook1 />
      </Sequence>
      <Sequence
        from={HOOK1_FRAMES}
        durationInFrames={HOOK2_FRAMES}
        name="hook-2"
      >
        <Hook2 />
      </Sequence>
    </AbsoluteFill>
  );
}

function Hook1() {
  const frame = useCurrentFrame();

  // Card entrance — small lift + clinical ease, no spring overshoot.
  const enter = reveal(frame, 0, 18);
  const lift = riseDist(enter, 18);

  // Slow camera push-in across the full 4s.
  const camera = cameraGlide(frame, 0, HOOK1_FRAMES, 1.0, 1.06);

  // Scan sweep window: 0.4s → 1.6s.
  const sweepStart = Math.round(0.4 * FPS);
  const sweepDur = Math.round(1.2 * FPS);
  const sweepT = interpolate(
    frame,
    [sweepStart, sweepStart + sweepDur],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.linear },
  );
  // Pre-sweep blur dissolves as the sweep passes; post-sweep is crisp.
  const blurPx = (1 - sweepT) * 6;

  // Pharos beam: a single graze starting after the sweep settles.
  const beamFrame = Math.max(0, frame - Math.round(2.0 * FPS));
  const beamWindow = Math.round(1.1 * FPS);

  // Card geometry (so EvidenceHighlight can lock onto a row).
  const cardW = 820;
  const cardH = 1180;
  const cardLeft = (WIDTH - cardW) / 2;
  const cardTop = (HEIGHT - cardH) / 2;
  // The "Penta 1 · 6 wk" row sits ~ row 4 inside the card.
  const rowOffset = 274;
  const rowHeight = 60;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: enter,
          transform: `translateY(${lift}px) scale(${camera})`,
        }}
      >
        <div
          style={{
            position: "relative",
            filter: `blur(${blurPx}px)`,
          }}
        >
          <CardProp width={cardW} height={cardH} jitter={(1 - sweepT) * 0.8} />

          {/* Scan sweep is bound to the card so it reads as scanning *that*. */}
          <ScanSweep
            frame={frame}
            startFrame={sweepStart}
            durationFrames={sweepDur}
            height={cardH}
            width={cardW}
            thickness={3}
            glow={42}
          />
        </div>
      </div>

      {/* Restrained evidence outline lands after the sweep finishes — picks
          out one row to telegraph the structured-evidence promise. */}
      <EvidenceHighlight
        frame={frame}
        startFrame={Math.round(2.0 * FPS)}
        left={cardLeft + 40}
        top={cardTop + rowOffset}
        width={cardW - 80}
        height={rowHeight}
        tone="ok"
        hold={20}
        radius={6}
      />

      {beamFrame < beamWindow ? (
        <PharosBeam
          frame={beamFrame}
          durationFrames={beamWindow}
          originX={0.18}
          originY={0.5}
          fromDeg={-8}
          toDeg={6}
          length={1700}
          width={420}
          intensity={0.9}
        />
      ) : null}

      <ShotTag id="hook-1" />
    </AbsoluteFill>
  );
}

function Hook2() {
  const frame = useCurrentFrame();

  // Card enters from a slight scale-down (camera pulling back a hair).
  const cardScale = interpolate(frame, [0, 24], [1.04, 0.92], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.glide,
  });

  // Rails draw outward with no overshoot.
  const railProgress = interpolate(
    frame,
    [Math.round(0.6 * FPS), HOOK2_FRAMES - BEAT.fast],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.clinical },
  );

  // Sequential side reveals — Nigeria first, then Egypt.
  const leftReveal = reveal(frame, Math.round(0.8 * FPS), Math.round(1.4 * FPS));
  const rightReveal = reveal(frame, Math.round(1.6 * FPS), Math.round(2.2 * FPS));

  // Tags fade in *after* the country labels land.
  const leftTag = reveal(frame, Math.round(2.4 * FPS), Math.round(2.9 * FPS));
  const rightTag = reveal(frame, Math.round(3.0 * FPS), Math.round(3.5 * FPS));

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* Diverging rails behind everything. */}
      <Rail side="left"  progress={railProgress} />
      <Rail side="right" progress={railProgress} />

      {/* Country side panels */}
      <SidePanel
        side="left"
        opacity={leftReveal}
        country="Nigeria"
        role="Source"
        tagOpacity={leftTag}
        tagText="complete"
        tagTone="ok"
      />
      <SidePanel
        side="right"
        opacity={rightReveal}
        country="Egypt"
        role="Destination"
        tagOpacity={rightTag}
        tagText="incomplete"
        tagTone="warn"
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ transform: `scale(${cardScale})` }}>
          <CardProp width={780} height={1120} jitter={0} />
        </div>
      </div>
      <ShotTag id="hook-2" />
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */

function CardProp({ width, height, jitter }: { width: number; height: number; jitter: number }) {
  // Synthetic, neutral, no faces. Mimics a paediatric vaccine card layout
  // with no real patient data. Real photo capture is a TODO per render-notes.
  // `jitter` 0..1 nudges the handwritten dates so a pre-sweep card feels
  // a touch off-grid; once the scan completes the jitter resolves to 0.
  return (
    <div
      style={{
        width,
        height,
        background: "#FBF8F1",
        border: `1px solid ${C.rule}`,
        borderRadius: 14,
        padding: 44,
        boxSizing: "border-box",
        boxShadow: "0 24px 60px -28px rgba(15,23,42,0.35)",
        position: "relative",
        fontFamily: FONT.sans,
        color: C.ink,
      }}
    >
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 16,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.inkMuted,
        }}
      >
        Child immunization record
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 22,
          color: C.inkSoft,
          fontStyle: "italic",
        }}
      >
        synthetic example — no real patient data
      </div>

      <div style={{ marginTop: 30 }}>
        {[
          ["BCG",      "birth",  -1],
          ["OPV 0",    "birth",   1],
          ["HepB 0",   "birth",  -2],
          ["Penta 1",  "6 wk",    2],
          ["OPV 1",    "6 wk",   -1],
          ["PCV 1",    "6 wk",    1],
          ["Penta 2",  "10 wk",  -2],
          ["Measles 1","9 mo",    2],
        ].map((entry, i) => {
          const [v, age, drift] = entry as [string, string, number];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "12px 0",
                borderBottom: `1px solid ${C.ruleSoft}`,
                fontSize: 26,
              }}
            >
              <span style={{ fontWeight: 500 }}>{v}</span>
              <span
                style={{
                  color: C.inkMuted,
                  fontFamily: "Caveat, 'Bradley Hand', cursive",
                  fontSize: 30,
                  transform: `translate(${drift * jitter * 4}px, ${drift * jitter * 1.2}px) rotate(${drift * jitter * 0.6}deg)`,
                  transformOrigin: "right baseline",
                  display: "inline-block",
                }}
              >
                {age}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidePanel({
  side, opacity, country, role, tagOpacity, tagText, tagTone,
}: {
  side: "left" | "right";
  opacity: number;
  country: string;
  role: string;
  tagOpacity: number;
  tagText: string;
  tagTone: "ok" | "warn";
}) {
  const tone = tagTone === "ok" ? C.ok : C.warn;
  const toneSoft = tagTone === "ok" ? C.okSoft : C.warnSoft;
  const lift = riseDist(opacity, 16);
  return (
    <div
      style={{
        position: "absolute",
        top: HEIGHT * 0.16,
        [side]: 60,
        opacity,
        transform: `translateY(${lift}px)`,
        fontFamily: FONT.sans,
        textAlign: side,
      }}
    >
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 18,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.inkMuted,
        }}
      >
        {role}
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: "-0.4px",
          color: C.ink,
          marginTop: 4,
        }}
      >
        {country}
      </div>
      <div
        style={{
          marginTop: 12,
          opacity: tagOpacity,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 999,
          background: toneSoft,
          border: `1px solid ${tone}`,
          fontFamily: FONT.mono,
          fontSize: 16,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: tone,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: tone,
          }}
        />
        {tagText}
      </div>
    </div>
  );
}

function Rail({
  side, progress,
}: {
  side: "left" | "right"; progress: number;
}) {
  const length = WIDTH * 0.34 * progress;
  return (
    <div
      style={{
        position: "absolute",
        top: HEIGHT * 0.5,
        [side]: 60,
        width: length,
        height: 2,
        background: C.inkSoft,
        opacity: 0.5,
      }}
    />
  );
}

export function ShotTag({ id }: { id: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 28,
        right: 28,
        fontFamily: FONT.mono,
        fontSize: 18,
        letterSpacing: "0.16em",
        color: C.inkSoft,
        background: "rgba(255,255,255,0.6)",
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${C.rule}`,
      }}
    >
      {id}
    </div>
  );
}
