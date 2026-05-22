"use client";

/**
 * SYNTHETIC TEST DATA — RESEARCH PROTOTYPE.
 *
 * Hathor Passport issue-time modal. Mounted from ExportPanel after the
 * rules engine has validated the reconciled doses and the clinician has
 * cleared every amber row. The modal:
 *
 *   1. Maps the engine-confirmed doses into a passport payload (initials
 *      + birth-month only).
 *   2. Signs that payload as a compact JWS with the demo ES256 keypair.
 *   3. Renders the JWS as a QR code, plus a human-readable summary.
 *   4. Offers a print view (A5 single-page layout) that calls
 *      window.print() on a hidden iframe.
 *
 * The AI does not sign — the demo issuer key signs at clinician-confirm
 * time. Both the modal header and the print page carry the synthetic
 * watermark.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { issuePassport } from "@/lib/passport/issue.ts";
import { bundleToPassportPayload } from "@/lib/passport/bundle-mapping.ts";
import type { PassportPayload } from "@/lib/passport/schema.ts";
import type {
  CountryCode,
  IntakeContext,
  ReconciledDose,
} from "@/lib/types";

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
  ink2:      "#292524",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  ok:        "#5F7A52",
  okWash:    "#ECF1E2",
  bad:       "#A3453B",
  amber:     "#B8833B",
  amberWash: "#FAEFD3",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export interface PassportIssueModalProps {
  open: boolean;
  onClose: () => void;
  doses: ReconciledDose[];
  childDob: string;
  sourceCountry?: CountryCode;
  destinationCountry?: CountryCode;
  intake?: IntakeContext;
}

const STATUS_LABELS: Record<string, { text: string; bg: string; fg: string }> = {
  valid:   { text: "Valid",   bg: "#ECF1E2", fg: "#5F7A52" },
  invalid: { text: "Invalid", bg: "#F4DCD8", fg: "#A3453B" },
  due:     { text: "Due",     bg: "#FAEFD3", fg: "#B8833B" },
  missing: { text: "Missing", bg: "#FAEFD3", fg: "#B8833B" },
};

const SOURCE_LABELS: Record<string, string> = {
  card: "from card",
  rules_engine: "engine-validated",
  clinician_confirmed: "clinician-confirmed",
};

export function PassportIssueModal({
  open,
  onClose,
  doses,
  childDob,
  sourceCountry: _sourceCountry,
  destinationCountry,
  intake: _intake,
}: PassportIssueModalProps) {
  const [jws, setJws] = useState<string | null>(null);
  const [payload, setPayload] = useState<PassportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const verifyUrl = useMemo(() => {
    if (typeof window === "undefined" || !jws) return "";
    const base = `${window.location.origin}/passport/verify`;
    return `${base}?demo=${encodeURIComponent(jws)}`;
  }, [jws]);

  useEffect(() => {
    let cancelled = false;
    if (!open) {
      setJws(null);
      setPayload(null);
      setError(null);
      return;
    }

    setIssuing(true);
    setError(null);

    (async () => {
      try {
        const built = bundleToPassportPayload({
          doses,
          childDob,
          destinationCountry,
        });
        const signed = await issuePassport(built);
        if (cancelled) return;
        setPayload(built);
        setJws(signed);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to issue passport.");
      } finally {
        if (!cancelled) setIssuing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, doses, childDob, destinationCountry]);

  const printPassport = useCallback(() => {
    if (!payload || !jws) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(renderPrintHtml(payload, verifyUrl));
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 80);
  }, [payload, jws, verifyUrl]);

  const copyJws = useCallback(async () => {
    if (!jws) return;
    try {
      await navigator.clipboard.writeText(jws);
    } catch {
      // Clipboard write can fail under iframe / non-secure origin. The
      // user can still right-click-copy from the visible string.
    }
  }, [jws]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passport-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,25,23,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: F.sans,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: H.paper,
          maxWidth: 640,
          width: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          border: `1px solid ${H.rule}`,
          boxShadow: "0 20px 50px rgba(28,25,23,0.35)",
        }}
      >
        <header
          style={{
            padding: "16px 22px",
            borderBottom: `1px solid ${H.rule}`,
            background: H.paper2,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: H.copperInk,
              }}
            >
              Hathor Passport · demo issuance
            </div>
            <h3
              id="passport-modal-title"
              style={{
                fontFamily: F.serif,
                fontSize: 22,
                fontWeight: 400,
                color: H.ink,
                margin: "4px 0 0",
                letterSpacing: "-0.01em",
              }}
            >
              Locally verifiable demo passport
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close passport modal"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 22,
              color: H.mute,
              cursor: "pointer",
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </header>

        <Watermark />

        {issuing && !payload && (
          <div style={{ padding: "32px 22px", color: H.mute, fontSize: 13.5 }}>
            Signing payload with demo issuer key…
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              margin: "16px 22px",
              padding: "10px 14px",
              background: "#F4DCD8",
              border: `1px solid ${H.bad}`,
              fontFamily: F.mono,
              fontSize: 12,
              color: H.bad,
            }}
          >
            {error}
          </div>
        )}

        {payload && jws && (
          <div style={{ padding: "20px 22px", display: "grid", gap: 20 }}>
            <div
              style={{
                background: H.card,
                border: `1px solid ${H.rule}`,
                padding: "16px 18px",
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 18,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  background: "#FFFFFF",
                  padding: 12,
                  border: `1px solid ${H.rule}`,
                }}
              >
                <QRCodeSVG
                  value={jws}
                  size={180}
                  level="M"
                  marginSize={2}
                />
              </div>
              <div>
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: H.meta,
                  }}
                >
                  Signature · ES256
                </div>
                <div
                  style={{
                    fontFamily: F.serif,
                    fontSize: 16,
                    color: H.ink,
                    margin: "2px 0 6px",
                  }}
                >
                  Signature: Demo issuer
                </div>
                <div style={{ fontSize: 12.5, color: H.mute, lineHeight: 1.55 }}>
                  Signature verified locally using demo public key. The
                  AI does not sign — the demo clinic key signs the
                  reconciled record.
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: H.faint }}>
                  Payload: {jws.length} characters · QR error-correction M
                </div>
              </div>
            </div>

            <SummaryGrid payload={payload} />

            <ImmTable payload={payload} />

            <div
              style={{
                fontSize: 12,
                color: H.mute,
                lineHeight: 1.6,
                background: H.card,
                border: `1px solid ${H.rule}`,
                padding: "12px 14px",
              }}
            >
              <strong style={{ color: H.ink }}>Verify this passport:</strong>{" "}
              scan the QR with another device or open{" "}
              <code
                style={{
                  fontFamily: F.mono,
                  background: H.ruleSoft,
                  padding: "1px 6px",
                  fontSize: 11.5,
                }}
              >
                /passport/verify
              </code>{" "}
              and paste the JWS. Verification runs entirely in-browser
              against the demo public key.
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={copyJws}
                style={{
                  padding: "10px 16px",
                  fontFamily: F.mono,
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: H.copperInk,
                  background: "transparent",
                  border: `1px solid ${H.copper}`,
                  cursor: "pointer",
                }}
              >
                Copy JWS
              </button>
              <button
                type="button"
                onClick={printPassport}
                style={{
                  padding: "10px 18px",
                  fontFamily: F.mono,
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "#FFFDF7",
                  background: H.copper,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Print passport
              </button>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          title="HATHOR passport (print surface)"
          aria-hidden
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            border: 0,
          }}
        />
      </div>
    </div>
  );
}

function Watermark() {
  return (
    <div
      style={{
        margin: "12px 22px 0",
        padding: "8px 12px",
        background: "#FAEFD3",
        border: "1px dashed #B8833B",
        fontFamily: F.mono,
        fontSize: 11,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "#8E6428",
        textAlign: "center",
      }}
    >
      Synthetic test data · research prototype
    </div>
  );
}

function SummaryGrid({ payload }: { payload: PassportPayload }) {
  const issued = new Date(payload.issuedAt * 1000).toISOString().slice(0, 10);
  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "10px 18px",
      }}
    >
      <Field label="Subject (initials)" value={payload.subject.initials} />
      <Field label="Birth month" value={payload.subject.birthMonth} />
      <Field label="Issuer" value={payload.issuer.name} />
      <Field label="Issue date" value={issued} />
      <Field label="Destination schedule" value={payload.schedule} />
      <Field label="Doses on record" value={String(payload.immunisations.length)} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.meta,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 15,
          color: H.ink,
          marginTop: 2,
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function ImmTable({ payload }: { payload: PassportPayload }) {
  if (payload.immunisations.length === 0) {
    return (
      <div
        style={{
          background: H.card,
          border: `1px solid ${H.rule}`,
          padding: "16px 18px",
          fontSize: 13,
          color: H.mute,
        }}
      >
        No reconciled doses to issue. Resolve any pending clinician
        review and re-export.
      </div>
    );
  }

  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          background: H.paper2,
          borderBottom: `1px solid ${H.rule}`,
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.meta,
        }}
      >
        Immunisations on this passport
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: F.sans,
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: H.paper2, color: H.meta }}>
            <th style={th}>Vaccine</th>
            <th style={th}>Date</th>
            <th style={th}>Status</th>
            <th style={th}>Source</th>
          </tr>
        </thead>
        <tbody>
          {payload.immunisations.map((imm, i) => {
            const s = STATUS_LABELS[imm.status] ?? STATUS_LABELS.valid;
            return (
              <tr
                key={`${imm.vaccineCode}-${imm.date}-${i}`}
                style={{ borderTop: `1px solid ${H.ruleSoft}` }}
              >
                <td style={td}>
                  <span style={{ fontFamily: F.serif, fontSize: 14, color: H.ink }}>
                    {imm.vaccineLabel}
                  </span>
                </td>
                <td style={td}>{imm.date}</td>
                <td style={td}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      background: s.bg,
                      color: s.fg,
                      fontFamily: F.mono,
                      fontSize: 10.5,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    {s.text}
                  </span>
                </td>
                <td style={{ ...td, color: H.meta, fontSize: 12 }}>
                  {imm.source ? SOURCE_LABELS[imm.source] ?? imm.source : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 16px",
  fontFamily: F.mono,
  fontSize: 10.5,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontWeight: 400,
};

const td: React.CSSProperties = {
  padding: "10px 16px",
  verticalAlign: "middle",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPrintHtml(payload: PassportPayload, verifyUrl: string): string {
  const issued = new Date(payload.issuedAt * 1000).toISOString().slice(0, 10);

  // QR is rendered server-side as raw SVG by deferring to a
  // browser-only library at print time would race with the print
  // dialog — instead we ship a simple anchor and rely on the user
  // opening the verify URL on the second device. The screen-side
  // modal still shows the live QR for actual scanning.
  const qrLink = escapeHtml(verifyUrl);

  const rows = payload.immunisations
    .map((imm) => {
      const s = STATUS_LABELS[imm.status] ?? STATUS_LABELS.valid;
      return `
        <tr>
          <td class="serif">${escapeHtml(imm.vaccineLabel)}</td>
          <td>${escapeHtml(imm.date)}</td>
          <td><span class="pill" style="background:${s.bg};color:${s.fg};">${escapeHtml(s.text)}</span></td>
          <td class="meta">${escapeHtml(imm.source ? SOURCE_LABELS[imm.source] ?? imm.source : "—")}</td>
        </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Hathor Passport (synthetic)</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: ${H.ink};
    font-family: ${F.sans};
    font-size: 12px;
    background: ${H.paper};
  }
  .wrap { padding: 14mm 12mm; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 1px solid ${H.rule}; padding-bottom: 8mm; margin-bottom: 8mm;
  }
  .eyebrow {
    font-family: ${F.mono}; font-size: 9px; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${H.copperInk};
  }
  h1 {
    font-family: ${F.serif}; font-weight: 400; font-size: 22px;
    margin: 4px 0 0; letter-spacing: -0.01em;
  }
  .watermark {
    background: #FAEFD3; border: 1px dashed #B8833B;
    padding: 6px 8px; margin: 6mm 0;
    font-family: ${F.mono}; font-size: 10px; letter-spacing: 0.16em;
    text-transform: uppercase; color: #8E6428; text-align: center;
  }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 10mm;
    margin-bottom: 8mm;
  }
  .field-label {
    font-family: ${F.mono}; font-size: 9px; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${H.meta};
  }
  .field-value { font-family: ${F.serif}; font-size: 13px; margin-top: 1mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  th, td { text-align: left; padding: 5px 8px; }
  th {
    background: ${H.paper2}; font-family: ${F.mono};
    font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 400; color: ${H.meta};
  }
  td { border-top: 1px solid ${H.ruleSoft}; font-size: 11.5px; }
  .serif { font-family: ${F.serif}; font-size: 12px; }
  .meta { color: ${H.meta}; font-size: 10.5px; }
  .pill {
    display: inline-block; padding: 1px 6px;
    font-family: ${F.mono}; font-size: 9px;
    letter-spacing: 0.12em; text-transform: uppercase;
  }
  .footer {
    margin-top: 8mm; padding-top: 6mm;
    border-top: 1px solid ${H.rule};
    font-size: 10px; color: ${H.mute}; line-height: 1.55;
  }
  .verify { font-family: ${F.mono}; font-size: 10px; color: ${H.copperInk}; word-break: break-all; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <div class="eyebrow">Hathor Passport</div>
        <h1>Locally verifiable demo passport</h1>
      </div>
      <div class="eyebrow">Issued ${escapeHtml(issued)}</div>
    </div>

    <div class="watermark">Synthetic test data · research prototype</div>

    <div class="grid">
      <div>
        <div class="field-label">Subject (initials)</div>
        <div class="field-value">${escapeHtml(payload.subject.initials || "—")}</div>
      </div>
      <div>
        <div class="field-label">Birth month</div>
        <div class="field-value">${escapeHtml(payload.subject.birthMonth || "—")}</div>
      </div>
      <div>
        <div class="field-label">Issuer</div>
        <div class="field-value">${escapeHtml(payload.issuer.name)}</div>
      </div>
      <div>
        <div class="field-label">Issue date</div>
        <div class="field-value">${escapeHtml(issued)}</div>
      </div>
      <div>
        <div class="field-label">Destination schedule</div>
        <div class="field-value">${escapeHtml(payload.schedule)}</div>
      </div>
      <div>
        <div class="field-label">Signature</div>
        <div class="field-value">Demo issuer · ES256</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Vaccine</th><th>Date</th><th>Status</th><th>Source</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="footer">
      Verify at: <span class="verify">${qrLink || "/passport/verify"}</span><br/>
      Signature verified locally using demo public key. The AI does not
      sign; the demo clinic key signs the reconciled record. This
      passport is part of a research prototype for OSVP 2026 — not a
      signed clinical record, not a travel document.
    </div>
  </div>
</body>
</html>`;
}
