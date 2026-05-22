/**
 * "TODO: capture" placeholder. Per render-notes.md, real product UI captures
 * are required before exporting a final MP4. The placeholder is visible on
 * purpose so a stylized mock cannot accidentally ship as if it were product.
 */

import { C, FONT } from "./tokens";

export function PlaceholderCard({
  shot,
  capture,
  note,
  width,
  height,
}: {
  shot: string;
  capture: string;
  note?: string;
  width: number | string;
  height: number | string;
}) {
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        background: C.surface,
        border: `2px dashed ${C.inkSoft}`,
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 36,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 22,
          fontFamily: FONT.mono,
          fontSize: 18,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.warn,
        }}
      >
        TODO · capture
      </div>
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          fontFamily: FONT.mono,
          fontSize: 18,
          color: C.inkSoft,
        }}
      >
        {shot}
      </div>
      <div
        style={{
          fontFamily: FONT.sans,
          fontSize: 34,
          color: C.ink,
          fontWeight: 600,
          textAlign: "center",
          maxWidth: "90%",
        }}
      >
        {capture}
      </div>
      {note ? (
        <div
          style={{
            marginTop: 16,
            fontFamily: FONT.sans,
            fontSize: 22,
            color: C.inkMuted,
            textAlign: "center",
            maxWidth: "92%",
            lineHeight: 1.35,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
