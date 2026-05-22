"use client";

/**
 * SYNTHETIC TEST DATA — RESEARCH PROTOTYPE.
 *
 * /passport/verify — locally verifiable Hathor Passport check.
 *
 *   - Camera scan (html5-qrcode, dynamically imported on the client only;
 *     the package depends on `window` and crashes during SSR).
 *   - URL fallback ?demo=<jws> — the issue modal links to this for the
 *     manual smoke test.
 *   - Paste-JWS fallback for desktop demos with no camera available.
 *
 * Verification runs entirely in the browser against the demo public key.
 * No server lookup, no revocation, no backend. The watermark sits at
 * the top of the page on success, failure, and idle.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { verifyPassport, type VerifyResult } from "@/lib/passport/issue.ts";
import type { PassportPayload } from "@/lib/passport/schema.ts";

const C = {
  bg:        "#F7F3EA",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  ruleSoft:  "#EFEBE3",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  ink:       "#1C1917",
  mute:      "#44403C",
  meta:      "#6B6158",
  faint:     "#A8A29E",
  ok:        "#5F7A52",
  okBg:      "#ECF1E2",
  bad:       "#A3453B",
  badBg:     "#F4DCD8",
  amber:     "#B8833B",
  amberBg:   "#FAEFD3",
  paper:     "#F6F0E4",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const STATUS_LABELS: Record<string, { text: string; bg: string; fg: string }> = {
  valid:   { text: "Valid",   bg: C.okBg,    fg: C.ok },
  invalid: { text: "Invalid", bg: C.badBg,   fg: C.bad },
  due:     { text: "Due",     bg: C.amberBg, fg: C.amber },
  missing: { text: "Missing", bg: C.amberBg, fg: C.amber },
};

const SOURCE_LABELS: Record<string, string> = {
  card: "from card",
  rules_engine: "engine-validated",
  clinician_confirmed: "clinician-confirmed",
};

type CameraState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "scanning" }
  | { kind: "denied"; message: string }
  | { kind: "insecure_origin" }
  | { kind: "unsupported" };

export default function PassportVerifyPage() {
  return (
    <Suspense fallback={null}>
      <PassportVerifyInner />
    </Suspense>
  );
}

function PassportVerifyInner() {
  const search = useSearchParams();
  const demoJws = search?.get("demo") ?? null;

  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [cameraState, setCameraState] = useState<CameraState>({ kind: "idle" });
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);

  const runVerify = useCallback(async (jws: string) => {
    setVerifying(true);
    try {
      const res = await verifyPassport(jws.trim());
      setVerifyResult(res);
    } catch (err) {
      setVerifyResult({
        ok: false,
        error: "malformed",
      });
    } finally {
      setVerifying(false);
    }
  }, []);

  // ?demo=<jws> fallback so the issue modal can deep-link a working
  // verification without involving a camera. Used for the manual smoke
  // test and for Playwright-style E2E if anyone wires it later.
  useEffect(() => {
    if (demoJws && demoJws.length > 0) {
      void runVerify(demoJws);
    }
  }, [demoJws, runVerify]);

  // Detect insecure origins early — html5-qrcode will fail silently
  // without the proper banner otherwise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isSecure =
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isSecure && cameraState.kind === "idle") {
      setCameraState({ kind: "insecure_origin" });
    }
  }, [cameraState.kind]);

  const startCamera = useCallback(async () => {
    if (typeof window === "undefined") return;
    setCameraState({ kind: "requesting" });

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState({ kind: "unsupported" });
      return;
    }

    let Html5Qrcode;
    try {
      const mod = await import("html5-qrcode");
      Html5Qrcode = mod.Html5Qrcode;
    } catch (err) {
      setCameraState({
        kind: "denied",
        message: "Could not load the QR scanner library.",
      });
      return;
    }

    const containerId = "passport-qr-camera";
    const el = document.getElementById(containerId);
    if (!el) {
      setCameraState({ kind: "denied", message: "Scanner container not ready." });
      return;
    }

    const scanner = new Html5Qrcode(containerId, { verbose: false });

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
        },
        async (decodedText: string) => {
          // Stop the scanner before kicking off verification — the
          // camera tracks should be released as soon as we have a
          // candidate JWS.
          try {
            await scanner.stop();
          } catch {
            // Ignore; verification is the priority.
          }
          setCameraState({ kind: "idle" });
          scannerRef.current = null;
          await runVerify(decodedText);
        },
        () => {
          // No-op on per-frame failures; html5-qrcode fires this
          // continuously while no QR is in view.
        },
      );
      scannerRef.current = { stop: () => scanner.stop() };
      setCameraState({ kind: "scanning" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Camera permission was denied.";
      setCameraState({ kind: "denied", message });
    }
  }, [runVerify]);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Already stopped or never started.
      }
      scannerRef.current = null;
    }
    setCameraState({ kind: "idle" });
  }, []);

  useEffect(() => {
    return () => {
      // Best-effort cleanup on unmount.
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const onPaste = useCallback(() => {
    if (pasteValue.trim().length === 0) return;
    void runVerify(pasteValue);
  }, [pasteValue, runVerify]);

  const reset = useCallback(() => {
    setVerifyResult(null);
    setPasteValue("");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.ink,
        fontFamily: F.sans,
      }}
    >
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "20px 18px 60px" }}>
        <header style={{ marginBottom: 14 }}>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: C.copperInk,
            }}
          >
            Hathor Passport · verifier
          </div>
          <h1
            style={{
              fontFamily: F.serif,
              fontSize: 26,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              margin: "4px 0 0",
              color: C.ink,
            }}
          >
            Locally verifiable demo passport
          </h1>
          <p
            style={{
              marginTop: 6,
              fontSize: 13.5,
              color: C.mute,
              lineHeight: 1.55,
            }}
          >
            Signature verified locally using the demo public key. No
            server lookup, no revocation registry — synthetic prototype
            for the OSVP 2026 demo.
          </p>
        </header>

        <div
          style={{
            background: C.amberBg,
            border: "1px dashed " + C.amber,
            padding: "8px 12px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#8E6428",
            textAlign: "center",
            marginBottom: 18,
          }}
        >
          Synthetic test data · research prototype
        </div>

        {verifying && (
          <div
            style={{
              padding: "16px 18px",
              background: C.card,
              border: `1px solid ${C.rule}`,
              fontSize: 13.5,
              color: C.mute,
              marginBottom: 18,
            }}
          >
            Verifying signature…
          </div>
        )}

        {verifyResult && verifyResult.ok && (
          <PassportSuccess payload={verifyResult.payload} onReset={reset} />
        )}

        {verifyResult && !verifyResult.ok && (
          <PassportFailure error={verifyResult.error} onReset={reset} />
        )}

        {!verifyResult && !verifying && (
          <div style={{ display: "grid", gap: 16 }}>
            <CameraCard
              state={cameraState}
              onStart={startCamera}
              onStop={stopCamera}
            />
            <PasteCard
              value={pasteValue}
              onChange={setPasteValue}
              onSubmit={onPaste}
            />
          </div>
        )}

        <footer
          style={{
            marginTop: 28,
            paddingTop: 14,
            borderTop: `1px solid ${C.rule}`,
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.1em",
            color: C.faint,
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          Hathor demo · OSVP 2026 · not a clinical record · not a travel document
        </footer>
      </div>
    </div>
  );
}

function CameraCard({
  state,
  onStart,
  onStop,
}: {
  state: CameraState;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.rule}`,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.meta,
          marginBottom: 6,
        }}
      >
        Scan a passport QR
      </div>
      <p
        style={{
          fontSize: 13,
          color: C.mute,
          margin: "0 0 12px",
          lineHeight: 1.55,
        }}
      >
        Point your phone&rsquo;s back camera at a Hathor Passport QR.
        Verification happens locally on this device.
      </p>

      {state.kind === "insecure_origin" && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "8px 12px",
            background: C.amberBg,
            border: `1px solid ${C.amber}`,
            fontSize: 12.5,
            color: "#8E6428",
            lineHeight: 1.55,
          }}
        >
          Camera access requires HTTPS or localhost. This page appears to
          be served from an insecure origin — open the app via{" "}
          <code style={{ fontFamily: F.mono }}>localhost</code>, an
          HTTPS tunnel (ngrok / Cloudflare Tunnel), or a deployed
          preview URL.
        </div>
      )}

      {state.kind === "unsupported" && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "8px 12px",
            background: C.amberBg,
            border: `1px solid ${C.amber}`,
            fontSize: 12.5,
            color: "#8E6428",
          }}
        >
          This browser does not expose a camera API. Use the paste-JWS
          field below.
        </div>
      )}

      {state.kind === "denied" && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "8px 12px",
            background: C.badBg,
            border: `1px solid ${C.bad}`,
            fontSize: 12.5,
            color: C.bad,
          }}
        >
          {state.message || "Camera permission was denied."}
        </div>
      )}

      <div
        id="passport-qr-camera"
        style={{
          width: "100%",
          minHeight: state.kind === "scanning" ? 280 : 0,
          background: state.kind === "scanning" ? "#000" : "transparent",
          marginBottom: state.kind === "scanning" ? 12 : 0,
        }}
      />

      {state.kind !== "scanning" && (
        <button
          type="button"
          onClick={onStart}
          disabled={state.kind === "requesting"}
          style={{
            padding: "12px 18px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#FFFDF7",
            background: state.kind === "requesting" ? "#CFC4B1" : C.copper,
            border: "none",
            cursor: state.kind === "requesting" ? "not-allowed" : "pointer",
            width: "100%",
          }}
        >
          {state.kind === "requesting" ? "Requesting camera…" : "Grant camera permission"}
        </button>
      )}

      {state.kind === "scanning" && (
        <button
          type="button"
          onClick={onStop}
          style={{
            padding: "10px 16px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.copperInk,
            background: "transparent",
            border: `1px solid ${C.copper}`,
            cursor: "pointer",
            width: "100%",
          }}
        >
          Stop camera
        </button>
      )}
    </section>
  );
}

function PasteCard({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.rule}`,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.meta,
          marginBottom: 6,
        }}
      >
        Or paste a JWS
      </div>
      <p style={{ fontSize: 12.5, color: C.mute, margin: "0 0 10px", lineHeight: 1.55 }}>
        Useful when no camera is available. The string is the
        three-segment compact JWS the issue modal generates.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="eyJhbGciOiJFUzI1NiIsImtpZCI6Imh…"
        spellCheck={false}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontFamily: F.mono,
          fontSize: 11.5,
          color: C.ink,
          background: C.paper,
          border: `1px solid ${C.rule}`,
          resize: "vertical",
          marginBottom: 10,
        }}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={value.trim().length === 0}
        style={{
          padding: "10px 16px",
          fontFamily: F.mono,
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#FFFDF7",
          background: value.trim().length === 0 ? "#CFC4B1" : C.copper,
          border: "none",
          cursor: value.trim().length === 0 ? "not-allowed" : "pointer",
          width: "100%",
        }}
      >
        Verify
      </button>
    </section>
  );
}

function PassportSuccess({
  payload,
  onReset,
}: {
  payload: PassportPayload;
  onReset: () => void;
}) {
  const issued = useMemo(
    () => new Date(payload.issuedAt * 1000).toISOString().slice(0, 10),
    [payload.issuedAt],
  );

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div
        role="status"
        style={{
          background: C.okBg,
          border: `1px solid ${C.ok}`,
          padding: "14px 16px",
          fontFamily: F.serif,
          fontSize: 16,
          color: C.ok,
        }}
      >
        ✓ Signature valid — Demo issuer
      </div>

      <div
        style={{
          background: C.card,
          border: `1px solid ${C.rule}`,
          padding: "14px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px 14px",
        }}
      >
        <Field label="Subject (initials)" value={payload.subject.initials} />
        <Field label="Birth month" value={payload.subject.birthMonth} />
        <Field label="Issuer" value={payload.issuer.name} />
        <Field label="Issued" value={issued} />
        <Field label="Destination schedule" value={payload.schedule} />
        <Field label="Doses on record" value={String(payload.immunisations.length)} />
      </div>

      <div
        style={{
          background: C.card,
          border: `1px solid ${C.rule}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            background: C.paper,
            borderBottom: `1px solid ${C.rule}`,
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.meta,
          }}
        >
          Immunisations on this passport
        </div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: F.sans,
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr style={{ background: C.paper, color: C.meta }}>
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
                  style={{ borderTop: `1px solid ${C.ruleSoft}` }}
                >
                  <td style={td}>
                    <span style={{ fontFamily: F.serif, fontSize: 13.5, color: C.ink }}>
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
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                      }}
                    >
                      {s.text}
                    </span>
                  </td>
                  <td style={{ ...td, color: C.meta, fontSize: 11.5 }}>
                    {imm.source ? SOURCE_LABELS[imm.source] ?? imm.source : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: "10px 16px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.copperInk,
            background: "transparent",
            border: `1px solid ${C.copper}`,
            cursor: "pointer",
          }}
        >
          Verify another
        </button>
      </div>
    </section>
  );
}

function PassportFailure({
  error,
  onReset,
}: {
  error: "bad_signature" | "malformed" | "expired";
  onReset: () => void;
}) {
  const friendly = {
    bad_signature: "Signature did not verify against the demo issuer key.",
    malformed: "The QR did not contain a valid Hathor Passport JWS.",
    expired: "This passport has expired.",
  }[error];

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div
        role="alert"
        style={{
          background: C.badBg,
          border: `1px solid ${C.bad}`,
          padding: "14px 16px",
          fontFamily: F.serif,
          fontSize: 16,
          color: C.bad,
        }}
      >
        ✗ Verification failed
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.rule}`,
          padding: "14px 16px",
          fontSize: 13.5,
          color: C.mute,
          lineHeight: 1.6,
        }}
      >
        {friendly} No clinical data is shown for unverified passports —
        signed records only.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: "10px 16px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.copperInk,
            background: "transparent",
            border: `1px solid ${C.copper}`,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </section>
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
          color: C.meta,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 14.5,
          color: C.ink,
          marginTop: 2,
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontFamily: F.mono,
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 400,
};

const td: React.CSSProperties = {
  padding: "9px 12px",
  verticalAlign: "middle",
};
