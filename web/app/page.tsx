import Link from "next/link";

import { DEMO_SCENARIOS, type DemoScenario } from "@/lib/scenarios";
import { Eyebrow, F, H, HathorSigil } from "@/app/_design/pharos";

function ScenarioCard({ s }: { s: DemoScenario }) {
  return (
    <Link
      href={`/scan?scenario=${encodeURIComponent(s.id)}`}
      style={{
        display: "flex",
        flexDirection: "column",
        background: H.card,
        border: `1px solid ${H.line}`,
        borderRadius: 10,
        overflow: "hidden",
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 120ms ease, transform 120ms ease",
      }}
    >
      <div
        style={{
          aspectRatio: "5 / 3",
          backgroundImage: `linear-gradient(180deg, rgba(18,60,63,0) 55%, rgba(18,60,63,0.42) 100%), url('${s.cardImageUrl}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderBottom: `1px solid ${H.line}`,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(255,253,248,0.92)",
            color: H.teal,
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "5px 9px",
            borderRadius: 999,
            border: `1px solid ${H.line}`,
          }}
        >
          {s.routePill}
        </div>
        {s.cardLanguage === "ar" && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: "rgba(255,253,248,0.92)",
              color: H.amber,
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "5px 9px",
              borderRadius: 999,
              border: `1px solid ${H.line}`,
            }}
          >
            عربى · Arabic
          </div>
        )}
      </div>

      <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3
            style={{
              fontFamily: F.serif,
              fontSize: 22,
              fontWeight: 400,
              color: H.teal,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {s.patient}
          </h3>
          <span style={{ fontSize: 13, color: H.mute }}>{s.ageLabel}</span>
        </div>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: H.ink, margin: 0 }}>{s.blurb}</p>
        <div
          style={{
            marginTop: 4,
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.08em",
            color: H.gold,
          }}
        >
          Showcases · {s.showcases}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignSelf: "flex-start",
            background: H.teal,
            color: H.white,
            border: `1px solid ${H.teal}`,
            borderRadius: 6,
            padding: "9px 14px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Run reconciliation →
        </div>
      </div>
    </Link>
  );
}

function UploadTile() {
  return (
    <Link
      href="/scan"
      style={{
        display: "flex",
        flexDirection: "column",
        background: H.cardSoft,
        border: `1.5px dashed ${H.line}`,
        borderRadius: 10,
        textDecoration: "none",
        color: "inherit",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          aspectRatio: "5 / 3",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: `1px dashed ${H.line}`,
          color: H.faint,
        }}
      >
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 16V4M12 4l-4 4M12 4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke={H.teal2}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        <h3
          style={{
            fontFamily: F.serif,
            fontSize: 22,
            fontWeight: 400,
            color: H.teal,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          Bring your own card
        </h3>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: H.ink, margin: 0 }}>
          Upload a photo of any vaccination card. Hathor extracts every dose,
          checks confidence per field, and reconciles against the destination
          schedule.
        </p>
        <div
          style={{
            marginTop: 4,
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.08em",
            color: H.gold,
          }}
        >
          Accepts · JPG, PNG, HEIC · single page
        </div>
        <div
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignSelf: "flex-start",
            background: "rgba(255,253,248,0.85)",
            color: H.teal,
            border: `1px solid ${H.teal}`,
            borderRadius: 6,
            padding: "9px 14px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Upload a card →
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: H.ivory,
        color: H.ink,
        fontFamily: F.sans,
      }}
    >
      <header
        style={{
          width: "min(1180px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "22px 0 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          borderBottom: `1px solid ${H.lineSoft}`,
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            color: H.teal,
            textDecoration: "none",
          }}
        >
          <HathorSigil />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: F.serif, fontSize: 22, letterSpacing: "-0.01em" }}>
              Hathor
            </span>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: H.mute,
                marginTop: 2,
              }}
            >
              Cross-border vaccine reconciliation
            </span>
          </div>
        </Link>
        <nav style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/scan" style={{ color: H.teal, fontSize: 14, textDecoration: "none" }}>
            Scan
          </Link>
          <Link href="/demo" style={{ color: H.teal, fontSize: 14, textDecoration: "none" }}>
            Full safety-loop demo
          </Link>
        </nav>
      </header>

      <section
        style={{
          width: "min(1180px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "32px 0 8px",
        }}
      >
        <Eyebrow>Pick a case · agent reasoning starts on click</Eyebrow>
        <h1
          style={{
            fontFamily: F.serif,
            fontSize: "clamp(32px, 4.4vw, 50px)",
            lineHeight: 1.05,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: H.teal,
            margin: "12px 0 6px",
            maxWidth: 880,
          }}
        >
          A child arrives in Cairo with a vaccine card from somewhere else.
          What counts, what is missing, what is due?
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.65,
            color: H.mute,
            margin: "10px 0 0",
            maxWidth: 760,
          }}
        >
          Hathor reads the card, reconciles it against the destination national
          schedule, and surfaces a clinician-confirmable plan. Pick a prepared
          case below or upload your own — the agent&apos;s reasoning streams
          live as it works.
        </p>
      </section>

      <section
        aria-label="Demo scenarios"
        style={{
          width: "min(1180px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "26px 0 28px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: 18,
        }}
      >
        {DEMO_SCENARIOS.map((s) => (
          <ScenarioCard key={s.id} s={s} />
        ))}
        <UploadTile />
      </section>

      <section
        aria-label="Safety footnote"
        style={{
          width: "min(1180px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "8px 0 56px",
        }}
      >
        <div
          style={{
            border: `1px solid ${H.lineSoft}`,
            background: H.paper,
            borderRadius: 8,
            padding: "12px 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: 18,
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.08em",
            color: H.teal,
          }}
        >
          <span>
            Clinical decision support · clinician confirms every recommendation ·
            Phase 1 destination Egypt
          </span>
          <span style={{ color: H.mute }}>
            Two safety gates · per-field vision review · per-recommendation rules engine
          </span>
        </div>
      </section>
    </main>
  );
}
