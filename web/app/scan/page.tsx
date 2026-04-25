"use client";

/**
 * /scan — minimal one-shot reconciliation flow.
 *
 *   picture in → live agent reasoning → next dose, missed doses,
 *   source-country rules, Egypt rules, key differences.
 *
 * Style: safe-triage's clean white-card-on-slate medical layout
 * (https://github.com/DrAhmed7887/safe-triage-project), with the
 * Pharos serif/copper accents from the rest of HATHOR. Single
 * column, max-w-3xl, no chat / no redaction step / no 6-phase rail.
 *
 * Data path:
 *   POST /api/parse-card?stream=1 — SSE; the route emits structured
 *   progress events so the agent's actual work shows up as a live
 *   trail. The vision call is unconditional on template recognition;
 *   Opus reads any vaccination card from any country.
 *
 *   GET /api/schedule/EG and /api/schedule/<source-or-WHO> are then
 *   diffed against the parsed rows by lib/schedule-diff.ts to
 *   produce next-dose / missed-doses cards. Source country is a
 *   free-text input — anything we don't have a seeded schedule for
 *   falls back to the WHO 6/10/14-week baseline for the comparison.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { parseSSEChunk } from "@/lib/sse-parser";
import {
  reconcile,
  formatScheduleAge,
  ageMonthsOn,
  type CountrySchedule,
  type ScheduleDose,
} from "@/lib/schedule-diff";
import { getScenario, type DemoScenario } from "@/lib/scenarios";
import type { ParsedCardOutput, ParsedCardRow } from "@/lib/types";

// ── Palette: safe-triage clinical + Pharos warmth ───────────────────────────

const C = {
  bg:        "#F7F9FB",
  card:      "#FFFFFF",
  rule:      "#E5E9EE",
  ruleSoft:  "#EEF1F4",
  ink:       "#0F172A",
  ink2:      "#1E293B",
  mute:      "#475569",
  faint:     "#94A3B8",
  // Safe-triage teal
  teal:      "#1A5F7A",
  tealMid:   "#159895",
  tealSoft:  "#57C5B6",
  tealWash:  "#E6F4F1",
  // Pharos copper (kept for serif accent / Hathor mark)
  copper:    "#CC785C",
  copperInk: "#9A5743",
  // Status
  ok:        "#15803D",
  okWash:    "#ECFDF5",
  amber:     "#B45309",
  amberWash: "#FFFBEB",
  bad:       "#B91C1C",
  badWash:   "#FEF2F2",
};

const F = {
  serif:  "Georgia, 'Times New Roman', serif",
  sans:   "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:   "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  arabic: "'SF Arabic', 'Geeza Pro', 'Noto Naskh Arabic', serif",
};

// ── Live progress event types (mirrors api/parse-card route) ─────────────────

type ProgressEvent =
  | { kind: "status"; label: string; detail?: string }
  | { kind: "vision_start"; bytes: number; mediaType: string }
  | { kind: "vision_done"; rows: number }
  | { kind: "template"; id: string }
  | { kind: "normalize_start"; labels: number; model: string }
  | { kind: "normalize_done"; mapped: number; ms: number }
  | { kind: "result"; body: ParsedCardOutput }
  | { kind: "error"; message: string };

interface TrailItem {
  id: string;
  label: string;
  detail?: string;
  state: "pending" | "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
}

// ── Source-country resolver ─────────────────────────────────────────────────
//
// The "Card from" field is free-text. The user types whatever country
// the child arrived from — Pakistan, Iraq, Yemen, anywhere. The typed
// string is sent verbatim to /api/parse-card as an advisory hint
// (the model ignores it when the card itself contradicts).
//
// For the schedule comparison view we need a country code to fetch a
// seeded schedule against. `resolveScheduleCode` maps the typed text
// to one of the seeded schedules when there's a clean match (ISO
// alpha-2 or English country name); everything else falls back to the
// WHO 6/10/14-week baseline. The source schedule is a comparison aid,
// not a gate — falling back to WHO never blocks reconciliation.

const SEEDED_SCHEDULE_CODES = new Set([
  "EG",
  "NG",
  "SD",
  "SY",
  "SS",
  "ER",
  "ET",
]);

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  egypt: "EG",
  nigeria: "NG",
  sudan: "SD",
  syria: "SY",
  "south sudan": "SS",
  eritrea: "ER",
  ethiopia: "ET",
};

function resolveScheduleCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "WHO";
  const upper = trimmed.toUpperCase();
  if (SEEDED_SCHEDULE_CODES.has(upper)) return upper;
  const lower = trimmed.toLowerCase();
  const byName = COUNTRY_NAME_TO_CODE[lower];
  if (byName) return byName;
  return "WHO";
}

// Suggested countries — the seeded schedules plus a handful of common
// migration source countries that fall back to WHO baseline. Surfaced
// via a <datalist> so the input still gives autocomplete UX without
// constraining the user to a closed set.
const SUGGESTED_COUNTRIES = [
  "Egypt",
  "Sudan",
  "Syria",
  "South Sudan",
  "Eritrea",
  "Ethiopia",
  "Nigeria",
  "Pakistan",
  "Afghanistan",
  "Iraq",
  "Yemen",
  "Somalia",
  "Libya",
  "Bangladesh",
  "Myanmar",
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScanPage() {
  // Patient context
  const [dob, setDob] = useState<string>("2024-06-15");
  const [sourceCountry, setSourceCountry] = useState<string>("Nigeria");
  const sourceScheduleCode = useMemo(
    () => resolveScheduleCode(sourceCountry),
    [sourceCountry],
  );

  // File
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Parse state
  const [running, setRunning] = useState(false);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [parsed, setParsed] = useState<ParsedCardOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  // Schedules
  const [destSchedule, setDestSchedule] = useState<CountrySchedule | null>(null);
  const [sourceSchedule, setSourceSchedule] = useState<CountrySchedule | null>(
    null,
  );

  // Scenario prefill (set when /scan is opened with ?scenario=<id>).
  const [activeScenario, setActiveScenario] = useState<DemoScenario | null>(
    null,
  );
  const autoStartedRef = useRef(false);

  const startedAtRef = useRef<number | null>(null);

  // Load schedules once whenever the resolved source-schedule code
  // changes. Free-text countries that don't match a seeded schedule
  // fetch the WHO baseline so the comparison view always renders.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [eg, src] = await Promise.all([
          fetch("/api/schedule/EG").then((r) => r.json()),
          fetch(`/api/schedule/${sourceScheduleCode}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setDestSchedule(eg as CountrySchedule);
        setSourceSchedule(src as CountrySchedule);
      } catch (err) {
        if (!cancelled) {
          setError(
            `Could not load schedule data: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceScheduleCode]);

  // Revoke object URL on swap.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Read ?scenario=<id> on mount: prefill DOB + source country and fetch the
  // demo card image as a File so it goes through the same code path as a
  // user upload. Auto-start happens in the next effect once schedules load.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("scenario");
    const sc = getScenario(id);
    if (!sc) return;
    setActiveScenario(sc);
    setSourceCountry(sc.sourceCountry);
    setDob(sc.dob);
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(sc.cardImageUrl);
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const blob = await r.blob();
        if (cancelled) return;
        const filename = sc.cardImageUrl.split("/").pop() ?? "card.jpg";
        const f = new File([blob], filename, {
          type: blob.type || "image/jpeg",
        });
        onFile(f);
      } catch (err) {
        if (!cancelled) {
          setError(
            `Could not load demo scenario: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: scenario id is taken from the URL once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = useCallback(
    (f: File) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      setParsed(null);
      setError(null);
      setTrail([]);
      setElapsedMs(null);
    },
    [previewUrl],
  );

  const start = useCallback(async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    setParsed(null);
    setElapsedMs(null);
    startedAtRef.current = Date.now();

    const startStep = (id: string, label: string, detail?: string) => {
      setTrail((prev) => {
        const closed: TrailItem[] = prev.map((p) =>
          p.state === "running"
            ? { ...p, state: "done" as const, finishedAt: Date.now() }
            : p,
        );
        const next: TrailItem = {
          id,
          label,
          detail,
          state: "running",
          startedAt: Date.now(),
        };
        return [...closed, next];
      });
    };
    const updateStep = (id: string, detail: string) => {
      setTrail((prev) =>
        prev.map((p) => (p.id === id ? { ...p, detail } : p)),
      );
    };
    const finishAll = () =>
      setTrail((prev) =>
        prev.map((p) =>
          p.state === "running"
            ? { ...p, state: "done", finishedAt: Date.now() }
            : p,
        ),
      );

    startStep("upload", "Uploading card", `${(file.size / 1024).toFixed(0)} KB`);

    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("source_country", sourceCountry);
      if (dob) form.append("child_dob", dob);

      const res = await fetch(`/api/parse-card?stream=1`, {
        method: "POST",
        body: form,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSSEChunk(buf);
        buf = remainder;

        for (const ev of events) {
          const data = ev.data as ProgressEvent;
          if (data.kind === "vision_start") {
            startStep(
              "vision",
              "Reading the card with Claude vision",
              `Opus 4.7 · whole-image pass`,
            );
          } else if (data.kind === "vision_done") {
            updateStep(
              "vision",
              `${data.rows} row${data.rows === 1 ? "" : "s"} extracted`,
            );
          } else if (data.kind === "template") {
            const friendly = templateLabel(data.id);
            startStep("template", "Card layout", friendly);
          } else if (data.kind === "status") {
            startStep(`status-${ev.type}`, data.label, data.detail);
          } else if (data.kind === "result") {
            const n = data.body.rows.length;
            startStep(
              "done",
              `Reconciling ${n} dose${n === 1 ? "" : "s"} against the destination schedule`,
            );
            setParsed(data.body);
          } else if (data.kind === "error") {
            setError(data.message);
            setTrail((prev) =>
              prev.map((p) =>
                p.state === "running"
                  ? {
                      ...p,
                      state: "error",
                      finishedAt: Date.now(),
                      detail: data.message,
                    }
                  : p,
              ),
            );
          }
        }
      }
      finishAll();
      if (startedAtRef.current) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
    }
  }, [file, sourceCountry, dob]);

  // Auto-start once a scenario has been prefilled and schedules are ready.
  // The ref guard means a manual re-run from a scenario URL still works
  // (clicking "Read & reconcile" after the auto-run completes).
  useEffect(() => {
    if (!activeScenario || autoStartedRef.current) return;
    if (!file || running || !destSchedule || !sourceSchedule) return;
    autoStartedRef.current = true;
    void start();
  }, [activeScenario, file, running, destSchedule, sourceSchedule, start]);

  // Reconciliation
  const reconciliation = useMemo(() => {
    if (!parsed || !destSchedule || !dob) return null;
    return reconcile(parsed.rows, destSchedule, dob);
  }, [parsed, destSchedule, dob]);

  const ageMonths = useMemo(() => {
    if (!dob) return 0;
    return ageMonthsOn(dob, new Date());
  }, [dob]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.ink,
        fontFamily: F.sans,
      }}
    >
      <header
        style={{
          background: C.card,
          borderBottom: `1px solid ${C.rule}`,
          padding: "20px 24px",
        }}
      >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <Link
            href="/"
            style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}
          >
            <HathorMark />
            <div>
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 22,
                  letterSpacing: "-0.01em",
                  color: C.ink,
                  lineHeight: 1,
                }}
              >
                Hathor
              </div>
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: C.mute,
                  marginTop: 4,
                }}
              >
                Vaccine card reconciliation
              </div>
            </div>
          </Link>
          <nav style={{ display: "flex", gap: 18, fontSize: 13 }}>
            <Link href="/demo" style={{ color: C.mute, textDecoration: "none" }}>
              Full demo
            </Link>
            <Link href="/" style={{ color: C.mute, textDecoration: "none" }}>
              Home
            </Link>
          </nav>
        </div>
      </header>

      <main
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "32px 24px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Demo-scenario banner (only when /scan?scenario=… prefilled state) */}
        {activeScenario && (
          <div
            style={{
              background: C.tealWash,
              border: `1px solid ${C.tealSoft}`,
              borderLeft: `3px solid ${C.teal}`,
              padding: "10px 14px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontFamily: F.mono,
              fontSize: 11.5,
              letterSpacing: "0.08em",
              color: C.teal,
            }}
          >
            <span style={{ textTransform: "uppercase", letterSpacing: "0.14em" }}>
              Demo case · {activeScenario.patient} · {activeScenario.routePill}
            </span>
            <Link
              href="/"
              style={{
                color: C.teal,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Pick a different case
            </Link>
          </div>
        )}

        {/* Headline */}
        <div>
          <h1
            style={{
              fontFamily: F.serif,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              fontSize: 32,
              color: C.ink,
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {activeScenario
              ? "Reading the card, live."
              : "Upload a vaccination card."}
          </h1>
          <p
            style={{
              fontFamily: F.serif,
              fontSize: 16,
              color: C.mute,
              margin: "8px 0 0",
              lineHeight: 1.55,
            }}
          >
            Hathor reads the card, finds the next dose due, lists what was
            missed, and shows the source country and Egypt rules side by side.
          </p>
        </div>

        {/* Patient + upload card */}
        <Card accent="teal">
          <SectionHeader title="Patient" eyebrow="Step 1" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Field label="Date of birth">
              <input
                type="date"
                value={dob}
                disabled={running}
                onChange={(e) => setDob(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Card from">
              <input
                list="hathor-source-countries"
                value={sourceCountry}
                disabled={running}
                placeholder="e.g. Pakistan, Iraq, Yemen…"
                onChange={(e) => setSourceCountry(e.target.value)}
                style={inputStyle}
              />
              <datalist id="hathor-source-countries">
                {SUGGESTED_COUNTRIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Reconciling against">
              <input
                value="Egypt · MoHP EPI"
                disabled
                style={{ ...inputStyle, color: C.mute, background: C.ruleSoft }}
              />
            </Field>
          </div>

          <SectionHeader title="Vaccination card" eyebrow="Step 2" />
          <Dropzone file={file} previewUrl={previewUrl} onFile={onFile} disabled={running} />

          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={start}
              disabled={!file || !dob || running}
              style={primaryButton(!file || !dob || running)}
            >
              {running ? "Reading card…" : "Read & reconcile →"}
            </button>
          </div>
        </Card>

        {/* Live thinking panel */}
        {(running || trail.length > 0) && (
          <Card accent="teal">
            <SectionHeader
              title="What Hathor is doing"
              eyebrow={running ? "Live" : elapsedMs ? `Done in ${(elapsedMs / 1000).toFixed(1)}s` : "Trace"}
              tone={running ? "running" : "ok"}
            />
            <ThinkingTrail items={trail} />
            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  background: C.badWash,
                  border: `1px solid ${C.bad}`,
                  borderLeft: `3px solid ${C.bad}`,
                  color: C.bad,
                  fontFamily: F.mono,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </Card>
        )}

        {/* Doses extracted */}
        {parsed && parsed.rows.length > 0 && (
          <Card accent="teal">
            <SectionHeader
              title="Doses read from the card"
              eyebrow={`${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}`}
            />
            <DoseTable
              rows={parsed.rows}
              onEdit={(rowId, patch) => {
                setParsed((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    rows: prev.rows.map((r) =>
                      (r.row_id ?? "") === rowId
                        ? {
                            ...r,
                            ...patch,
                            // Clinician-edited: full confidence + the
                            // "edited" action so the trust gate accepts
                            // the row and the audit log records the
                            // override.
                            confidence: 1,
                            clinician_action: "edited",
                            clinician_action_at: new Date().toISOString(),
                          }
                        : r,
                    ),
                  };
                });
              }}
            />
          </Card>
        )}

        {/* Next dose + missed */}
        {reconciliation && (
          <>
            <NextDoseCard
              next={reconciliation.next}
              ageMonths={ageMonths}
            />
            <MissedDosesCard
              missed={reconciliation.missed}
              recommendedMissing={reconciliation.recommendedMissing}
            />
          </>
        )}

        {/* Country rules — source + Egypt */}
        {sourceSchedule && destSchedule && parsed && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <CountryRulesCard
              schedule={sourceSchedule}
              eyebrow="Card origin"
              accent="copper"
            />
            <CountryRulesCard
              schedule={destSchedule}
              eyebrow="Destination"
              accent="teal"
            />
          </div>
        )}

        {/* Differences (only when source ≠ destination and we have them) */}
        {sourceSchedule &&
          parsed &&
          sourceSchedule.country_code !== destSchedule?.country_code &&
          (sourceSchedule.key_differences_vs_egypt ?? []).length > 0 && (
            <DifferencesCard
              differences={sourceSchedule.key_differences_vs_egypt!}
              sourceName={sourceSchedule.country}
              sourceOnlyAntigens={reconciliation?.sourceOnlyAntigens ?? []}
            />
          )}

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            padding: "12px 14px",
            borderTop: `1px solid ${C.rule}`,
            fontFamily: F.mono,
            fontSize: 11,
            color: C.faint,
            letterSpacing: "0.06em",
            lineHeight: 1.6,
          }}
        >
          Decision support only — not a prescription. Reconciliation is a
          preliminary diff against the published EPI schedule; a clinician
          must confirm before the child receives any dose.
        </div>
      </main>
    </div>
  );
}

// ── UI primitives ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: `1px solid ${C.rule}`,
  borderRadius: 6,
  background: C.card,
  fontFamily: F.sans,
  fontSize: 14,
  color: C.ink,
  outline: "none",
};

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? C.faint : C.teal,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "10px 18px",
    fontFamily: F.sans,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.02em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.15s ease",
  };
}

function HathorMark() {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: C.tealWash,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
      }}
    >
      <span
        style={{
          fontFamily: F.arabic,
          fontSize: 13,
          color: C.teal,
          lineHeight: 1,
        }}
      >
        حتحور
      </span>
      <span
        style={{
          width: 14,
          height: 1,
          background: C.copper,
        }}
      />
    </div>
  );
}

function Card({
  children,
  accent = "teal",
}: {
  children: React.ReactNode;
  accent?: "teal" | "copper" | "amber" | "neutral";
}) {
  const accentColor =
    accent === "teal"
      ? C.teal
      : accent === "copper"
        ? C.copper
        : accent === "amber"
          ? C.amber
          : C.faint;
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.rule}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 8,
        padding: "20px 22px",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  eyebrow,
  tone = "neutral",
}: {
  title: string;
  eyebrow?: string;
  tone?: "neutral" | "ok" | "running" | "warn";
}) {
  const eyeColor =
    tone === "ok"
      ? C.ok
      : tone === "warn"
        ? C.amber
        : tone === "running"
          ? C.teal
          : C.mute;
  return (
    <div style={{ marginBottom: 14 }}>
      {eyebrow && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: F.mono,
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: eyeColor,
          }}
        >
          {tone === "running" && <PulseDot />}
          {eyebrow}
        </div>
      )}
      <h2
        style={{
          fontFamily: F.serif,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          fontSize: 19,
          color: C.ink,
          margin: "4px 0 0",
        }}
      >
        {title}
      </h2>
    </div>
  );
}

function PulseDot() {
  return (
    <>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: C.teal,
          animation: "hathor-pulse 1.4s ease-in-out infinite",
        }}
      />
      <style>
        {`@keyframes hathor-pulse { 0%,100% {opacity: 0.35} 50% {opacity: 1} }`}
      </style>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.mute,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Dropzone ─────────────────────────────────────────────────────────────────

function Dropzone({
  file,
  previewUrl,
  onFile,
  disabled,
}: {
  file: File | null;
  previewUrl: string | null;
  onFile: (f: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return;
    onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        handle(e.dataTransfer.files[0]);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${over ? C.teal : C.rule}`,
        borderRadius: 8,
        padding: previewUrl ? 14 : 32,
        background: over ? C.tealWash : C.bg,
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s ease",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => handle(e.target.files?.[0])}
        style={{ display: "none" }}
      />
      {previewUrl ? (
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Card preview"
            style={{
              width: 120,
              height: 84,
              objectFit: "cover",
              borderRadius: 6,
              border: `1px solid ${C.rule}`,
            }}
          />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, color: C.ink }}>{file?.name}</div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: C.mute,
                marginTop: 4,
              }}
            >
              {file ? `${(file.size / 1024).toFixed(0)} KB · ${file.type}` : ""}
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: C.teal,
                marginTop: 6,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Click or drop a different image to replace
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily: F.serif, fontSize: 17, color: C.ink, marginBottom: 4 }}>
            Drop a vaccination card here, or click to choose one
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, letterSpacing: "0.05em" }}>
            JPG · PNG · WEBP · up to 5 MB
          </div>
        </>
      )}
    </div>
  );
}

// ── Live thinking trail ──────────────────────────────────────────────────────

function ThinkingTrail({ items }: { items: TrailItem[] }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 14,
          fontStyle: "italic",
          color: C.mute,
          padding: "8px 0",
        }}
      >
        Waiting to start…
      </div>
    );
  }
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((it, i) => {
        const dur =
          it.finishedAt && it.startedAt
            ? `${((it.finishedAt - it.startedAt) / 1000).toFixed(1)}s`
            : it.state === "running"
              ? "…"
              : "";
        const marker =
          it.state === "done"
            ? { bg: C.ok, fg: "#fff", char: "✓" }
            : it.state === "error"
              ? { bg: C.bad, fg: "#fff", char: "!" }
              : it.state === "running"
                ? { bg: C.teal, fg: "#fff", char: "•" }
                : { bg: C.faint, fg: "#fff", char: "·" };
        return (
          <li
            key={`${it.id}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "22px 1fr auto",
              gap: 10,
              alignItems: "flex-start",
              padding: "8px 0",
              borderBottom:
                i < items.length - 1 ? `1px solid ${C.ruleSoft}` : "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: marker.bg,
                color: marker.fg,
                fontSize: 10,
                fontFamily: F.mono,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 2,
                animation:
                  it.state === "running"
                    ? "hathor-pulse 1.4s ease-in-out infinite"
                    : "none",
              }}
            >
              {marker.char}
            </span>
            <div>
              <div style={{ fontSize: 14, color: C.ink }}>{it.label}</div>
              {it.detail && (
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 11.5,
                    color: C.mute,
                    marginTop: 3,
                  }}
                >
                  {it.detail}
                </div>
              )}
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: C.faint,
                paddingTop: 3,
                whiteSpace: "nowrap",
              }}
            >
              {dur}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Doses table (inline-editable, clinician-in-the-loop) ────────────────────

type RowPatch = Partial<Pick<ParsedCardRow, "date" | "antigen">>;

function DoseTable({
  rows,
  onEdit,
}: {
  rows: ParsedCardRow[];
  onEdit: (rowId: string, patch: RowPatch) => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Date", "Antigen", "Dose", "Confidence", ""].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: C.mute,
                  borderBottom: `1px solid ${C.rule}`,
                  fontWeight: 500,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <DoseRow key={r.row_id ?? i} row={r} onEdit={onEdit} />
          ))}
        </tbody>
      </table>
      <p
        style={{
          marginTop: 10,
          fontSize: 11.5,
          color: C.mute,
          fontStyle: "italic",
        }}
      >
        Click any date or antigen to correct it. Edits are clinician-confirmed
        and re-run reconciliation immediately.
      </p>
    </div>
  );
}

function DoseRow({
  row,
  onEdit,
}: {
  row: ParsedCardRow;
  onEdit: (rowId: string, patch: RowPatch) => void;
}) {
  const rowId = row.row_id ?? "";
  const amber = row.confidence < 0.85;
  const edited = row.clinician_action === "edited";
  return (
    <tr>
      <td style={tdStyle}>
        <EditableCell
          kind="date"
          value={row.date}
          disabled={!rowId}
          onCommit={(next) => onEdit(rowId, { date: next })}
        />
      </td>
      <td style={{ ...tdStyle, fontWeight: 500 }}>
        <EditableCell
          kind="text"
          value={row.antigen}
          disabled={!rowId}
          onCommit={(next) => onEdit(rowId, { antigen: next ?? "" })}
        />
      </td>
      <td style={tdStyle}>
        {row.doseNumber ?? (row.doseKind === "booster" ? "Booster" : "—")}
      </td>
      <td style={tdStyle}>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            background: amber && !edited ? C.amberWash : C.okWash,
            color: amber && !edited ? C.amber : C.ok,
            border: `1px solid ${amber && !edited ? C.amber : C.ok}`,
          }}
        >
          {Math.round(row.confidence * 100)}%
        </span>
      </td>
      <td style={{ ...tdStyle, color: C.faint, fontFamily: F.mono, fontSize: 10.5 }}>
        {edited ? "edited" : ""}
      </td>
    </tr>
  );
}

function EditableCell({
  kind,
  value,
  disabled,
  onCommit,
}: {
  kind: "date" | "text";
  value: string | null;
  disabled?: boolean;
  onCommit: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? "");

  // Keep the draft in sync if the parent value changes externally
  // (e.g. a re-parse) and we're not currently editing.
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  if (editing && !disabled) {
    return (
      <input
        autoFocus
        type={kind === "date" ? "date" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = draft.trim();
          const nextValue = kind === "date" ? (next || null) : next;
          if ((nextValue ?? "") !== (value ?? "")) {
            onCommit(nextValue);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        style={{
          font: "inherit",
          fontFamily: F.mono,
          fontSize: 12.5,
          padding: "2px 4px",
          border: `1px solid ${C.teal}`,
          borderRadius: 3,
          outline: "none",
          width: kind === "date" ? 130 : 110,
          background: "white",
        }}
      />
    );
  }

  const display = value ?? "—";
  return (
    <span
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      style={{
        cursor: disabled ? "default" : "pointer",
        borderBottom: disabled ? "none" : `1px dashed ${C.rule}`,
        padding: "1px 2px",
      }}
      title={disabled ? "" : "Click to edit"}
    >
      {display}
    </span>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: `1px solid ${C.ruleSoft}`,
  color: C.ink2,
  fontFamily: F.mono,
  fontSize: 12.5,
};

// ── Next-dose card ───────────────────────────────────────────────────────────

function NextDoseCard({
  next,
  ageMonths,
}: {
  next: ScheduleDose | null;
  ageMonths: number;
}) {
  if (!next) {
    return (
      <Card accent="teal">
        <SectionHeader
          title="No upcoming compulsory dose under Egyptian EPI"
          eyebrow="Next dose"
          tone="ok"
        />
        <p
          style={{
            fontFamily: F.serif,
            fontSize: 14.5,
            color: C.mute,
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Every compulsory dose recommended for this child&apos;s age has been
          read off the card. The school-age boosters (DT at 4–6 years) are not
          yet due.
        </p>
      </Card>
    );
  }
  const recAge = next.recommended_age_months ?? 0;
  const monthsUntil = Math.max(0, recAge - ageMonths);
  return (
    <Card accent="teal">
      <SectionHeader title="Next dose due" eyebrow="Recommended next" tone="running" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          marginBottom: 12,
        }}
      >
        <Stat
          label="Antigen"
          value={next.antigen}
          accent="teal"
        />
        <Stat
          label="Dose number"
          value={String(next.dose_number)}
        />
        <Stat
          label="Recommended at"
          value={formatScheduleAge(next)}
        />
      </div>
      <p
        style={{
          fontFamily: F.serif,
          fontSize: 14,
          color: C.ink2,
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {monthsUntil < 0.5
          ? "Due now."
          : `Due in about ${Math.round(monthsUntil)} month${
              Math.round(monthsUntil) === 1 ? "" : "s"
            }.`}
        {next.notes ? ` ${next.notes}` : ""}
      </p>
    </Card>
  );
}

// ── Missed doses card ────────────────────────────────────────────────────────

function MissedDosesCard({
  missed,
  recommendedMissing,
}: {
  missed: ScheduleDose[];
  recommendedMissing: ScheduleDose[];
}) {
  if (missed.length === 0 && recommendedMissing.length === 0) {
    return (
      <Card accent="teal">
        <SectionHeader title="Nothing missed" eyebrow="Reconciliation" tone="ok" />
        <p
          style={{
            fontFamily: F.serif,
            fontSize: 14.5,
            color: C.mute,
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Every compulsory Egyptian EPI dose recommended for this age is
          present on the card.
        </p>
      </Card>
    );
  }
  return (
    <Card accent={missed.length > 0 ? "amber" : "teal"}>
      <SectionHeader
        title={
          missed.length > 0
            ? `${missed.length} compulsory dose${missed.length === 1 ? "" : "s"} missing`
            : "Recommended doses missing"
        }
        eyebrow="Gaps vs Egypt EPI"
        tone={missed.length > 0 ? "warn" : "neutral"}
      />
      {missed.length > 0 && (
        <ul style={listStyle}>
          {missed.map((d, i) => (
            <li key={`${d.antigen}-${d.dose_number}-${i}`} style={listItemStyle}>
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 11,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: C.amberWash,
                  border: `1px solid ${C.amber}`,
                  color: C.amber,
                  marginRight: 10,
                  whiteSpace: "nowrap",
                }}
              >
                Compulsory
              </span>
              <span style={{ fontWeight: 500 }}>{d.antigen}</span>
              <span style={{ color: C.mute }}> · dose {d.dose_number}</span>
              <span style={{ color: C.faint, marginLeft: 8, fontFamily: F.mono, fontSize: 11.5 }}>
                recommended at {formatScheduleAge(d)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recommendedMissing.length > 0 && (
        <>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.mute,
              marginTop: missed.length > 0 ? 16 : 0,
              marginBottom: 6,
            }}
          >
            Recommended (private uptake)
          </div>
          <ul style={listStyle}>
            {recommendedMissing.map((d, i) => (
              <li key={`r-${d.antigen}-${d.dose_number}-${i}`} style={listItemStyle}>
                <span style={{ fontWeight: 500 }}>{d.antigen}</span>
                <span style={{ color: C.mute }}> · dose {d.dose_number}</span>
                <span
                  style={{
                    color: C.faint,
                    marginLeft: 8,
                    fontFamily: F.mono,
                    fontSize: 11.5,
                  }}
                >
                  at {formatScheduleAge(d)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ── Country rules card ───────────────────────────────────────────────────────

function CountryRulesCard({
  schedule,
  eyebrow,
  accent,
}: {
  schedule: CountrySchedule;
  eyebrow: string;
  accent: "teal" | "copper";
}) {
  const items = (schedule.key_features ?? []).slice(0, 6);
  return (
    <Card accent={accent}>
      <SectionHeader title={schedule.country} eyebrow={eyebrow} />
      {items.length > 0 ? (
        <ul style={listStyle}>
          {items.map((f, i) => (
            <li key={i} style={{ ...listItemStyle, fontFamily: F.serif, fontSize: 13.5 }}>
              {f}
            </li>
          ))}
        </ul>
      ) : (
        <p
          style={{
            fontFamily: F.serif,
            fontSize: 13.5,
            color: C.mute,
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          No country-specific notes are bundled with this schedule.
        </p>
      )}
      {schedule.source_urls && schedule.source_urls.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: `1px solid ${C.ruleSoft}`,
            fontFamily: F.mono,
            fontSize: 10.5,
            color: C.faint,
            letterSpacing: "0.06em",
            lineHeight: 1.5,
          }}
        >
          Source: {schedule.source}
        </div>
      )}
    </Card>
  );
}

// ── Differences card ─────────────────────────────────────────────────────────

function DifferencesCard({
  differences,
  sourceName,
  sourceOnlyAntigens,
}: {
  differences: string[];
  sourceName: string;
  sourceOnlyAntigens: string[];
}) {
  return (
    <Card accent="copper">
      <SectionHeader
        title={`What is different between ${sourceName} and Egypt`}
        eyebrow="Side-by-side"
      />
      <ul style={listStyle}>
        {differences.slice(0, 8).map((d, i) => (
          <li key={i} style={{ ...listItemStyle, fontFamily: F.serif, fontSize: 13.5 }}>
            {d}
          </li>
        ))}
      </ul>
      {sourceOnlyAntigens.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.copperInk,
              marginBottom: 6,
            }}
          >
            On the {sourceName} card · not on Egypt&apos;s schedule
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sourceOnlyAntigens.map((a) => (
              <span
                key={a}
                style={{
                  fontFamily: F.mono,
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "#FBF6EC",
                  border: `1px solid ${C.copper}`,
                  color: C.copperInk,
                  borderRadius: 4,
                }}
              >
                {a}
              </span>
            ))}
          </div>
          <p
            style={{
              fontFamily: F.serif,
              fontSize: 12.5,
              fontStyle: "italic",
              color: C.mute,
              margin: "10px 0 0",
              lineHeight: 1.55,
            }}
          >
            Preserve these on the record — Egypt does not require them, but they
            should not be flagged as missing either.
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "teal" | "amber";
}) {
  const valueColor = accent === "teal" ? C.teal : accent === "amber" ? C.amber : C.ink;
  return (
    <div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.mute,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.serif,
          fontSize: 22,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: valueColor,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const listItemStyle: React.CSSProperties = {
  paddingLeft: 14,
  position: "relative",
  color: C.ink2,
  lineHeight: 1.55,
};

function templateLabel(id: string): string {
  switch (id) {
    case "egypt_mohp_mandatory_childhood_immunization":
      return "Egyptian MoHP mandatory childhood immunization card";
    case "who_icvp_international_certificate":
      return "WHO/IHR International Certificate of Vaccination";
    case "unknown_vaccine_card":
      return "Unknown layout — will use whole-image read";
    default:
      return id;
  }
}
