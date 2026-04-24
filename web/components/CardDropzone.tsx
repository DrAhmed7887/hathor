"use client";

/**
 * Drag-and-drop file picker for a vaccination card image.
 *
 * Sits before RedactionCanvas in the demo flow:
 *   CardDropzone → RedactionCanvas → POST /api/parse-card (step 6)
 *
 * Emits the raw File and a browser blob URL to the parent. Does not
 * itself upload anywhere — per PRD §2.5, nothing leaves the browser
 * until after the user has drawn redaction rectangles and applied
 * them in the next component.
 *
 * Pharos palette inline, matching project convention.
 */

import { useCallback, useRef, useState } from "react";

const H = {
  paper:     "#F6F0E4",
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  ruleSoft:  "#EFEBE3",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  stone:     "#CFC4B1",
  ink:       "#1C1917",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — typical phone photo headroom

export interface CardDropzoneProps {
  onFileAccepted: (file: File, previewUrl: string) => void;
  /** Optional clear handler; parent owns the accepted state. */
  onClear?: () => void;
  /** When present, renders the currently-accepted file instead of the
   * empty drop surface. The parent is the source of truth for whether
   * a file is currently selected. */
  acceptedFile?: { name: string; previewUrl: string } | null;
}

export function CardDropzone({
  onFileAccepted,
  onClear,
  acceptedFile,
}: CardDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!ACCEPTED_MIME.includes(file.type)) {
        setRejectReason(
          `Unsupported file type (${file.type || "unknown"}). Accepted: JPEG, PNG, WebP.`,
        );
        return;
      }
      if (file.size > MAX_BYTES) {
        setRejectReason(
          `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 10 MB.`,
        );
        return;
      }
      setRejectReason(null);
      const previewUrl = URL.createObjectURL(file);
      onFileAccepted(file, previewUrl);
    },
    [onFileAccepted],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      handleFile(file);
    },
    [handleFile],
  );

  // Accepted file — render the summary with a clear button.
  if (acceptedFile) {
    return (
      <div
        style={{
          background: H.card,
          border: `1px solid ${H.rule}`,
          padding: "14px 20px",
          fontFamily: F.sans,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: H.paper,
            border: `1px solid ${H.rule}`,
            backgroundImage: `url(${acceptedFile.previewUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: H.copperInk,
            }}
          >
            Card accepted · redaction pending
          </div>
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 15,
              color: H.ink,
              margin: "4px 0 0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {acceptedFile.name}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (onClear) onClear();
            if (inputRef.current) inputRef.current.value = "";
          }}
          style={{
            padding: "8px 16px",
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: H.meta,
            background: "transparent",
            border: `1px solid ${H.rule}`,
            cursor: "pointer",
          }}
        >
          Replace
        </button>
      </div>
    );
  }

  // Empty surface — drop / click-to-select.
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload vaccination card image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        style={{
          padding: "36px 24px",
          background: dragActive ? H.paper2 : H.card,
          border: `1px dashed ${dragActive ? H.copper : H.rule}`,
          textAlign: "center",
          cursor: "pointer",
          transition: "background 0.15s ease, border-color 0.15s ease",
          fontFamily: F.sans,
        }}
      >
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: H.copperInk,
            marginBottom: 8,
          }}
        >
          Phase B · card upload
        </div>
        <div
          style={{
            fontFamily: F.serif,
            fontSize: 18,
            color: H.ink,
            fontWeight: 400,
          }}
        >
          Drop the vaccination card here
        </div>
        <div
          style={{
            fontFamily: F.sans,
            fontSize: 13,
            color: H.meta,
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          or click to select a file.{" "}
          <span style={{ color: H.faint }}>JPEG, PNG, or WebP · max 10 MB</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME.join(",")}
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {rejectReason && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: "10px 14px",
            // AMBER per PRD §6 point 3 — this is a user-input-warning,
            // not a clinical-safety violation. Red is reserved for that.
            background: H.amberSoft,
            border: `1px solid ${H.amber}`,
            fontFamily: F.mono,
            fontSize: 12,
            color: H.amber,
            letterSpacing: "0.04em",
          }}
        >
          {rejectReason}
        </div>
      )}
    </div>
  );
}
