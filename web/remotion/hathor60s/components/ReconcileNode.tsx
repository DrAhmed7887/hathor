/**
 * ReconcileNode — a single workflow stage in the reconciliation pipeline.
 * Used in reconcile-3 to render the chain (Country → Schedule → Baseline →
 * Review). Has a label, a state (idle / active / done), and a small icon
 * mark that fills as evidence passes through.
 *
 * Intentionally minimal: this is product-flow geometry, not a brand panel.
 */

import { ReactNode } from "react";
import { C, FONT } from "../tokens";

type State = "idle" | "active" | "done";

export function ReconcileNode({
  label,
  caption,
  state,
  width = 220,
  icon,
}: {
  label: string;
  caption?: string;
  state: State;
  width?: number;
  icon?: ReactNode;
}) {
  const tone =
    state === "active" ? C.warn : state === "done" ? C.ok : C.inkSoft;
  const bg =
    state === "active"
      ? C.warnSoft
      : state === "done"
        ? C.okSoft
        : C.surface;
  const border =
    state === "active"
      ? C.warn
      : state === "done"
        ? C.ok
        : C.rule;

  return (
    <div
      style={{
        width,
        background: bg,
        border: `1.5px solid ${border}`,
        borderRadius: 14,
        padding: "16px 14px",
        fontFamily: FONT.sans,
        color: C.ink,
        position: "relative",
        boxShadow:
          state === "active"
            ? `0 0 0 4px ${C.warn}1F, 0 12px 28px -16px rgba(15,23,42,0.32)`
            : state === "done"
              ? `0 0 0 0px transparent, 0 8px 22px -16px rgba(15,23,42,0.22)`
              : "0 4px 14px -10px rgba(15,23,42,0.18)",
        transition: "box-shadow 200ms",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: caption ? 6 : 0,
        }}
      >
        {icon ? (
          <span
            style={{
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: state === "idle" ? C.ruleSoft : tone + "22",
              color: tone,
            }}
          >
            {icon}
          </span>
        ) : null}
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 13,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: tone,
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      </div>
      {caption ? (
        <div
          style={{
            fontSize: 18,
            color: state === "idle" ? C.inkMuted : C.ink,
            fontWeight: 500,
            lineHeight: 1.25,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

/** Tiny icon glyphs — built-in SVGs so we don't pull lucide into the
 *  Remotion bundle path. Sized for the 22px icon slot above. */
export const NodeGlyphs = {
  globe: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  calendar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  scale: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v18M5 7h14M5 7l3 8h-6l3-8zM19 7l3 8h-6l3-8z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  user: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
};
