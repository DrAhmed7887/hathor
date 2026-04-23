"use client";

import { type CorrectionAction, type HITLQueueItem } from "@/lib/api";

const H = {
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  copper:    "#CC785C",
  ink:       "#1C1917",
  ink2:      "#292524",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  bad:       "#A3453B",
  badSoft:   "#F3E3DF",
  badBorder: "#D4837A",
  warn:      "#B45309",
  ok:        "#5F7A52",
};

const F = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export interface FieldRowState {
  action?: CorrectionAction;
  correctedValue?: string;
}

interface Props {
  item: HITLQueueItem;
  state: FieldRowState;
  onChange: (action: CorrectionAction, correctedValue?: string) => void;
}

function ActionBtn({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase" as const,
        border: `1px solid ${active ? color : H.rule}`,
        background: active ? color : "transparent",
        color: active ? "#FFFDF7" : H.meta,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}

export function FieldRow({ item, state, onChange }: Props) {
  const { field_path, extracted } = item;
  const confidence = extracted.confidence;
  const pct = Math.round(confidence * 100);
  const confidenceColor =
    confidence >= 0.85 ? H.ok : confidence >= 0.6 ? H.warn : H.bad;

  const shortPath = field_path.replace(/^extracted_doses\[(\d+)\]\./, "dose $1 · ");

  return (
    <div
      style={{
        background: H.badSoft,
        border: `1px solid ${H.badBorder}`,
        borderLeft: `3px solid ${H.bad}`,
        padding: "14px 16px",
      }}
    >
      {/* Field identity + confidence */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
            color: H.bad,
            fontWeight: 500,
          }}
        >
          {shortPath}
        </span>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            color: confidenceColor,
            letterSpacing: "0.08em",
          }}
        >
          {pct}% confidence
        </span>
      </div>

      {/* Extracted value */}
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 14,
          color: H.ink,
          marginBottom: 6,
          padding: "6px 10px",
          background: "rgba(163,69,59,0.06)",
          border: `1px solid ${H.badBorder}`,
          display: "inline-block",
          minWidth: 120,
        }}
      >
        {extracted.value ?? <em style={{ color: H.faint }}>illegible</em>}
      </div>

      {/* Ambiguity reason */}
      {extracted.ambiguity_reason && (
        <p
          style={{
            fontFamily: F.sans,
            fontSize: 12,
            color: H.bad,
            fontStyle: "italic",
            margin: "6px 0 10px",
          }}
        >
          {extracted.ambiguity_reason}
        </p>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const }}>
        <ActionBtn
          label="Edit"
          active={state.action === "edit"}
          color={H.copper}
          onClick={() => onChange("edit", state.correctedValue ?? "")}
        />
        <ActionBtn
          label="Keep"
          active={state.action === "keep"}
          color={H.ok}
          onClick={() => onChange("keep", undefined)}
        />
        <ActionBtn
          label="Skip"
          active={state.action === "skip"}
          color={H.meta}
          onClick={() => onChange("skip", undefined)}
        />

        {/* Inline edit input */}
        {state.action === "edit" && (
          <input
            autoFocus
            type="text"
            placeholder="Enter corrected value…"
            value={state.correctedValue ?? ""}
            onChange={(e) => onChange("edit", e.target.value)}
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              padding: "5px 10px",
              border: `1px solid ${H.copper}`,
              background: H.card,
              color: H.ink,
              outline: "none",
              width: 200,
            }}
          />
        )}
      </div>

      {/* Edit validation hint */}
      {state.action === "edit" && !state.correctedValue?.trim() && (
        <p
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            color: H.warn,
            margin: "6px 0 0",
            letterSpacing: "0.06em",
          }}
        >
          Enter a value to enable Confirm all
        </p>
      )}
    </div>
  );
}
