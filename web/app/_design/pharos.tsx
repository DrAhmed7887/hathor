/**
 * Pharos design module — shared primitives for every Hathor surface.
 *
 * Lifted verbatim from `app/page.tsx` and the Hathor Pharos Alignment design
 * (claude.ai/design handoff bundle, 2026-04-25). Tokens are 1:1 with the
 * landing page so the inner pages can adopt the same voice without drift.
 */

import type { CSSProperties, ReactNode } from "react";

// --- Palette (verbatim from the original landing page) ----------------------
export const H = {
  ivory: "#FAF7EF",
  paper: "#F3EBDD",
  card: "#FFFDF8",
  cardSoft: "#F8F2E5",
  line: "#DED4C2",
  lineSoft: "#EAE1CE",
  teal: "#123C3F",
  teal2: "#1F5D61",
  gold: "#B88A3D",
  goldSoft: "#EFE1BE",
  ink: "#172222",
  mute: "#5C6764",
  faint: "#8C9492",
  white: "#FFFFFF",
  amber: "#B8833B",
  terracotta: "#CC785C",
} as const;

// --- Font stacks ------------------------------------------------------------
export const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

// --- HathorSigil ------------------------------------------------------------
// Cow horns + sun-disk reduced to primitives. Pure SVG, no icon library.
export function HathorSigil({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none" aria-hidden="true">
      <circle cx="27" cy="20" r="7" fill={H.goldSoft} stroke={H.gold} strokeWidth="1.4" />
      <path
        d="M14 17c2.2 11.5 7.1 17.2 13 17.2S37.8 28.5 40 17"
        stroke={H.gold}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 36h14M18 42h18" stroke={H.teal} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// --- Eyebrow — small-caps mono kicker ---------------------------------------
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 11,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: color || H.gold,
      }}
    >
      {children}
    </div>
  );
}

// --- HieraticDivider — gold rule + horns/sun glyph between sections ---------
export function HieraticDivider({ width = 320 }: { width?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        width: "100%",
      }}
    >
      <div
        style={{ flex: 1, height: 1, background: H.gold, opacity: 0.5, maxWidth: width / 2 }}
      />
      <svg width="28" height="14" viewBox="0 0 28 14" fill="none" aria-hidden="true">
        <path
          d="M4 12 Q4 4 14 4 Q24 4 24 12"
          stroke={H.gold}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="14" cy="8" r="2.4" fill={H.goldSoft} stroke={H.gold} strokeWidth="1" />
      </svg>
      <div
        style={{ flex: 1, height: 1, background: H.gold, opacity: 0.5, maxWidth: width / 2 }}
      />
    </div>
  );
}

// --- PageHeader — chrome shared across every inner page ---------------------
export function PageHeader({ route, children }: { route: string; children?: ReactNode }) {
  return (
    <header
      style={{
        width: "100%",
        padding: "18px 32px",
        borderBottom: `1px solid ${H.lineSoft}`,
        background: H.ivory,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          color: H.teal,
        }}
      >
        <HathorSigil size={36} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: F.serif, fontSize: 20, letterSpacing: "-0.01em" }}>
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
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Eyebrow>{route}</Eyebrow>
        {children}
      </div>
    </header>
  );
}

// --- Buttons ----------------------------------------------------------------
export function ButtonPrimary({
  children,
  style,
  onClick,
  type,
  disabled,
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}) {
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: H.terracotta,
        color: H.card,
        border: `1px solid ${H.terracotta}`,
        borderRadius: 6,
        padding: "10px 16px",
        fontFamily: F.mono,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function ButtonSecondary({
  children,
  style,
  onClick,
  type,
  disabled,
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}) {
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        color: H.teal,
        border: `1px solid ${H.teal}`,
        borderRadius: 6,
        padding: "10px 16px",
        fontFamily: F.mono,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// --- StatusChip — four kinds, the new gold partial caveat included ----------
export type StatusKind = "completed" | "partial" | "overdue" | "mute";

export function StatusChip({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  const palette: Record<StatusKind, { bg: string; fg: string; border: string }> = {
    completed: { bg: "#E6EFE8", fg: "#2F5A3F", border: "#C9DDCC" },
    overdue: { bg: "#F4E1DD", fg: "#8B3A2C", border: "#E0BFB6" },
    // NEW — gold caveat for component-level partial coverage. The dose was
    // delivered, but a destination-schedule component is missing.
    partial: { bg: H.goldSoft, fg: "#7A5219", border: H.gold },
    mute: { bg: H.cardSoft, fg: H.mute, border: H.line },
  };
  const p = palette[kind];
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: p.fg,
        background: p.bg,
        border: `1px solid ${p.border}`,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

// --- PharosCard — used for every panel/surface on inner pages ---------------
export function PharosCard({
  children,
  padding = "20px 22px",
  style,
}: {
  children: ReactNode;
  padding?: string | number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.line}`,
        borderRadius: 10,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// --- PartialRow — gold-left-border row for partial_coverage findings --------
// 2px gold left-border is the visual contract: the dose happened, but a
// component is missing. Always name the component, never the dose.
export function PartialRow({
  title,
  gap,
}: {
  title: ReactNode;
  gap: ReactNode;
}) {
  return (
    <div style={{ borderLeft: `2px solid ${H.gold}`, paddingLeft: 14 }}>
      <div style={{ fontFamily: F.serif, fontSize: 14.5, color: H.ink, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusChip kind="partial">Partial</StatusChip>
        <span style={{ fontSize: 13, color: H.mute, fontStyle: "italic" }}>{gap}</span>
      </div>
    </div>
  );
}

// --- SummaryStat — verdict-band number + label pair ------------------------
export type StatTone = "completed" | "partial" | "overdue";

export function SummaryStat({
  n,
  label,
  tone,
}: {
  n: number | string;
  label: string;
  tone: StatTone;
}) {
  const color =
    tone === "completed" ? "#2F5A3F" : tone === "partial" ? "#7A5219" : "#8B3A2C";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={{ fontFamily: F.serif, fontSize: 28, color, lineHeight: 1 }}>{n}</span>
      <span
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: H.mute,
          marginTop: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// --- CountryPair — sigil + Origin → Destination headline -------------------
// Used on the reconcile verdict header. The sigil to the left, origin and
// destination flanking a small gold arrow.
export function CountryPair({
  origin,
  destination,
}: {
  origin: string;
  destination: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
      <span
        style={{
          fontFamily: F.serif,
          fontSize: 28,
          color: H.teal,
          fontWeight: 400,
          letterSpacing: "-0.012em",
        }}
      >
        {origin}
      </span>
      <svg width="32" height="14" viewBox="0 0 32 14" fill="none" aria-hidden="true">
        <path
          d="M2 7h26M22 2l6 5-6 5"
          stroke={H.gold}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        style={{
          fontFamily: F.serif,
          fontSize: 28,
          color: H.teal,
          fontWeight: 400,
          letterSpacing: "-0.012em",
        }}
      >
        {destination}
      </span>
    </div>
  );
}
