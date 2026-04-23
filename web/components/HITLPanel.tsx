"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import {
  type Correction,
  type HITLRequiredPayload,
  postCorrections,
} from "@/lib/api";
import { FieldRow, type FieldRowState } from "@/components/FieldRow";

const H = {
  paper:     "#F6F0E4",
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  stone:     "#CFC4B1",
  ink:       "#1C1917",
  ink2:      "#292524",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  bad:       "#A3453B",
  badSoft:   "#F3E3DF",
  ok:        "#5F7A52",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

function MetaSpan({
  children,
  color = H.meta,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase" as const,
        color,
      }}
    >
      {children}
    </span>
  );
}

function ttlLabel(expiresAt: string): string {
  const diff = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return diff === 0 ? "Expired" : `${mins}m ${secs}s remaining`;
}

interface Props {
  payload: HITLRequiredPayload;
  imagePath: string;
  onConfirmed: () => void;
}

export function HITLPanel({ payload, imagePath, onConfirmed }: Props) {
  const { hitl_queue, resume_endpoint, expires_at } = payload;

  // Per-field action state: fieldPath → {action, correctedValue}
  const [fieldStates, setFieldStates] = useState<Record<string, FieldRowState>>(() =>
    Object.fromEntries(hitl_queue.map((item) => [item.field_path, {}]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [ttl, setTtl] = useState(() => ttlLabel(expires_at));

  // Countdown ticker
  useEffect(() => {
    const t = setInterval(() => setTtl(ttlLabel(expires_at)), 1000);
    return () => clearInterval(t);
  }, [expires_at]);

  const allResolved = hitl_queue.every((item) => {
    const s = fieldStates[item.field_path];
    if (!s?.action) return false;
    if (s.action === "edit" && !s.correctedValue?.trim()) return false;
    return true;
  });

  function handleFieldChange(
    fieldPath: string,
    action: import("@/lib/api").CorrectionAction,
    correctedValue?: string
  ) {
    setFieldStates((prev) => ({
      ...prev,
      [fieldPath]: { action, correctedValue },
    }));
    setPostError(null);
  }

  async function handleConfirm() {
    if (!allResolved || submitting) return;
    setSubmitting(true);
    setPostError(null);

    const corrections: Correction[] = hitl_queue.map((item) => {
      const s = fieldStates[item.field_path];
      const base: Correction = { field_path: item.field_path, action: s.action! };
      if (s.action === "edit") base.corrected_value = s.correctedValue!.trim();
      return base;
    });

    const result = await postCorrections(resume_endpoint, corrections);
    setSubmitting(false);

    if (result.ok) {
      onConfirmed();
    } else {
      setPostError(
        result.status === 410
          ? "Session expired — please restart the reconciliation."
          : result.status === 404
          ? "Session not found — please restart the reconciliation."
          : result.detail
      );
    }
  }

  // Determine card src from imagePath — next/image requires a known host or
  // a relative path. We serve the card through the API static files or use
  // the path directly when it resolves to a local dev URL.
  const expired = new Date(expires_at).getTime() < Date.now();
  const isPhaseD =
    imagePath.toLowerCase().includes("phase_d") ||
    imagePath.toLowerCase().includes("hitl_demo");
  const cardSrc = isPhaseD
    ? "/card-images/phase_d_demo.jpg"
    : "/card-images/demo.jpg";

  return (
    <div
      style={{
        border: `1px solid ${H.bad}`,
        borderLeft: `3px solid ${H.bad}`,
        background: H.card,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: H.badSoft,
          borderBottom: `1px solid ${H.rule}`,
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap" as const,
          gap: 8,
        }}
      >
        <div>
          <MetaSpan color={H.bad}>Clinician review required</MetaSpan>
          <p
            style={{
              fontFamily: F.serif,
              fontSize: 18,
              fontWeight: 400,
              color: H.ink,
              margin: "4px 0 0",
            }}
          >
            {hitl_queue.length} field{hitl_queue.length !== 1 ? "s" : ""} could not be read with confidence
          </p>
        </div>
        <MetaSpan color={expired ? H.bad : H.meta}>{ttl}</MetaSpan>
      </div>

      {/* Two-pane body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
        }}
      >
        {/* Left pane — card image */}
        <div
          style={{
            borderRight: `1px solid ${H.rule}`,
            padding: "24px",
            display: "flex",
            flexDirection: "column" as const,
            gap: 12,
          }}
        >
          <MetaSpan>Card image</MetaSpan>
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "900/650",
              border: `1px solid ${H.rule}`,
              background: H.paper,
              overflow: "hidden",
            }}
          >
            <Image
              src={cardSrc}
              alt="Vaccination card"
              fill
              style={{ objectFit: "contain" }}
              unoptimized
            />
          </div>
          <p
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: H.faint,
              letterSpacing: "0.06em",
              margin: 0,
            }}
          >
            {imagePath}
            {" · "}
            Extraction stubbed — real vision pending
          </p>
        </div>

        {/* Right pane — field review */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <div>
            <MetaSpan>Fields requiring review</MetaSpan>
            <p
              style={{
                fontFamily: F.sans,
                fontSize: 13,
                color: H.mute,
                margin: "6px 0 0",
                lineHeight: 1.5,
              }}
            >
              For each flagged field, choose <strong>Edit</strong> to correct
              the value, <strong>Keep</strong> to accept it as read, or{" "}
              <strong>Skip</strong> to exclude it from reconciliation.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
            {hitl_queue.map((item) => (
              <FieldRow
                key={item.field_path}
                item={item}
                state={fieldStates[item.field_path] ?? {}}
                onChange={(action, correctedValue) =>
                  handleFieldChange(item.field_path, action, correctedValue)
                }
              />
            ))}
          </div>

          {/* Error banner */}
          {postError && (
            <div
              style={{
                padding: "10px 14px",
                background: H.badSoft,
                border: `1px solid ${H.bad}`,
                fontFamily: F.mono,
                fontSize: 12,
                color: H.bad,
              }}
            >
              {postError}
            </div>
          )}

          {/* Confirm all */}
          <div
            style={{
              marginTop: "auto",
              paddingTop: 12,
              borderTop: `1px solid ${H.rule}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 14,
            }}
          >
            {!allResolved && (
              <MetaSpan color={H.faint}>
                {hitl_queue.filter((i) => !fieldStates[i.field_path]?.action).length}{" "}
                field{hitl_queue.filter((i) => !fieldStates[i.field_path]?.action).length !== 1 ? "s" : ""}{" "}
                unresolved
              </MetaSpan>
            )}
            <button
              onClick={handleConfirm}
              disabled={!allResolved || submitting || expired}
              style={{
                background:
                  !allResolved || submitting || expired ? H.stone : H.copper,
                color: "#FFFDF7",
                border: "none",
                padding: "12px 22px",
                fontFamily: F.mono,
                fontSize: 11.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase" as const,
                cursor:
                  !allResolved || submitting || expired ? "not-allowed" : "pointer",
                transition: "background 0.2s ease",
              }}
            >
              {submitting ? "Submitting…" : "Confirm all →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
