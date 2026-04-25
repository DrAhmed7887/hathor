"use client";

/**
 * /demo — the judge-facing fast-path flow.
 *
 * CANONICAL-ROUTE DECISION (per the revised plan's step 10):
 *
 *   /demo is the CANONICAL demo route for the hackathon. It hosts the
 *   6-phase fast-path flow specified in the build prompt:
 *     intake → upload → redact → parse → validate → export.
 *
 *   /reconcile-card is PRESERVED as a secondary route exposing the
 *   full agent-SSE reasoning flow (ChatIntake input form → Phase-D
 *   HITL queue → Phase-E recommendations with override-to-FHIR).
 *   It is not duplicated here — the two routes serve different
 *   purposes:
 *
 *     /demo            — fast, judge-facing, one vision call + one
 *                        engine call + export. Optimized for
 *                        latency and narrative clarity.
 *     /reconcile-card  — deep, clinician-facing, the full agent
 *                        reasoning trace with HITL and structured
 *                        overrides. Optimized for trust and audit.
 *
 *   The landing page links both; the revised-plan "do not duplicate
 *   the flow" rule is honored because they ARE different flows, not
 *   two implementations of the same one.
 *
 * STATE: plain React useState at the page level. The original spec
 * named React Context + localStorage; for a demo where the session
 * is typically one-shot and state is strictly linear (each phase
 * feeds the next), prop-drilling through 6 children is not a
 * material win over Context. localStorage persistence deferred to
 * step 14 if the smoke test surfaces a need.
 */

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { ChatIntake } from "@/components/ChatIntake";
import { CardDropzone } from "@/components/CardDropzone";
import {
  RedactionCanvas,
  type RedactionApplyPayload,
} from "@/components/RedactionCanvas";
import { ParsedResults } from "@/components/ParsedResults";
import { ScheduleView } from "@/components/ScheduleView";
import { ExportPanel } from "@/components/ExportPanel";
import { ExplainerParsePlayer } from "@/components/ExplainerParsePlayer";

import {
  COUNTRIES,
  COUNTRY_SELECTOR_DISCLOSURE,
  READINESS_BANNER,
  SELECTABLE_DESTINATION_COUNTRIES,
  SELECTABLE_SOURCE_COUNTRIES,
  canRunReconciliation,
} from "@/lib/countries";
import type {
  CountryCode,
  IntakeContext,
  ParsedCardOutput,
  ParsedCardRow,
  ReconciledDose,
  ValidateScheduleResult,
} from "@/lib/types";
import {
  buildValidationRecords,
  rowsSignature as computeRowsSignature,
} from "@/lib/validation";

// Pharos tokens — match existing convention.
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
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
  ok:        "#5F7A52",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

type Phase = "intake" | "upload" | "redact" | "parse" | "validate" | "export";

// Pure helpers (buildValidationRecords, rowsSignature, ENGINE_COVERED_ANTIGENS)
// live in @/lib/validation so booster handling stays testable.

// ── Progress rail ────────────────────────────────────────────────────────────

const PHASES: { id: Phase; label: string }[] = [
  { id: "intake",   label: "A · Intake" },
  { id: "upload",   label: "B · Upload" },
  { id: "redact",   label: "B.1 · Redact" },
  { id: "parse",    label: "D · Parse" },
  { id: "validate", label: "E · Validate" },
  { id: "export",   label: "F · Export" },
];

function ProgressRail({ current }: { current: Phase }) {
  const idx = PHASES.findIndex((p) => p.id === current);
  return (
    <nav
      aria-label="Demo phase progress"
      style={{
        display: "flex",
        gap: 6,
        padding: "12px 20px",
        background: H.card,
        border: `1px solid ${H.rule}`,
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        overflowX: "auto",
      }}
    >
      {PHASES.map((p, i) => {
        const active = i === idx;
        const done = i < idx;
        const color = active ? H.copperInk : done ? H.ok : H.faint;
        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: done ? H.ok : active ? H.copper : "transparent",
                border: `1px solid ${color}`,
              }}
            />
            <span style={{ color }}>{p.label}</span>
            {i < PHASES.length - 1 && (
              <span
                aria-hidden
                style={{ color: H.faint, padding: "0 6px" }}
              >
                ·
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ── Intake metadata form (DOB + countries) ───────────────────────────────────

interface IntakeFormState {
  childDob: string;
  sourceCountry: CountryCode;
  destinationCountry: CountryCode;
}

function IntakeMetaForm({
  value,
  onChange,
  onConfirm,
  disabled,
}: {
  value: IntakeFormState;
  onChange: (v: IntakeFormState) => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const dobValid = /^\d{4}-\d{2}-\d{2}$/.test(value.childDob);
  return (
    <section
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        padding: "16px 20px",
        fontFamily: F.sans,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.copperInk,
        }}
      >
        Phase A.1 · confirm prep details
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr auto",
          gap: 12,
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: H.meta,
            }}
          >
            Child DOB
          </span>
          <input
            type="date"
            value={value.childDob}
            onChange={(e) => onChange({ ...value, childDob: e.target.value })}
            disabled={disabled}
            style={{
              padding: "8px 10px",
              fontFamily: F.mono,
              fontSize: 13,
              color: H.ink,
              background: "#fff",
              border: `1px solid ${dobValid ? H.rule : H.amber}`,
              borderRadius: 0,
            }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: H.meta,
            }}
          >
            Card origin
          </span>
          <select
            value={value.sourceCountry}
            onChange={(e) =>
              onChange({
                ...value,
                sourceCountry: e.target.value as CountryCode,
              })
            }
            disabled={disabled}
            style={{
              padding: "8px 10px",
              fontFamily: F.sans,
              fontSize: 13,
              color: H.ink,
              background: "#fff",
              border: `1px solid ${H.rule}`,
              borderRadius: 0,
            }}
          >
            {SELECTABLE_SOURCE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameLocal ? `${c.name} · ${c.nameLocal}` : c.name}
                {c.readiness === "needs_review" ? "  (needs review)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: H.meta,
            }}
          >
            Destination schedule
          </span>
          <select
            value={value.destinationCountry}
            onChange={(e) =>
              onChange({
                ...value,
                destinationCountry: e.target.value as CountryCode,
              })
            }
            disabled={disabled}
            style={{
              padding: "8px 10px",
              fontFamily: F.sans,
              fontSize: 13,
              color: H.ink,
              background: "#fff",
              border: `1px solid ${H.rule}`,
              borderRadius: 0,
            }}
          >
            {SELECTABLE_DESTINATION_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameLocal ? `${c.name} · ${c.nameLocal}` : c.name}
                {c.readiness === "needs_review" ? "  (needs review)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!dobValid || disabled}
          style={{
            padding: "9px 18px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#FFFDF7",
            background: !dobValid || disabled ? H.stone : H.copper,
            border: "none",
            cursor: !dobValid || disabled ? "not-allowed" : "pointer",
          }}
        >
          Continue →
        </button>
      </div>
      <CountryReadinessLine
        sourceCode={value.sourceCountry}
        destinationCode={value.destinationCountry}
      />
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 12,
          color: H.faint,
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        {COUNTRY_SELECTOR_DISCLOSURE}
      </p>
    </section>
  );
}

function ParsingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        borderLeft: `3px solid ${H.copper}`,
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: F.sans,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: H.copper,
          animation: "hathorPulse 1.4s ease-in-out infinite",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: H.copperInk,
          }}
        >
          Phase D · vision pass in flight
        </div>
        <div style={{ fontFamily: F.serif, fontSize: 13.5, color: H.mute }}>
          Reading every row off the card with per-cell confidence…
        </div>
      </div>
      <style>
        {`@keyframes hathorPulse { 0%,100% { opacity: 0.35 } 50% { opacity: 1 } }`}
      </style>
    </div>
  );
}

function ParseErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: "14px 18px",
        background: H.amberSoft,
        border: `1px solid ${H.amber}`,
        borderLeft: `3px solid ${H.amber}`,
        fontFamily: F.sans,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.amber,
        }}
      >
        Phase D · parse failed
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 14, color: H.ink }}>
        Hathor could not finish reading the card. The card and intake details
        are preserved — try re-uploading or re-parsing.
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 11.5,
          color: H.amber,
          background: "rgba(184,131,59,0.08)",
          padding: "8px 10px",
          border: `1px dashed ${H.amber}`,
          wordBreak: "break-word",
        }}
      >
        {message}
      </div>
    </div>
  );
}

function NeedsReviewSchedulePanel({
  destinationCode,
  confirmedRowCount,
}: {
  destinationCode: CountryCode;
  confirmedRowCount: number;
}) {
  const dest = COUNTRIES[destinationCode];
  const banner = READINESS_BANNER.needs_review;
  return (
    <section
      role="status"
      aria-live="polite"
      style={{
        padding: "16px 20px",
        background: H.amberSoft,
        border: `1px solid ${H.amber}`,
        borderLeft: `3px solid ${H.amber}`,
        fontFamily: F.sans,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.amber,
        }}
      >
        Phase E · {dest.name} · {banner.label}
      </div>
      <h3
        style={{
          fontFamily: F.serif,
          fontSize: 18,
          fontWeight: 400,
          color: H.ink,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        Hathor will not produce due/overdue verdicts against the {dest.name} schedule
      </h3>
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 13,
          color: H.amber,
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        {banner.body}
      </p>
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 13,
          color: H.meta,
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        {confirmedRowCount === 0
          ? "No clinician-confirmed doses cleared the trust gate; the extracted history above is what would be carried forward to the destination clinic for clinician/public-health review."
          : `${confirmedRowCount} clinician-confirmed dose${confirmedRowCount === 1 ? "" : "s"} cleared the trust gate and would be carried forward as the patient's documented immunization history. Confirm the destination schedule with public-health guidance before suggesting catch-up.`}
      </p>
    </section>
  );
}

function CountryReadinessLine({
  sourceCode,
  destinationCode,
}: {
  sourceCode: CountryCode;
  destinationCode: CountryCode;
}) {
  const source = COUNTRIES[sourceCode];
  const destination = COUNTRIES[destinationCode];
  const destBanner = READINESS_BANNER[destination.readiness];
  const destAmber = destination.readiness !== "partial_ready";
  const accent = destAmber ? H.amber : H.copper;
  const accentText = destAmber ? H.amber : H.copperInk;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: destAmber ? H.amberSoft : H.paper2,
        border: `1px solid ${destAmber ? H.amber : H.rule}`,
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ReadinessIcon kind={destAmber ? "needs_review" : "partial_ready"} />
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: accentText,
            }}
          >
            Destination · {destination.name} · {destBanner.label}
          </div>
        </div>
        <ReconciliationStatusPill canRun={!destAmber} />
      </div>
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 13.5,
          color: destAmber ? H.amber : H.mute,
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        {destBanner.body}
      </p>
      {source.code !== destination.code && (
        <p
          style={{
            fontFamily: F.serif,
            fontSize: 12.5,
            color: H.meta,
            margin: 0,
            lineHeight: 1.55,
            paddingTop: 6,
            borderTop: `1px dashed ${destAmber ? H.amber : H.rule}`,
          }}
        >
          <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, marginRight: 8 }}>
            Source
          </span>
          {source.name}
          {source.nameLocal ? ` (${source.nameLocal})` : ""} — {source.blurb}
        </p>
      )}
    </div>
  );
}

function ReadinessIcon({ kind }: { kind: "partial_ready" | "needs_review" }) {
  const partial = kind === "partial_ready";
  const stroke = partial ? H.copperInk : H.amber;
  if (partial) {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          d="M9 1.6L15.4 4.2v4.6c0 3.6-2.7 6.6-6.4 7.6C5.3 15.4 2.6 12.4 2.6 8.8V4.2L9 1.6z"
          fill="none"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M5.6 9.2 7.8 11.4 12.4 6.6"
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M9 1.6L15.4 4.2v4.6c0 3.6-2.7 6.6-6.4 7.6C5.3 15.4 2.6 12.4 2.6 8.8V4.2L9 1.6z"
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <line x1="9" y1="5.6" x2="9" y2="10" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="12.4" r="0.95" fill={stroke} />
    </svg>
  );
}

function ReconciliationStatusPill({ canRun }: { canRun: boolean }) {
  const label = canRun ? "Reconciliation ON" : "Reconciliation OFF · review only";
  const fg = canRun ? H.ok : H.amber;
  const bg = canRun ? "rgba(95,122,82,0.10)" : "rgba(184,131,59,0.12)";
  return (
    <span
      title={
        canRun
          ? "Engine will run /validate-schedule against confirmed rows."
          : "Schedule under review — engine WILL NOT run; the card history is preserved for clinician review only."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        background: bg,
        border: `1px solid ${fg}`,
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: fg,
          boxShadow: canRun ? "none" : `0 0 0 3px rgba(184,131,59,0.18)`,
        }}
      />
      {label}
    </span>
  );
}

// ── Pipeline strip + safety summary ────────────────────────────────────────

function PipelineStrip() {
  const steps = [
    {
      eyebrow: "Step 1",
      title: "AI extracts",
      body: "Claude Opus 4.7 vision reads every row off the card, with per-cell confidence and plain-language reasoning when uncertain.",
    },
    {
      eyebrow: "Step 2",
      title: "Rules reconcile",
      body: "The WHO-DAK rules engine validates each confirmed dose against the destination schedule — minimum age, intervals, and series position.",
    },
    {
      eyebrow: "Step 3",
      title: "Clinicians confirm",
      body: "Every uncertain row routes to a clinician. Reject, skip, or edit — only confirmed rows reach reconciliation.",
    },
  ];
  return (
    <section
      aria-label="How Hathor reads your card"
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        padding: "18px 20px",
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: H.copperInk,
          marginBottom: 12,
        }}
      >
        How Hathor reads your card
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr auto 1fr",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        {steps.map((s, i) => (
          <Fragment key={s.title}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "4px 2px",
              }}
            >
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: H.faint,
                }}
              >
                {s.eyebrow}
              </div>
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 17,
                  lineHeight: 1.2,
                  letterSpacing: "-0.01em",
                  color: H.ink,
                }}
              >
                {s.title}
              </div>
              <p
                style={{
                  fontFamily: F.serif,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: H.mute,
                  margin: 0,
                }}
              >
                {s.body}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div
                aria-hidden
                style={{
                  alignSelf: "center",
                  fontFamily: F.serif,
                  color: H.copper,
                  fontSize: 22,
                  lineHeight: 1,
                  paddingTop: 18,
                }}
              >
                →
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function SafetySummaryCard() {
  const items: Array<{
    accent: "ok" | "amber" | "bad" | "copper";
    eyebrow: string;
    title: string;
    body: string;
  }> = [
    {
      accent: "ok",
      eyebrow: "Confirmed",
      title: "Enters reconciliation",
      body: "Vision rows above 0.85 confidence, plus anything the clinician confirms or edits, reach the WHO-DAK rules engine.",
    },
    {
      accent: "amber",
      eyebrow: "Amber",
      title: "Requires clinician review",
      body: "Rows below the trust threshold pause for review. Reconciliation cannot proceed until every amber row is acted on.",
    },
    {
      accent: "bad",
      eyebrow: "Rejected",
      title: "Never enters the engine",
      body: "Doses the clinician marks as definitively absent are routed to a separate channel with a required reason — never engine input.",
    },
    {
      accent: "copper",
      eyebrow: "Schedule readiness",
      title: "Unverified schedules produce no verdicts",
      body: "Hathor does not emit due/overdue verdicts against country schedules that have not been clinician-verified for this demo.",
    },
  ];
  return (
    <section
      aria-label="Safety invariants"
      style={{
        background: H.paper2,
        border: `1px solid ${H.rule}`,
        padding: "16px 18px 18px",
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: H.copperInk,
          }}
        >
          Safety invariants
        </div>
        <div
          style={{
            fontFamily: F.serif,
            fontStyle: "italic",
            fontSize: 12.5,
            color: H.meta,
          }}
        >
          Pinned by web/lib/trust-gate.ts — the same rules apply on the
          TypeScript and Python sides.
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {items.map((it) => (
          <SafetyItem key={it.title} {...it} />
        ))}
      </div>
    </section>
  );
}

function SafetyItem({
  accent,
  eyebrow,
  title,
  body,
}: {
  accent: "ok" | "amber" | "bad" | "copper";
  eyebrow: string;
  title: string;
  body: string;
}) {
  const color = accent === "ok"
    ? H.ok
    : accent === "amber"
      ? H.amber
      : accent === "bad"
        ? "#A3453B"
        : H.copperInk;
  const wash = accent === "ok"
    ? "rgba(95,122,82,0.06)"
    : accent === "amber"
      ? H.amberSoft
      : accent === "bad"
        ? "rgba(163,69,59,0.07)"
        : "rgba(204,120,92,0.06)";
  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        borderLeft: `3px solid ${color}`,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          alignSelf: "flex-start",
          padding: "2px 8px",
          background: wash,
          border: `1px solid ${color}`,
          fontFamily: F.mono,
          fontSize: 9.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 15,
          lineHeight: 1.25,
          color: H.ink,
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: H.mute,
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DemoPage() {
  // Intake state
  const [intake, setIntake] = useState<IntakeContext | null>(null);
  const [meta, setMeta] = useState<IntakeFormState>({
    childDob: "",
    sourceCountry: "NG",
    destinationCountry: "EG",
  });
  const [metaConfirmed, setMetaConfirmed] = useState(false);

  // Upload + redaction
  const [acceptedFile, setAcceptedFile] = useState<{
    name: string;
    previewUrl: string;
    file: File;
  } | null>(null);
  const [redacted, setRedacted] = useState<RedactionApplyPayload | null>(null);

  // Parse
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCardOutput | null>(null);
  const [rows, setRows] = useState<ParsedCardRow[]>([]);

  // Validate — phaseEReady gates the Reasoning Loop. Set true by user
  // clicking "Cross-check against WHO rules →" in ParsedResults. Reset
  // to false when rows change (edit lands user back in review until
  // they re-submit). Keeps the correction loop: review → edit →
  // re-validate single-click.
  const [phaseEReady, setPhaseEReady] = useState(false);
  const [validationResults, setValidationResults] = useState<
    ValidateScheduleResult[] | null
  >(null);

  // Computed phase from state
  const phase: Phase = useMemo(() => {
    if (!metaConfirmed) return "intake";
    if (!acceptedFile) return "upload";
    if (!redacted) return "redact";
    if (!parsed) return "parse";
    if (!validationResults) return "validate";
    return "export";
  }, [metaConfirmed, acceptedFile, redacted, parsed, validationResults]);

  // Wire intake completion — regex-extracted DOB flows into the form
  // so the physician doesn't retype it.
  const handleIntakeComplete = useCallback((ctx: IntakeContext) => {
    setIntake(ctx);
    if (ctx.childDob && /^\d{4}-\d{2}-\d{2}$/.test(ctx.childDob)) {
      setMeta((prev) => ({ ...prev, childDob: ctx.childDob! }));
    }
  }, []);

  const handleFileAccepted = useCallback((file: File, previewUrl: string) => {
    setAcceptedFile({ name: file.name, previewUrl, file });
    setRedacted(null);
    setParsed(null);
    setRows([]);
    setPhaseEReady(false);
    setValidationResults(null);
  }, []);

  const handleFileCleared = useCallback(() => {
    if (acceptedFile) URL.revokeObjectURL(acceptedFile.previewUrl);
    setAcceptedFile(null);
    setRedacted(null);
    setParsed(null);
    setRows([]);
    setPhaseEReady(false);
    setValidationResults(null);
  }, [acceptedFile]);

  // Any edit to rows invalidates prior validation — user needs to
  // re-submit. This is the core of the correction loop.
  const handleRowsChanged = useCallback((next: ParsedCardRow[]) => {
    setRows(next);
    setPhaseEReady(false);
    setValidationResults(null);
  }, []);

  const handleRedactionApplied = useCallback(
    (payload: RedactionApplyPayload) => {
      setRedacted(payload);
      // Auto-advance to parse.
      void runParse(payload);
      // (runParse defined below — captured via closure after declaration.)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.sourceCountry],
  );

  const runParse = useCallback(
    async (payload: RedactionApplyPayload) => {
      setParsing(true);
      setParseError(null);
      // A re-parse after the clinician has already cross-checked once
      // MUST reset the downstream validation state; otherwise the old
      // engine verdicts render against fresh (potentially different)
      // rows. phaseEReady gates ScheduleView, so we also toggle it off
      // — the clinician re-confirms Proceed after reviewing the new
      // extraction. No double-fire: ScheduleView does not mount until
      // phaseEReady flips back to true.
      setPhaseEReady(false);
      setValidationResults(null);
      try {
        const form = new FormData();
        form.append("file", payload.blob, "card.jpg");
        form.append("source_country", meta.sourceCountry);
        form.append(
          "card_language",
          meta.sourceCountry === "EG" ? "ar" : "en",
        );
        if (meta.childDob) form.append("child_dob", meta.childDob);

        const res = await fetch("/api/parse-card", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(
            (err && typeof err === "object" && "error" in err
              ? String((err as Record<string, unknown>).error)
              : `${res.status} ${res.statusText}`),
          );
        }
        const data = (await res.json()) as ParsedCardOutput;
        setParsed(data);
        setRows(data.rows);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Parse failed");
      } finally {
        setParsing(false);
      }
    },
    [meta.sourceCountry, meta.childDob],
  );

  // "Re-parse with current rules" — re-run the vision pass against the
  // same redacted payload without asking the clinician to re-upload.
  // The blob lives in `redacted` for the session. When it is gone (the
  // user cleared the upload), we surface that to the clinician rather
  // than silently doing nothing. ParsedResults owns the "warn before
  // overwriting corrections" confirm dialog.
  const handleReparse = useCallback(async () => {
    if (!redacted) {
      setParseError(
        "Original card file is no longer available. Please upload again.",
      );
      return;
    }
    await runParse(redacted);
  }, [redacted, runParse]);

  // Build validation payload from current (possibly clinician-edited) rows.
  const { records: validationRecords, indices: validationIndices } = useMemo(
    () => buildValidationRecords(rows, meta.childDob),
    [rows, meta.childDob],
  );

  // Stable signature for the active validation payload — used to
  // re-key ScheduleView so it remounts and re-auto-runs the engine
  // call when the clinician edits a row and re-submits.
  const rowsSignature = useMemo(
    () => computeRowsSignature(validationRecords, meta.childDob),
    [validationRecords, meta.childDob],
  );

  // Zip parsed rows with their engine verdicts into ReconciledDose[].
  const reconciled: ReconciledDose[] = useMemo(() => {
    if (!validationResults) return [];
    const out: ReconciledDose[] = [];
    for (let vi = 0; vi < validationResults.length; vi++) {
      const originalIndex = validationIndices[vi];
      const row = rows[originalIndex];
      const verdict = validationResults[vi];
      if (!row || !verdict) continue;
      out.push({
        parsed: row,
        verdict,
        isClinicalSafetyViolation: !verdict.valid,
        needsExtractionReview: row.confidence < 0.85,
      });
    }
    return out;
  }, [validationResults, validationIndices, rows]);

  return (
    <div style={{ background: H.paper, minHeight: "100vh", color: H.ink }}>
      {/* Header */}
      <header
        style={{
          padding: "28px 40px 18px",
          borderBottom: `1px solid ${H.rule}`,
          background: H.paper2,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: H.copperInk,
                }}
              >
                HATHOR · fast-path demo
              </div>
              <h1
                style={{
                  fontFamily: F.serif,
                  fontSize: 34,
                  fontWeight: 400,
                  letterSpacing: "-0.018em",
                  margin: "4px 0 0",
                  color: H.ink,
                }}
              >
                Reconcile a vaccination card
              </h1>
              <p
                style={{
                  fontFamily: F.serif,
                  fontSize: 14,
                  color: H.meta,
                  margin: "6px 0 0",
                  maxWidth: 620,
                  lineHeight: 1.55,
                }}
              >
                Standard apps trust their eyes. HATHOR double-checks every
                extracted date against the WHO-DAK rules engine before it
                reaches the child&apos;s record.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                textAlign: "right",
              }}
            >
              <Link href="/" style={{ color: H.meta, textDecoration: "none" }}>
                ← Home
              </Link>
              <Link
                href="/reconcile-card"
                style={{ color: H.copper, textDecoration: "none" }}
              >
                Full agent flow →
              </Link>
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <ProgressRail current={phase} />
          </div>
        </div>
      </header>

      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "32px 40px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── Pipeline overview — the safety story at a glance ── */}
        <PipelineStrip />

        {/* ── Phase A: Intake chat ── */}
        <ChatIntake onComplete={handleIntakeComplete} />

        {/* ── Phase A.1: Confirm metadata ── */}
        <IntakeMetaForm
          value={meta}
          onChange={setMeta}
          onConfirm={() => setMetaConfirmed(true)}
          disabled={metaConfirmed}
        />

        {/* ── Safety invariants — what can and cannot reach the engine ── */}
        <SafetySummaryCard />

        {/* ── Phase B: Upload + redact ── */}
        {metaConfirmed && (
          <CardDropzone
            onFileAccepted={handleFileAccepted}
            onClear={handleFileCleared}
            acceptedFile={
              acceptedFile
                ? { name: acceptedFile.name, previewUrl: acceptedFile.previewUrl }
                : null
            }
          />
        )}

        {metaConfirmed && acceptedFile && !redacted && (
          <RedactionCanvas
            imageUrl={acceptedFile.previewUrl}
            onApply={handleRedactionApplied}
          />
        )}

        {/* ── Phase D: Parse + review ── */}
        {parsing && <ParsingIndicator />}
        {parseError && <ParseErrorPanel message={parseError} />}
        {parsed && (
          <ParsedResults
            rows={rows}
            imageUrl={redacted?.dataUrl ?? null}
            onRowsChanged={handleRowsChanged}
            headerSlot={<ExplainerParsePlayer maxWidth={1040} autoPlay loop={false} />}
            onProceed={() => setPhaseEReady(true)}
            onReparse={redacted ? handleReparse : undefined}
            reparsing={parsing}
            documentIntelligence={parsed.documentIntelligence}
          />
        )}

        {/* ── Phase E: Validate ──
            Single render path. phaseEReady flips to true when the
            clinician clicks Proceed in ParsedResults. handleRowsChanged
            flips it back to false on any edit — the edit invalidates
            prior engine verdicts and sends the clinician back through
            the Reasoning Loop on the next Proceed. key={rowsSignature}
            forces ScheduleView to re-mount on row changes so its
            internal autoRun useEffect fires again cleanly.

            Country gate: needs_review destinations never reach the
            engine — Hathor cannot produce due/overdue verdicts against
            an unverified schedule. The card review still happened; the
            clinician sees the extracted history in ParsedResults above
            and the readiness banner below in place of ScheduleView. */}
        {parsed && phaseEReady && !canRunReconciliation(meta.destinationCountry) && (
          <NeedsReviewSchedulePanel
            destinationCode={meta.destinationCountry}
            confirmedRowCount={validationRecords.length}
          />
        )}
        {parsed && phaseEReady && canRunReconciliation(meta.destinationCountry) && validationRecords.length > 0 && (
          <ScheduleView
            key={rowsSignature}
            records={validationRecords}
            childDob={meta.childDob}
            autoRun
            onValidated={setValidationResults}
          />
        )}
        {parsed && phaseEReady && canRunReconciliation(meta.destinationCountry) && validationRecords.length === 0 && (
          <div
            role="status"
            style={{
              padding: "16px 20px",
              background: H.amberSoft,
              border: `1px solid ${H.amber}`,
              borderLeft: `3px solid ${H.amber}`,
              fontFamily: F.sans,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: H.amber,
              }}
            >
              Phase E · nothing to reconcile yet
            </div>
            <p
              style={{
                fontFamily: F.serif,
                fontSize: 13.5,
                color: H.amber,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              No engine-eligible rows reached the trust gate. Every row has
              either a null date, a null dose number, or an antigen outside
              the Phase-1 engine scope.
            </p>
            <p
              style={{
                fontFamily: F.serif,
                fontSize: 13,
                color: H.mute,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              Engine-covered antigens · BCG · HepB · OPV · IPV · DTP · Hib
              · PCV · Rotavirus · MMR. Fix a date or dose number above and
              click <em>Cross-check</em> again.
            </p>
          </div>
        )}

        {/* ── Phase F: Export ── */}
        {validationResults !== null && validationResults.length > 0 && (
          <ExportPanel
            doses={reconciled}
            childDob={meta.childDob}
            sourceCountry={meta.sourceCountry}
            destinationCountry={meta.destinationCountry}
            intake={intake ?? undefined}
          />
        )}

        {/* Footer notice */}
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            borderTop: `1px solid ${H.rule}`,
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.1em",
            color: H.faint,
            lineHeight: 1.6,
          }}
        >
          Phase 1.0 demo · synthetic cards only · not a signed clinical
          record · IMMZ-aligned, not IMMZ-conformant · WHO-DAK rules
          engine is the correctness source of truth
        </div>
      </main>
    </div>
  );
}
