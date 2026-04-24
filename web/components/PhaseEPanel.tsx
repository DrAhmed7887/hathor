"use client";

/**
 * PRD §5.6 AUDIT — Reasoning Safety Loop (container)
 * --------------------------------------------------
 * This is the UI half of the Reasoning Safety Loop: every
 * recommendation the agent emitted has already been run through the
 * deterministic Python rules engine (Phase E), and the panel renders
 * only what the engine validated. The agent reasons freely; the output
 * layer is gated.
 *
 * Mapping:
 *   - payload.active_results (ValidationResult[])   ← rules-engine verdicts
 *   - override_endpoint                              ← FHIR Provenance writer
 *   - has_override_required / has_failures            ← Phase E severity flags
 *
 * The new /validate-schedule endpoint from d2cccc7 is a SECOND path into
 * the same engine, intended for the hackathon demo's card-parse → batch
 * validate flow (no agent in the loop for the fast path). Both paths
 * enforce the same gate — engine decides, UI renders. Step 7 will wire
 * a view that calls /validate-schedule directly; this panel stays on
 * the agent path.
 *
 * No gaps vs. PRD §5.6 at the container level.
 */

import { useMemo, useState } from "react";
import { type PhaseECompletePayload } from "@/lib/api";
import { buildPhaseESummary } from "@/lib/phase-e-summary";
import { RecommendationCard, type Recommendation } from "./RecommendationCard";

const H = {
  paper2:    "#FBF6EC",
  card:      "#FFFDF7",
  rule:      "#E7E2DA",
  copper:    "#CC785C",
  copperInk: "#9A5743",
  ink:       "#1C1917",
  meta:      "#6B6158",
  plum:      "#6E4A6B",
  plumSoft:  "#ECE0EA",
  plumRule:  "#B89AB2",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export interface PhaseEPanelProps {
  payload: PhaseECompletePayload;
  /** The agent's emitted recommendations, keyed by recommendation_id.
   * Passed separately because emit_recommendations does not echo the full
   * Recommendation payload in ValidationResult — only the rule metadata. */
  recommendations: Record<string, Recommendation>;
  onOverrideSubmitted?: (payload: { recommendation_id: string; provenance_id: string }) => void;
}

export function PhaseEPanel({ payload, recommendations, onOverrideSubmitted }: PhaseEPanelProps) {
  const { active_results, override_endpoint } = payload;
  const [resolvedReviewIds, setResolvedReviewIds] = useState<Set<string>>(new Set());
  const mergedRecommendations = useMemo(
    () => ({ ...(payload.recommendations ?? {}), ...recommendations }),
    [payload.recommendations, recommendations],
  );
  const summary = useMemo(
    () => buildPhaseESummary(active_results, mergedRecommendations, resolvedReviewIds),
    [active_results, mergedRecommendations, resolvedReviewIds],
  );

  function handleOverrideSubmitted(data: { recommendation_id: string; provenance_id: string }) {
    setResolvedReviewIds((prev) => new Set([...prev, data.recommendation_id]));
    onOverrideSubmitted?.(data);
  }

  return (
    <div data-testid="phase-e-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: H.copperInk }}>
          Phase E · cross-border immunization reconciliation
        </div>
        <h2 style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 400, color: H.ink, margin: "6px 0 0", letterSpacing: "-0.015em" }}>
          Immunization reconciliation summary
        </h2>
      </div>

      <section
        data-testid="phase-e-summary-card"
        style={{
          background: H.paper2,
          border: `1px solid ${H.rule}`,
          borderLeft: `3px solid ${summary.needsClinicianReview > 0 ? H.plum : H.copper}`,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {[
            ["Card status", summary.cardStatus],
            ["Doses found", String(summary.dosesFound)],
            ["Confirmed matches", String(summary.confirmedMatches)],
            ["Needs clinician review", String(summary.needsClinicianReview)],
            ["Missing or uncertain vaccines", String(summary.missingOrUncertainVaccines)],
            ["Export status", summary.exportStatus],
          ].map(([label, value]) => (
            <div key={label} style={{ background: H.card, border: `1px solid ${H.rule}`, padding: "10px 12px" }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontFamily: F.serif, fontSize: 15, color: H.ink, lineHeight: 1.3 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
          {[
            ["Evidence extracted", true],
            ["Rules applied", active_results.length > 0],
            ["Clinician action needed", summary.needsClinicianReview > 0],
            ["Export package generated", summary.needsClinicianReview === 0],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              style={{
                border: `1px solid ${active ? H.plumRule : H.rule}`,
                color: active ? H.plum : H.meta,
                background: active ? H.plumSoft : H.card,
                padding: "7px 8px",
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textAlign: "center",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* Actionable recommendations only. PASS rows live in the audit log. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {summary.actionableGroups.length === 0 && (
          <div style={{ background: H.paper2, border: `1px solid ${H.rule}`, padding: "12px 16px", fontFamily: F.serif, fontSize: 14, color: H.ink }}>
            No unresolved Phase E recommendations require clinician action.
          </div>
        )}
        {summary.actionableGroups.map((group) => {
          const id = group.recommendationId;
          const rec = mergedRecommendations[id] ?? {
            recommendation_id: id,
            kind: "dose_verdict",
            antigen: group.primaryResult.rule_slug === "rotavirus_age_cutoff" ? "Rotavirus" : "",
            agent_rationale: group.primaryResult.rule_slug ?? id,
          };
          return (
            <RecommendationCard
              key={id}
              recommendation={rec}
              result={group.primaryResult}
              overrideEndpoint={override_endpoint}
              onOverrideSubmitted={handleOverrideSubmitted}
            />
          );
        })}
      </div>

      <details style={{ borderTop: `1px solid ${H.rule}`, paddingTop: 10 }}>
        <summary style={{ cursor: "pointer", fontFamily: F.mono, fontSize: 11, color: H.meta, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Technical audit log · {active_results.length} rule result{active_results.length !== 1 ? "s" : ""} · {summary.passResults.length} pass
        </summary>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {active_results.map((result, index) => {
            const rec = mergedRecommendations[result.recommendation_id];
            return (
              <div
                key={`${result.recommendation_id}-${result.rule_id ?? index}-${index}`}
                style={{
                  background: H.card,
                  border: `1px solid ${H.rule}`,
                  padding: "8px 10px",
                  fontFamily: F.mono,
                  fontSize: 11,
                  color: H.meta,
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1.2fr 0.8fr",
                  gap: 8,
                }}
              >
                <span>{rec?.antigen || "Recommendation"} · {rec?.kind || "rule"}</span>
                <span>{result.rule_slug || result.rule_id || "rule"}</span>
                <span style={{ color: result.severity === "pass" ? "#5F7A52" : H.plum, textTransform: "uppercase" }}>
                  {result.severity === "override_required" ? "Review" : result.severity}
                </span>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
