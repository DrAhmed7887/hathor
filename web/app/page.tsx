import Link from "next/link";
import type { ReactNode } from "react";

const H = {
  ivory: "#FAF7EF",
  paper: "#F3EBDD",
  card: "#FFFDF8",
  line: "#DED4C2",
  teal: "#123C3F",
  teal2: "#1F5D61",
  gold: "#B88A3D",
  goldSoft: "#EFE1BE",
  ink: "#172222",
  mute: "#5C6764",
  white: "#FFFFFF",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

function HathorSigil() {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden="true">
      <circle cx="27" cy="20" r="7" fill={H.goldSoft} stroke={H.gold} strokeWidth="1.4" />
      <path
        d="M14 17c2.2 11.5 7.1 17.2 13 17.2S37.8 28.5 40 17"
        stroke={H.gold}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 36h14M18 42h18"
        stroke={H.teal}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 11,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: H.gold,
      }}
    >
      {children}
    </div>
  );
}

function WorkflowCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <article
      style={{
        background: H.card,
        border: `1px solid ${H.line}`,
        borderRadius: 8,
        padding: "22px 22px 24px",
        minHeight: 150,
      }}
    >
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
        {title}
      </h3>
      <p
        style={{
          fontFamily: F.sans,
          fontSize: 15,
          lineHeight: 1.65,
          color: H.mute,
          margin: "14px 0 0",
        }}
      >
        {body}
      </p>
    </article>
  );
}

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", background: H.ivory, color: H.ink, fontFamily: F.sans }}>
      <section
        style={{
          minHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          backgroundImage:
            "linear-gradient(90deg, rgba(250,247,239,0.98) 0%, rgba(250,247,239,0.92) 46%, rgba(18,60,63,0.64) 100%), url('/card-images/demo.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center right",
          borderBottom: `1px solid ${H.line}`,
        }}
      >
        <header
          style={{
            width: "min(1120px, calc(100% - 40px))",
            margin: "0 auto",
            padding: "26px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
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
            <span style={{ fontFamily: F.serif, fontSize: 24, letterSpacing: "-0.01em" }}>
              Hathor
            </span>
          </Link>
          <nav style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/scan" style={{ color: H.teal, fontSize: 14, textDecoration: "none" }}>
              Scan
            </Link>
            <Link href="/demo" style={{ color: H.teal, fontSize: 14, textDecoration: "none" }}>
              Full demo
            </Link>
          </nav>
        </header>

        <div
          style={{
            width: "min(1120px, calc(100% - 40px))",
            margin: "auto auto 72px",
            padding: "54px 0 36px",
          }}
        >
          <div style={{ maxWidth: 760 }}>
            <Eyebrow>Clinical reconciliation assistant</Eyebrow>
            <h1
              style={{
                fontFamily: F.serif,
                fontSize: "clamp(48px, 8vw, 96px)",
                lineHeight: 0.95,
                fontWeight: 400,
                letterSpacing: "0",
                color: H.teal,
                margin: "18px 0 18px",
              }}
            >
              Hathor
            </h1>
            <p
              style={{
                fontFamily: F.serif,
                fontSize: "clamp(25px, 3.2vw, 42px)",
                lineHeight: 1.14,
                color: H.ink,
                margin: 0,
                maxWidth: 760,
              }}
            >
              Turn vaccination cards into clear, safe, actionable schedules.
            </p>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.7,
                color: H.mute,
                margin: "24px 0 0",
                maxWidth: 690,
              }}
            >
              Upload or enter a child&apos;s immunization record. Hathor extracts doses,
              reconciles them against national schedules, and highlights what is due,
              delayed, or missing.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 34 }}>
              <Link
                href="/scan"
                style={{
                  background: H.teal,
                  color: H.white,
                  border: `1px solid ${H.teal}`,
                  borderRadius: 8,
                  padding: "13px 18px",
                  fontFamily: F.mono,
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                }}
              >
                Scan a card
              </Link>
              <Link
                href="/demo"
                style={{
                  background: "rgba(255,253,248,0.82)",
                  color: H.teal,
                  border: `1px solid ${H.line}`,
                  borderRadius: 8,
                  padding: "13px 18px",
                  fontFamily: F.mono,
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                }}
              >
                Full demo flow
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Workflow"
        style={{
          width: "min(1120px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "56px 0 34px",
        }}
      >
        <div style={{ marginBottom: 22 }}>
          <Eyebrow>Workflow</Eyebrow>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          <WorkflowCard title="1. Capture" body="Upload a card or enter doses manually." />
          <WorkflowCard title="2. Reconcile" body="Match records against vaccine schedule logic." />
          <WorkflowCard title="3. Guide" body="Show due, overdue, and next recommended vaccines." />
        </div>
      </section>

      <section
        aria-label="Trust and safety"
        style={{
          width: "min(1120px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "0 0 64px",
        }}
      >
        <div
          style={{
            border: `1px solid ${H.line}`,
            background: H.paper,
            borderRadius: 8,
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          {[
            "Clinician-in-the-loop",
            "Schedule-aware",
            "Built for auditability",
            "Designed for low-resource settings",
          ].map((item) => (
            <div
              key={item}
              style={{
                color: H.teal,
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "10px 8px",
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
