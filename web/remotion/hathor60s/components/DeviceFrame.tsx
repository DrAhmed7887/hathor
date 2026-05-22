/**
 * DeviceFrame — wraps a UI placeholder in a clean device chrome so it reads
 * as "product surface" rather than a styled mock. Two variants:
 *
 *   - "browser": macOS-style title bar with traffic lights and a URL pill.
 *   - "mobile": minimal status bar + bottom indicator, app-like.
 *
 * Per render-notes.md, the inner content is still a placeholder until real
 * captures land. The TODO label stays visible — the chrome is decoration,
 * not a claim.
 */

import { ReactNode } from "react";
import { C, FONT } from "../tokens";

type Variant = "browser" | "mobile";

export function DeviceFrame({
  variant = "browser",
  url,
  title,
  children,
  width = "100%",
  height,
  showTodo = false,
  shotId,
}: {
  variant?: Variant;
  url?: string;
  title?: string;
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  showTodo?: boolean;
  shotId?: string;
}) {
  return (
    <div
      style={{
        width,
        height,
        background: C.surface,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow:
          "0 1px 0 rgba(15,23,42,0.04), 0 24px 60px -28px rgba(15,23,42,0.32), 0 0 0 1px rgba(15,23,42,0.06)",
        position: "relative",
        fontFamily: FONT.sans,
      }}
    >
      {variant === "browser" ? (
        <BrowserBar url={url} title={title} />
      ) : (
        <MobileBar title={title} />
      )}
      <div style={{ position: "relative" }}>{children}</div>

      {showTodo ? (
        <div
          style={{
            position: "absolute",
            top: variant === "browser" ? 56 : 50,
            right: 16,
            fontFamily: FONT.mono,
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.warn,
            background: C.warnSoft,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${C.warn}66`,
          }}
        >
          {shotId ? `${shotId} · placeholder` : "placeholder"}
        </div>
      ) : null}
    </div>
  );
}

function BrowserBar({ url, title }: { url?: string; title?: string }) {
  return (
    <div
      style={{
        height: 44,
        background: C.surfaceMuted,
        borderBottom: `1px solid ${C.rule}`,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", gap: 7 }}>
        <Dot color="#FF5F57" />
        <Dot color="#FEBC2E" />
        <Dot color="#28C840" />
      </div>
      <div
        style={{
          flex: 1,
          height: 26,
          borderRadius: 999,
          background: C.surface,
          border: `1px solid ${C.rule}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 8,
          color: C.inkMuted,
          fontFamily: FONT.mono,
          fontSize: 13,
          letterSpacing: "0.02em",
        }}
      >
        <LockGlyph />
        <span style={{ color: C.inkSoft }}>{url ?? "hathor.local"}</span>
      </div>
      {title ? (
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.inkSoft,
          }}
        >
          {title}
        </div>
      ) : null}
    </div>
  );
}

function MobileBar({ title }: { title?: string }) {
  return (
    <div
      style={{
        height: 38,
        borderBottom: `1px solid ${C.rule}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px",
        fontFamily: FONT.sans,
        fontSize: 13,
        color: C.inkMuted,
        background: C.surfaceMuted,
      }}
    >
      <span>9:41</span>
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.inkSoft,
        }}
      >
        {title ?? "hathor"}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>●●●●</span>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        background: color,
      }}
    />
  );
}

function LockGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke={C.inkSoft} strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={C.inkSoft} strokeWidth="1.6" />
    </svg>
  );
}
