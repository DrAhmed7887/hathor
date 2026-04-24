/**
 * PitchDeck — 60s Remotion composition for /pitch.
 *
 * The voiceover-ready narrative arc for the hackathon pitch:
 *   Problem → RITAG mandate → Vaccine City → Egypt NDHS → HATHOR
 *   thesis → two safety gates → partners → ask.
 *
 * Sourced directly from PRD §§1-2 (Problem + Strategic Context) and
 * §5.6 (Two Safety Loops). All claims that appear in the slides are
 * claims the PRD already carries with attribution to the three
 * research reports.
 *
 * Timing (30 fps, 1800 frames, 60s — 8 slides @ 7.5s each):
 *     0-225    Slide 1 · Problem
 *   225-450    Slide 2 · RITAG Cairo 2026
 *   450-675    Slide 3 · Vaccine City
 *   675-900    Slide 4 · Egypt NDHS 2025-2029
 *   900-1125   Slide 5 · HATHOR thesis
 *  1125-1350   Slide 6 · Two safety gates
 *  1350-1575   Slide 7 · Partners
 *  1575-1800   Slide 8 · Ask
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";

export const PITCH_FPS = 30;
export const PITCH_DURATION_FRAMES = 1800;
export const PITCH_WIDTH = 1920;
export const PITCH_HEIGHT = 1080;
const SLIDE_FRAMES = 225;

const P = {
  paper:     "#F6F0E4",
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  stone:     "#CFC4B1",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  ink:       "#1C1917",
  ink2:      "#292524",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  ok:        "#5F7A52",
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
  bad:       "#A3453B",
  badSoft:   "#F3E3DF",
  plum:      "#6E4A6B",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export function PitchDeck() {
  return (
    <AbsoluteFill style={{ background: P.paper, overflow: "hidden" }}>
      <FilmGrain />

      <Sequence from={0} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="01 · The gap" title="14.3 million children">
          <SlideProblem />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 1} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="02 · RITAG Cairo · February 2026" title="The mandate is digital.">
          <SlideRitag />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 2} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="03 · Egypt Vaccine City · April 2026" title="140 million doses by 2030.">
          <SlideVaccineCity />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 3} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="04 · Egypt National Digital Health Strategy 2025-2029" title="AI becomes institutional.">
          <SlideNdhs />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 4} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="05 · The HATHOR thesis" title="Reasoning over extraction.">
          <SlideThesis />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 5} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="06 · Two safety gates" title="The agent reasons. The output layer is gated.">
          <SlideGates />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 6} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="07 · Partners" title="Who HATHOR needs to reach.">
          <SlidePartners />
        </Slide>
      </Sequence>

      <Sequence from={SLIDE_FRAMES * 7} durationInFrames={SLIDE_FRAMES}>
        <Slide kicker="08 · The ask" title="Let HATHOR carry the cards.">
          <SlideAsk />
        </Slide>
      </Sequence>
    </AbsoluteFill>
  );
}

// ── Slide chrome ────────────────────────────────────────────────────────────

function Slide({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const exit = interpolate(
    frame,
    [SLIDE_FRAMES - 20, SLIDE_FRAMES],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translate = interpolate(frame, [0, 20], [24, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        padding: "80px 120px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
        opacity: enter * exit,
        transform: `translateY(${translate}px)`,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 22,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: P.copperInk,
        }}
      >
        {kicker}
      </div>
      <h2
        style={{
          fontFamily: F.serif,
          fontSize: 86,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          color: P.ink,
          lineHeight: 1.08,
          margin: 0,
          maxWidth: 1500,
        }}
      >
        {title}
      </h2>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
        {children}
      </div>
      <SlideFooter />
    </AbsoluteFill>
  );
}

function SlideFooter() {
  return (
    <div
      style={{
        paddingTop: 18,
        borderTop: `1px solid ${P.rule}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontFamily: F.mono,
        fontSize: 15,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: P.faint,
      }}
    >
      <span style={{ color: P.copperInk }}>HATHOR</span>
      <span>Harvard HSIL Hackathon · AUC · April 2026</span>
    </div>
  );
}

// ── Individual slides ───────────────────────────────────────────────────────

function SlideProblem() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 40,
        marginTop: 40,
      }}
    >
      <Stat
        big="14.3M"
        label="Zero-dose children in WHO EMRO, 2019-2024"
      />
      <Stat big="84% → 79%" label="DTP3 coverage, EMRO, 2019 → 2024" color={P.bad} />
      <Stat big="90%" label="Zero-dose burden in five fragile states" />
      <Stat
        big="3.7-24%"
        label="Manual transcription error rate, per setting"
        color={P.amber}
      />
    </div>
  );
}

function SlideRitag() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        marginTop: 30,
        maxWidth: 1400,
      }}
    >
      <Quote>
        “Strengthen digitalization and innovative technology for data
        collection and use.”
      </Quote>
      <div style={{ fontFamily: F.serif, fontSize: 34, color: P.ink2, lineHeight: 1.4 }}>
        RITAG identified six priorities — two of them, <em>reaching
        zero-dose children</em> and <em>digital transformation</em>,
        are exactly what HATHOR does in one flow.
      </div>
    </div>
  );
}

function SlideVaccineCity() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 1fr",
        gap: 48,
        marginTop: 30,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <Stat big="115,000 m²" label="Cairo · 32 buildings · human + veterinary + R&D" />
        <Stat big="60+ countries" label="Targeted export destinations" />
        <Stat big="16%" label="Of Africa's vaccine demand by 2040" />
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 32,
          color: P.ink2,
          lineHeight: 1.5,
          paddingTop: 10,
        }}
      >
        Egypt is exporting <em>doses</em>. HATHOR is the digital
        tether that travels with them — a multilingual parser on
        the receiving end in every destination country, feeding
        post-market data back to Cairo.
      </div>
    </div>
  );
}

function SlideNdhs() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        marginTop: 30,
        maxWidth: 1400,
      }}
    >
      <Quote>
        “Institutionalize AI and mobile applications to enhance
        diagnostic capabilities and support data-driven decision-making.”
      </Quote>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: P.meta, letterSpacing: "0.1em" }}>
        Priority 6 · Egypt National Digital Health Strategy 2025-2029 ·
        launched November 2025 by Minister Khaled Abdel Ghaffar
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 30, color: P.ink2, lineHeight: 1.5 }}>
        HATHOR sits in the gap the strategy describes — between
        paper home-based records in MCH clinics and the unified
        digital health data system Egypt is building.
      </div>
    </div>
  );
}

function SlideThesis() {
  const frame = useCurrentFrame();
  const underline = interpolate(frame, [50, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        marginTop: 40,
        display: "flex",
        flexDirection: "column",
        gap: 36,
      }}
    >
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 52,
          lineHeight: 1.4,
          color: P.ink,
          maxWidth: 1500,
        }}
      >
        Standard apps trust their eyes.
        <br />
        HATHOR{" "}
        <span style={{ position: "relative" }}>
          double-checks against WHO rules
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              bottom: -6,
              height: 4,
              width: `${underline * 100}%`,
              background: P.copper,
            }}
          />
        </span>
        .
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.12em", color: P.meta }}>
        The model extracts. The engine validates. The UI shows only what the engine approved.
      </div>
    </div>
  );
}

function SlideGates() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 40,
        marginTop: 40,
      }}
    >
      <GateCard
        tag="Phase D"
        color={P.amber}
        title="Vision Safety Loop"
        body="Any extracted field below 0.85 confidence routes to human-in-the-loop review. Per field, not per document. Reasoning rendered verbatim for the clinician."
      />
      <GateCard
        tag="Phase E"
        color={P.bad}
        title="Reasoning Safety Loop"
        body="Every schedule recommendation passes through a deterministic Python rules engine derived from the WHO DAK before reaching the UI. Agent reasons freely. Output layer is gated."
      />
    </div>
  );
}

function GateCard({
  tag,
  color,
  title,
  body,
}: {
  tag: string;
  color: string;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        background: P.card,
        border: `1px solid ${P.rule}`,
        borderLeft: `6px solid ${color}`,
        padding: "32px 36px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 18,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color,
        }}
      >
        {tag}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 48,
          color: P.ink,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 26,
          color: P.mute,
          lineHeight: 1.45,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function SlidePartners() {
  return (
    <div
      style={{
        marginTop: 40,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 28,
      }}
    >
      <Partner name="WHO Egypt" tag="Dr. Nima Saeed Abid · WHO Representative" />
      <Partner
        name="Ministry of Health and Population"
        tag="Preventive Medicine Sector · EPI"
      />
      <Partner
        name="American University in Cairo"
        tag="AI-in-Healthcare Hub · Harvard HSIL Hackathon host"
      />
      <Partner
        name="Hasso Plattner Institute"
        tag="Digital Health Cluster"
      />
    </div>
  );
}

function Partner({ name, tag }: { name: string; tag: string }) {
  return (
    <div
      style={{
        background: P.card,
        border: `1px solid ${P.rule}`,
        borderLeft: `3px solid ${P.copper}`,
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 40,
          letterSpacing: "-0.02em",
          color: P.ink,
          lineHeight: 1.15,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 16,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: P.meta,
        }}
      >
        {tag}
      </div>
    </div>
  );
}

function SlideAsk() {
  return (
    <div
      style={{
        marginTop: 60,
        display: "flex",
        flexDirection: "column",
        gap: 34,
        maxWidth: 1500,
      }}
    >
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 56,
          color: P.ink,
          lineHeight: 1.35,
        }}
      >
        A 90-day pilot. Three MCH clinics in Cairo or Alexandria.
        Shadow mode, then active integration. PDPL-compliant
        on-device redaction. DHIS2 write-through.
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 22,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: P.copperInk,
        }}
      >
        HATHOR · built by a physician · open source · IA2030-aligned
      </div>
    </div>
  );
}

// ── Shared atoms ────────────────────────────────────────────────────────────

function Stat({
  big,
  label,
  color = P.ink,
}: {
  big: string;
  label: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: P.card,
        border: `1px solid ${P.rule}`,
        padding: "30px 34px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 72,
          letterSpacing: "-0.03em",
          color,
          lineHeight: 1,
        }}
      >
        {big}
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 18,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: P.meta,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote
      style={{
        background: P.paper2,
        borderLeft: `6px solid ${P.copper}`,
        padding: "26px 34px",
        margin: 0,
        fontFamily: F.serif,
        fontSize: 44,
        fontStyle: "italic",
        color: P.ink,
        letterSpacing: "-0.01em",
        lineHeight: 1.35,
      }}
    >
      {children}
    </blockquote>
  );
}

function FilmGrain() {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.3,
        backgroundImage: `radial-gradient(${P.stone} 0.5px, transparent 0.6px)`,
        backgroundSize: "7px 7px",
        mixBlendMode: "multiply" as const,
      }}
    />
  );
}
