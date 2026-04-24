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

import { useCallback, useMemo, useState } from "react";
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

import { COUNTRIES, SELECTABLE_COUNTRIES } from "@/lib/countries";
import type {
  CountryCode,
  IntakeContext,
  ParsedCardOutput,
  ParsedCardRow,
  ReconciledDose,
  ValidateScheduleRecord,
  ValidateScheduleResult,
} from "@/lib/types";

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

// Antigens the engine carries valid INTERVAL_RULES for today (PRD §8.2).
// Rows outside this set are SHOWN in parse + letter but NOT sent to
// /validate-schedule — the engine's fallback interval would mislead.
const ENGINE_COVERED_ANTIGENS = new Set([
  "BCG", "HepB", "OPV", "bOPV", "IPV", "DTP", "DTaP", "DPT",
  "Hib", "PCV", "Rotavirus", "MMR", "Measles",
]);

type Phase = "intake" | "upload" | "redact" | "parse" | "validate" | "export";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((da - db) / 86_400_000);
}

/** For each engine-eligible row, compute prior_dose_age_days against
 * the previous dose of the same antigen in chronological order. */
function buildValidationRecords(
  rows: ParsedCardRow[],
  childDob: string,
): { records: ValidateScheduleRecord[]; indices: number[] } {
  const eligibleIndices = rows
    .map((r, i) => ({ r, i }))
    .filter(
      (x) =>
        ENGINE_COVERED_ANTIGENS.has(x.r.antigen) &&
        x.r.date !== null &&
        x.r.date !== "" &&
        x.r.doseNumber !== null,
    );

  // Group by antigen, sort by date ascending.
  const byAntigen = new Map<string, { r: ParsedCardRow; i: number }[]>();
  for (const x of eligibleIndices) {
    const key = x.r.antigen;
    const list = byAntigen.get(key) ?? [];
    list.push(x);
    byAntigen.set(key, list);
  }
  for (const list of byAntigen.values()) {
    list.sort((a, b) => (a.r.date! < b.r.date! ? -1 : 1));
  }

  // Walk each group; compute prior_dose_age_days from the previous
  // same-antigen dose. Preserves original row indices for re-joining.
  const records: ValidateScheduleRecord[] = [];
  const indices: number[] = [];
  const priorByOriginalIndex = new Map<number, number | null>();
  for (const list of byAntigen.values()) {
    let priorAge: number | null = null;
    for (const { r, i } of list) {
      const age = daysBetween(r.date!, childDob);
      priorByOriginalIndex.set(i, priorAge);
      priorAge = age;
    }
  }

  for (const { r, i } of eligibleIndices) {
    records.push({
      antigen: r.antigen,
      date: r.date!,
      dose_number: r.doseNumber!,
      prior_dose_age_days: priorByOriginalIndex.get(i) ?? null,
    });
    indices.push(i);
  }

  return { records, indices };
}

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
            {SELECTABLE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
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
            {SELECTABLE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
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
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 13,
          color: H.faint,
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {COUNTRIES[value.sourceCountry].notes?.[0]}
      </p>
    </section>
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

  // Validate
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
    setValidationResults(null);
  }, []);

  const handleFileCleared = useCallback(() => {
    if (acceptedFile) URL.revokeObjectURL(acceptedFile.previewUrl);
    setAcceptedFile(null);
    setRedacted(null);
    setParsed(null);
    setRows([]);
    setValidationResults(null);
  }, [acceptedFile]);

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

  // Build validation payload from current (possibly clinician-edited) rows.
  const { records: validationRecords, indices: validationIndices } = useMemo(
    () => buildValidationRecords(rows, meta.childDob),
    [rows, meta.childDob],
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
        {/* ── Phase A: Intake chat ── */}
        <ChatIntake onComplete={handleIntakeComplete} />

        {/* ── Phase A.1: Confirm metadata ── */}
        <IntakeMetaForm
          value={meta}
          onChange={setMeta}
          onConfirm={() => setMetaConfirmed(true)}
          disabled={metaConfirmed}
        />

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
        {parsing && (
          <div
            style={{
              background: H.card,
              border: `1px solid ${H.rule}`,
              borderLeft: `3px solid ${H.copper}`,
              padding: "16px 20px",
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.12em",
              color: H.copperInk,
            }}
          >
            Parsing card…
          </div>
        )}
        {parseError && (
          <div
            role="alert"
            style={{
              padding: "12px 14px",
              background: H.amberSoft,
              border: `1px solid ${H.amber}`,
              fontFamily: F.mono,
              fontSize: 12,
              color: H.amber,
            }}
          >
            Parse failed: {parseError}
          </div>
        )}
        {parsed && (
          <ParsedResults
            rows={rows}
            imageUrl={redacted?.dataUrl ?? null}
            onRowsChanged={setRows}
            onProceed={() => {
              // No-op here — validation auto-runs via ScheduleView mount
              // below once rows are frozen by presence of validation box.
              // This callback only gates the amber-row check; when it
              // fires we render ScheduleView.
              setValidationResults([]);
              setValidationResults(null);
            }}
          />
        )}

        {/* ── Phase E: Validate ── */}
        {parsed && rows.length > 0 && validationResults === null && (
          <ScheduleView
            records={validationRecords}
            childDob={meta.childDob}
            autoRun={false}
            onValidated={setValidationResults}
          />
        )}
        {parsed && validationResults !== null && (
          <ScheduleView
            records={validationRecords}
            childDob={meta.childDob}
            autoRun
            onValidated={setValidationResults}
          />
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
