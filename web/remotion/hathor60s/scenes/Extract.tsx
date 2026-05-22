/**
 * Scene 3 — "extract" (10s, 2 shots).
 *
 *  extract-1 (0–5s): The card sits inside a browser DeviceFrame. A scan
 *                    sweep passes top to bottom. As the sweep crosses each
 *                    row, the row "lifts" out of the card with a small
 *                    EvidenceHighlight and arrives in a structured table
 *                    below. Confidence chips use NON-NUMERIC labels
 *                    (high / low) per honesty notes.
 *
 *  extract-2 (5–10s): Same DeviceFrame. FocusBackdrop dims everything
 *                     except the low-confidence row, which lifts and
 *                     translates into a side panel labelled "Clinician
 *                     review". Confirm / Correct controls appear.
 *
 *  The DeviceFrame chrome makes the surface read as product UI; the
 *  TODO label kept visible so it cannot be mistaken for a real capture.
 */

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, FPS, HEIGHT, WIDTH } from "../tokens";
import { BEAT, EASE, reveal, rise as riseDist } from "../motion";
import { DeviceFrame } from "../components/DeviceFrame";
import { ScanSweep } from "../components/ScanSweep";
import { EvidenceHighlight } from "../components/EvidenceHighlight";
import { FocusBackdrop } from "../components/FocusBackdrop";
import { ShotTag } from "./Hook";

const E1 = 5 * FPS;
const E2 = 5 * FPS;

type Row = {
  vaccine: string;
  date: string;
  dose: string;
  confidence: "high" | "low";
};

const ROWS: Row[] = [
  { vaccine: "BCG",       date: "2024-03-04", dose: "1", confidence: "high" },
  { vaccine: "OPV 0",     date: "2024-03-04", dose: "0", confidence: "high" },
  { vaccine: "HepB 0",    date: "2024-03-04", dose: "0", confidence: "high" },
  { vaccine: "Penta 1",   date: "2024-04-15", dose: "1", confidence: "high" },
  { vaccine: "OPV 1",     date: "2024-04-15", dose: "1", confidence: "low"  },
  { vaccine: "Measles 1", date: "2024-12-—",  dose: "1", confidence: "low"  },
];

export function Extract() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={E1} name="extract-1">
        <Extract1 />
      </Sequence>
      <Sequence from={E1} durationInFrames={E2} name="extract-2">
        <Extract2 />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ============================================================== */
/* extract-1                                                       */
/* ============================================================== */

function Extract1() {
  const frame = useCurrentFrame();

  // Scan begins shortly after entry.
  const scanStart = Math.round(0.4 * FPS);
  const scanDur   = Math.round(2.4 * FPS);

  // Each row appears in the structured table as the sweep passes its row in
  // the card preview.
  const rowTimes = ROWS.map((_, i) =>
    Math.round((0.6 + i * 0.32) * FPS),
  );

  // Frame entrance.
  const frameEnter = reveal(frame, 0, Math.round(0.5 * FPS));

  // Scenes inside the DeviceFrame.
  const cardPreviewH = 380;
  const tableH = 740;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <ScenePadding>
        <Chyron>Read · structure · score.</Chyron>

        <div
          style={{
            marginTop: 24,
            opacity: frameEnter,
            transform: `translateY(${riseDist(frameEnter, 16)}px)`,
          }}
        >
          <DeviceFrame
            variant="browser"
            url="hathor.local/scan"
            title="extract"
            showTodo
            shotId="extract-1"
          >
            {/* Card preview band with scan sweep on top */}
            <div
              style={{
                position: "relative",
                height: cardPreviewH,
                background: "#FBF8F1",
                borderBottom: `1px solid ${C.rule}`,
                padding: "20px 28px",
                fontFamily: FONT.sans,
                color: C.ink,
                boxSizing: "border-box",
                overflow: "hidden",
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
                Card · synthetic
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px 24px",
                  marginTop: 14,
                }}
              >
                {ROWS.map((r) => (
                  <div
                    key={r.vaccine}
                    style={{
                      fontFamily: "Caveat, 'Bradley Hand', cursive",
                      fontSize: 28,
                      color: C.inkMuted,
                    }}
                  >
                    {r.vaccine} · {r.date}
                  </div>
                ))}
              </div>

              <ScanSweep
                frame={frame}
                startFrame={scanStart}
                durationFrames={scanDur}
                height={cardPreviewH}
                width="100%"
                thickness={3}
                glow={48}
              />
            </div>

            {/* Structured table */}
            <div
              style={{
                background: C.surface,
                fontFamily: FONT.sans,
                minHeight: tableH,
              }}
            >
              <TableHeader />
              {ROWS.map((r, i) => (
                <Row
                  key={r.vaccine}
                  row={r}
                  rowOpacity={reveal(frame, rowTimes[i], rowTimes[i] + BEAT.med)}
                  highlight={false}
                />
              ))}
            </div>
          </DeviceFrame>
        </div>

        <ShotTag id="extract-1" />
      </ScenePadding>
    </AbsoluteFill>
  );
}

/* ============================================================== */
/* extract-2                                                       */
/* ============================================================== */

function Extract2() {
  const frame = useCurrentFrame();
  const lowIdx = ROWS.findIndex((r) => r.confidence === "low");

  // Frame holds; spotlight focuses on the low-confidence row, then it lifts
  // and translates into the right-side review panel.
  const focusActive = reveal(frame, Math.round(0.3 * FPS), Math.round(0.9 * FPS));
  const slide = interpolate(
    frame,
    [Math.round(1.2 * FPS), Math.round(2.0 * FPS)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.clinical },
  );
  const panelOpacity = reveal(frame, Math.round(1.6 * FPS), Math.round(2.2 * FPS));
  const panelLift = riseDist(panelOpacity, 22);

  // Geometry of the low-confidence row inside the structured table.
  // (DeviceFrame begins at ~ y=270 in scene-space; the table sits below the
  // card preview band, header row, and (lowIdx) preceding rows.)
  const frameY = 200;
  const headerY = frameY + 44 + 380; // bar + card-preview band
  const rowH = 58;
  const rowY = headerY + 60 + lowIdx * rowH;

  const focusRect = {
    left: 80,
    top: rowY - 6,
    width: WIDTH - 160,
    height: rowH + 10,
  };

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <ScenePadding>
        <Chyron>Below threshold → clinician review.</Chyron>

        <div style={{ marginTop: 24, position: "relative" }}>
          <FocusBackdrop active={focusActive} rect={focusRect} feather={120} intensity={0.4}>
            <DeviceFrame
              variant="browser"
              url="hathor.local/scan"
              title="extract"
              showTodo
              shotId="extract-2"
            >
              {/* Card preview band — static, since extract-1 already showed it */}
              <div
                style={{
                  background: "#FBF8F1",
                  height: 380,
                  borderBottom: `1px solid ${C.rule}`,
                  padding: "20px 28px",
                  boxSizing: "border-box",
                  fontFamily: FONT.sans,
                  color: C.ink,
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
                  Card · synthetic
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "8px 24px",
                    marginTop: 14,
                  }}
                >
                  {ROWS.map((r) => (
                    <div
                      key={r.vaccine}
                      style={{
                        fontFamily: "Caveat, 'Bradley Hand', cursive",
                        fontSize: 28,
                        color: C.inkMuted,
                      }}
                    >
                      {r.vaccine} · {r.date}
                    </div>
                  ))}
                </div>
              </div>

              {/* Structured table — low-confidence row drifts away as it slides */}
              <div
                style={{
                  background: C.surface,
                  fontFamily: FONT.sans,
                  minHeight: 740,
                }}
              >
                <TableHeader />
                {ROWS.map((r, i) => (
                  <Row
                    key={r.vaccine}
                    row={r}
                    rowOpacity={i === lowIdx ? 1 - slide : 1}
                    highlight={i === lowIdx && slide < 0.4}
                  />
                ))}
              </div>
            </DeviceFrame>

            {/* Outline locks onto the low-confidence row briefly */}
            <EvidenceHighlight
              frame={frame}
              startFrame={Math.round(0.6 * FPS)}
              left={focusRect.left + 12}
              top={focusRect.top + 4}
              width={focusRect.width - 24}
              height={focusRect.height - 8}
              tone="warn"
              hold={18}
              radius={6}
            />
          </FocusBackdrop>

          {/* Floating review panel arriving from the right */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 360,
              width: 460,
              opacity: panelOpacity,
              transform: `translate(${(1 - panelOpacity) * 32}px, ${panelLift}px)`,
            }}
          >
            <ReviewPanel row={ROWS[lowIdx]} frame={frame} />
          </div>
        </div>

        <ShotTag id="extract-2" />
      </ScenePadding>
    </AbsoluteFill>
  );
}

function ReviewPanel({ row, frame }: { row: Row; frame: number }) {
  const underlineW = interpolate(
    frame,
    [Math.round(2.0 * FPS), Math.round(2.6 * FPS)],
    [0, 220],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.clinical },
  );
  return (
    <div
      style={{
        background: C.warnSoft,
        border: `2px solid ${C.warn}`,
        borderRadius: 14,
        padding: 22,
        fontFamily: FONT.sans,
        color: C.ink,
        boxShadow: "0 24px 60px -28px rgba(180,83,9,0.45)",
      }}
    >
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 16,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.warn,
          fontWeight: 700,
        }}
      >
        Clinician review
      </div>
      <div
        style={{
          width: underlineW,
          height: 3,
          background: C.warn,
          marginTop: 6,
          marginBottom: 18,
        }}
      />
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.rule}`,
          borderRadius: 8,
          padding: "14px 16px",
          fontFamily: "Caveat, 'Bradley Hand', cursive",
          fontSize: 32,
          color: C.inkMuted,
          marginBottom: 14,
        }}
      >
        {row.vaccine} · {row.date}
      </div>
      <div style={{ fontSize: 20, color: C.inkMuted, marginBottom: 16 }}>
        Proposed:{" "}
        <span style={{ color: C.ink, fontWeight: 600 }}>
          {row.vaccine}, dose {row.dose}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <Button label="Confirm" tone="ok" />
        <Button label="Correct" tone="warn" />
      </div>
    </div>
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

export function Chyron({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
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

function TableHeader() {
  const cell = (label: string, w: string) => (
    <div
      style={{
        flex: w,
        fontFamily: FONT.mono,
        fontSize: 14,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.inkMuted,
      }}
    >
      {label}
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "16px 22px",
        borderBottom: `1px solid ${C.rule}`,
        background: C.surfaceMuted,
      }}
    >
      {cell("Vaccine", "1.2")}
      {cell("Date", "1")}
      {cell("Dose", "0.4")}
      {cell("Confidence", "0.8")}
    </div>
  );
}

function Row({
  row, rowOpacity, highlight,
}: {
  row: Row; rowOpacity: number; highlight: boolean;
}) {
  const tone = row.confidence === "low" ? C.warn : C.ok;
  const toneSoft = row.confidence === "low" ? C.warnSoft : C.okSoft;
  const lift = riseDist(rowOpacity, 6);
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "16px 22px",
        borderBottom: `1px solid ${C.ruleSoft}`,
        opacity: rowOpacity,
        background: highlight ? C.warnSoft : "transparent",
        transform: `translateY(${lift}px)`,
      }}
    >
      <div style={{ flex: 1.2, fontSize: 22, color: C.ink, fontWeight: 500 }}>{row.vaccine}</div>
      <div style={{ flex: 1, fontSize: 20, color: C.inkMuted, fontFamily: FONT.mono }}>{row.date}</div>
      <div style={{ flex: 0.4, fontSize: 20, color: C.inkMuted, fontFamily: FONT.mono }}>{row.dose}</div>
      <div style={{ flex: 0.8 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 14,
            padding: "4px 12px",
            borderRadius: 999,
            color: tone,
            background: toneSoft,
            border: `1px solid ${tone}33`,
            fontFamily: FONT.mono,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {row.confidence}
        </span>
      </div>
    </div>
  );
}

function Button({ label, tone }: { label: string; tone: "ok" | "warn" }) {
  const color = tone === "ok" ? C.ok : C.warn;
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        padding: "12px 0",
        border: `1.5px solid ${color}`,
        color,
        borderRadius: 8,
        fontFamily: FONT.sans,
        fontSize: 18,
        fontWeight: 600,
        background: C.surface,
      }}
    >
      {label}
    </div>
  );
}

void HEIGHT;
