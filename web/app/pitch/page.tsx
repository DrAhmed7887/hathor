"use client";

/**
 * /pitch — standalone PitchDeck Remotion composition host.
 *
 * Dark-paper background, full-bleed player, minimal chrome.
 * Controls exposed so a presenter can pause and step between
 * slides live during Q&A.
 */

import Link from "next/link";
import { PitchDeckPlayer } from "@/components/PitchDeckPlayer";

const H = {
  paper:     "#F6F0E4",
  paper2:    "#FBF6EC",
  rule:      "#E7E2DA",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  ink:       "#1C1917",
  meta:      "#6B6158",
  faint:     "#A8A29E",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export default function PitchPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: H.paper,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "18px 36px",
          borderBottom: `1px solid ${H.rule}`,
          background: H.paper2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: H.copperInk,
            }}
          >
            HATHOR · pitch deck
          </div>
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 22,
              color: H.ink,
              letterSpacing: "-0.015em",
              marginTop: 2,
            }}
          >
            Harvard HSIL Hackathon · AUC · April 2026
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <Link href="/" style={{ color: H.meta, textDecoration: "none" }}>
            ← Home
          </Link>
          <span style={{ color: H.faint }}>·</span>
          <Link href="/demo" style={{ color: H.copper, textDecoration: "none" }}>
            Fast-path demo →
          </Link>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          padding: "32px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 1600 }}>
          <PitchDeckPlayer autoPlay loop={false} />
        </div>
      </main>

      <footer
        style={{
          padding: "14px 36px",
          borderTop: `1px solid ${H.rule}`,
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: H.faint,
          textAlign: "center",
        }}
      >
        60 seconds · 8 slides · voiceover-ready pacing · use the
        player controls to step through live
      </footer>
    </div>
  );
}
