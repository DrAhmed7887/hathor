"use client";

/**
 * PRD §5.6 Reasoning Safety Loop — fast-path output gate.
 *
 * Takes the reconciled rows from ParsedResults, POSTs them to the
 * FastAPI wrapper at /validate-schedule (d2cccc7), and renders the
 * engine's native per-record output with the two PRD severity
 * channels cleanly separated:
 *
 *   - AMBER: nothing here — this component sits downstream of the
 *     Vision Safety Loop. Any remaining extraction uncertainty has
 *     been resolved in ParsedResults before the user got here.
 *   - RED:   clinical-safety violations per PRD §6 point 3. Rows
 *     where verdict.valid === false — "this interval would harm a
 *     child." The engine's `reasons` strings are rendered verbatim
 *     because they already carry the authoritative rule source
 *     ("ACIP general minimum", "WHO position paper").
 *
 * AUDIT DECISION (per the revised plan's "audit first" rule):
 *   RecommendationCard does NOT fit. That component is wired to the
 *   agent-SSE Phase-E path — it expects rich Recommendation +
 *   ValidationResult with rule_id / rule_slug / rule_rationale /
 *   override_justification_codes, and posts overrides to a session
 *   endpoint. /validate-schedule returns a simpler per-record shape
 *   with no override machinery. Forcing the two into one component
 *   would collide two semantic models (rules-engine verdict vs.
 *   recommendation-with-override). RecommendationCard stays on the
 *   agent-SSE path; this view is new.
 *
 * Progress visibility (PRD §6 point 6) — skeleton states advance
 * through "Cross-checking against WHO rules…" → "Computing…" →
 * "Done" — no dead spinner.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ValidateScheduleRecord,
  ValidateScheduleRequest,
  ValidateScheduleResult,
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
  okSoft:    "#E8EEE1",
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
  bad:       "#A3453B",
  badSoft:   "#F3E3DF",
  badBorder: "#D4837A",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const ENGINE_URL =
  process.env.NEXT_PUBLIC_HATHOR_ENGINE_URL ?? "http://localhost:8000";

type Status = "idle" | "loading" | "done" | "error";

export interface ScheduleViewProps {
  /** Reconciled rows ready to validate. Parent builds these from
   * ParsedResults output — any null dates / missing dose numbers
   * have been resolved (the /validate-schedule endpoint will 422
   * on malformed payloads, and that defeats the point of gating). */
  records: ValidateScheduleRecord[];
  childDob: string;
  /** If true, POSTs on mount. If false, renders a "Run validation"
   * button so the composing page controls when the call fires. */
  autoRun?: boolean;
  /** Called once the engine returns — lets the parent drive onward
   * flow (e.g., enable the Export step). */
  onValidated?: (results: ValidateScheduleResult[]) => void;
}

export function ScheduleView({
  records,
  childDob,
  autoRun = true,
  onValidated,
}: ScheduleViewProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ValidateScheduleResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);

  const runValidation = useCallback(async () => {
    if (records.length === 0) {
      setError("No records to validate.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    setResults([]);
    setProgressStep(0);

    // Progress-visibility ticker. Engine runs in milliseconds locally;
    // the ticker gives the clinician a visible cadence rather than a
    // blank screen. Stops when the fetch resolves.
    const ticker = setInterval(() => {
      setProgressStep((s) => Math.min(s + 1, 2));
    }, 450);

    const body: ValidateScheduleRequest = {
      child_dob: childDob,
      records,
    };

    try {
      const res = await fetch(`${ENGINE_URL}/validate-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      clearInterval(ticker);

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(
          detail && typeof detail === "object" && "detail" in detail
            ? String((detail as Record<string, unknown>).detail)
            : `${res.status} ${res.statusText}`,
        );
      }

      const data = (await res.json()) as ValidateScheduleResult[];
      setResults(data);
      setStatus("done");
      onValidated?.(data);
    } catch (err) {
      clearInterval(ticker);
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [records, childDob, onValidated]);

  useEffect(() => {
    if (autoRun && status === "idle") {
      void runValidation();
    }
  }, [autoRun, status, runValidation]);

  const counts = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    for (const r of results) {
      if (r.valid) valid++;
      else invalid++;
    }
    return { valid, invalid };
  }, [results]);

  return (
    <section
      style={{
        background: H.paper,
        border: `1px solid ${H.rule}`,
        fontFamily: F.sans,
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${H.rule}`,
          background: H.paper2,
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
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: H.copperInk,
            }}
          >
            Phase E · rules engine verdicts
          </div>
          <h2
            style={{
              fontFamily: F.serif,
              fontSize: 22,
              fontWeight: 400,
              color: H.ink,
              margin: "4px 0 0",
              letterSpacing: "-0.01em",
            }}
          >
            {status === "done"
              ? `${results.length} dose${results.length === 1 ? "" : "s"} cross-checked`
              : "Cross-checking against WHO rules"}
          </h2>
        </div>
        {status === "done" && (
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.08em",
              color: counts.invalid > 0 ? H.bad : H.ok,
            }}
          >
            {counts.invalid === 0
              ? `All ${counts.valid} doses valid`
              : `${counts.invalid} interval violation${counts.invalid === 1 ? "" : "s"} · ${counts.valid} valid`}
          </div>
        )}
      </header>

      {/* Loading skeleton — progress steps advance (PRD §6 point 6) */}
      {status === "loading" && <LoadingSkeleton step={progressStep} />}

      {/* Error state — AMBER (user/network surface, not clinical) */}
      {status === "error" && (
        <div style={{ padding: "16px 20px" }}>
          <div
            role="alert"
            style={{
              padding: "12px 14px",
              background: H.amberSoft,
              border: `1px solid ${H.amber}`,
              fontFamily: F.mono,
              fontSize: 12,
              color: H.amber,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>Engine unreachable: {error}</span>
            <button
              type="button"
              onClick={runValidation}
              style={{
                padding: "6px 14px",
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: H.amber,
                background: "transparent",
                border: `1px solid ${H.amber}`,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Results list */}
      {status === "done" && (
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {results.length === 0 && (
            <div
              style={{
                fontFamily: F.serif,
                fontSize: 14,
                color: H.faint,
                padding: "18px 0",
                textAlign: "center",
              }}
            >
              The engine returned no verdicts.
            </div>
          )}
          {results.map((r, i) => (
            <VerdictRow key={i} result={r} />
          ))}
        </div>
      )}

      {/* Idle state — manual run */}
      {status === "idle" && !autoRun && (
        <div
          style={{
            padding: "20px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={runValidation}
            disabled={records.length === 0}
            style={{
              padding: "10px 20px",
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#FFFDF7",
              background: records.length === 0 ? H.stone : H.copper,
              border: "none",
              cursor: records.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Run validation →
          </button>
        </div>
      )}
    </section>
  );
}

// ── Verdict row ──────────────────────────────────────────────────────────────

function VerdictRow({ result }: { result: ValidateScheduleResult }) {
  const valid = result.valid;
  // Booster rows (and any row the engine cannot safely validate) surface
  // as AMBER even when valid=true. The engine's honest answer is "I did
  // not find a violation but I do not carry a schedule rule for this" —
  // the clinician still has to confirm. This preserves the two-gate
  // posture: RED = engine rejects, AMBER = engine defers to clinician.
  const amberReview = Boolean(result.needs_clinician_confirmation);

  const shell: React.CSSProperties = amberReview
    ? {
        background: H.card,
        border: `1px solid ${H.amber}`,
        borderLeft: `3px solid ${H.amber}`,
      }
    : valid
    ? {
        background: H.card,
        border: `1px solid ${H.rule}`,
        borderLeft: `3px solid ${H.ok}`,
      }
    : {
        // RED per PRD §6 point 3 — clinical-safety violation.
        background: H.card,
        border: `1px solid ${H.badBorder}`,
        borderLeft: `3px solid ${H.bad}`,
      };

  return (
    <article
      style={{
        ...shell,
        padding: "14px 18px",
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: H.meta,
            }}
          >
            {result.antigen}
            {result.dose_kind === "booster"
              ? result.dose_number !== null
                ? ` · booster (dose ${result.dose_number})`
                : " · booster"
              : result.dose_number !== null
              ? ` · dose ${result.dose_number}`
              : ""}
          </div>
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 15,
              color: H.ink,
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            Age at dose: {result.age_at_dose_days} days
            {result.prior_dose_age_days !== null && (
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 12,
                  color: H.faint,
                  marginLeft: 10,
                  letterSpacing: "0.04em",
                }}
              >
                (prior dose at {result.prior_dose_age_days}d)
              </span>
            )}
          </div>
        </div>

        <VerdictBadge valid={valid} amberReview={amberReview} />
      </div>

      {/* Reasons — engine-authored, rendered verbatim. Already carry
          rule-source citations (e.g., "ACIP general minimum"). */}
      {result.reasons.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "4px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {result.reasons.map((r, i) => (
            <li
              key={i}
              style={{
                fontFamily: F.serif,
                fontSize: 13.5,
                color: valid ? H.ink2 : H.bad,
                lineHeight: 1.55,
                fontStyle: valid ? "normal" : "italic",
              }}
            >
              {r}
            </li>
          ))}
        </ul>
      )}

      {/* Flags — non-invalidating advisories, neutral tone. */}
      {result.flags.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: "8px 12px",
            margin: "10px 0 0",
            background: H.paper2,
            border: `1px solid ${H.ruleSoft}`,
            borderLeft: `2px solid ${H.stone}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {result.flags.map((f, i) => (
            <li
              key={i}
              style={{
                fontFamily: F.mono,
                fontSize: 11.5,
                color: H.meta,
                lineHeight: 1.45,
                letterSpacing: "0.02em",
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function VerdictBadge({
  valid,
  amberReview,
}: {
  valid: boolean;
  amberReview: boolean;
}) {
  let color: string;
  let bg: string;
  let label: string;
  if (amberReview) {
    color = H.amber;
    bg = H.amberSoft;
    label = "Clinician review";
  } else if (valid) {
    color = H.ok;
    bg = H.okSoft;
    label = "Valid";
  } else {
    color = H.bad;
    bg = H.badSoft;
    label = "Interval violation";
  }
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        padding: "4px 10px",
        background: bg,
        border: `1px solid ${color}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── Loading skeleton with progress steps ─────────────────────────────────────

const PROGRESS_STEPS = [
  "Cross-checking against WHO rules…",
  "Computing per-dose verdicts…",
  "Finalizing results…",
] as const;

function LoadingSkeleton({ step }: { step: number }) {
  return (
    <div
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: H.copperInk,
        }}
      >
        {PROGRESS_STEPS[Math.min(step, PROGRESS_STEPS.length - 1)]}
      </div>

      {/* Progress rail */}
      <div
        style={{
          display: "flex",
          gap: 6,
          height: 4,
          background: H.ruleSoft,
        }}
      >
        {PROGRESS_STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: i <= step ? H.copper : "transparent",
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Skeleton rows */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          style={{
            background: H.card,
            border: `1px solid ${H.rule}`,
            borderLeft: `3px solid ${H.stone}`,
            padding: "14px 18px",
            opacity: 0.7,
          }}
        >
          <div
            style={{
              height: 12,
              width: "35%",
              background: H.ruleSoft,
              marginBottom: 8,
            }}
          />
          <div style={{ height: 14, width: "70%", background: H.ruleSoft }} />
        </div>
      ))}
    </div>
  );
}
