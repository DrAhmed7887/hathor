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

import { type PhaseECompletePayload } from "@/lib/api";
import { RecommendationCard, type Recommendation } from "./RecommendationCard";

const H = {
  paper2:    "#FBF6EC",
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
  const { has_override_required, has_failures, active_results, override_endpoint } = payload;

  return (
    <div data-testid="phase-e-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: H.copperInk }}>
          Phase E · rules engine verdicts
        </div>
        <h2 style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 400, color: H.ink, margin: "6px 0 0", letterSpacing: "-0.015em" }}>
          Clinical recommendations
        </h2>
      </div>

      {/* Override-required banner */}
      {has_override_required && (
        <div
          data-testid="override-required-banner"
          style={{
            background: H.plumSoft,
            border: `1px solid ${H.plumRule}`,
            borderLeft: `3px solid ${H.plum}`,
            padding: "12px 16px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}
        >
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: H.plum }}>
              Migrant Protocol engaged
            </div>
            <p style={{ fontFamily: F.serif, fontSize: 13.5, color: H.ink, margin: "4px 0 0", lineHeight: 1.5 }}>
              One or more recommendations require a structured override. Each is flagged below with its justification selector.
            </p>
          </div>
        </div>
      )}

      {/* Recommendation list — deduped by recommendation_id.
          The Phase-E stream can emit multiple ValidationResults for
          the same recommendation_id across iterative agent passes
          (each new emit_recommendations tool call re-validates and
          appends). The UI contract is "the latest verdict supersedes
          earlier ones" — matches Phase-E semantics where
          result.supersedes points backward, not forward. Rendering
          the raw array produced duplicate React keys (rec-025,
          rec-026, etc.) flooding the console. Dedupe here, keep
          insertion order of the FIRST time each id was seen so the
          list doesn't visually jitter when a later iteration lands. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(() => {
          const lastByRecId = new Map<string, typeof active_results[number]>();
          for (const r of active_results) lastByRecId.set(r.recommendation_id, r);
          const firstOrderIds: string[] = [];
          const seen = new Set<string>();
          for (const r of active_results) {
            if (!seen.has(r.recommendation_id)) {
              seen.add(r.recommendation_id);
              firstOrderIds.push(r.recommendation_id);
            }
          }
          return firstOrderIds.map((id) => {
            const result = lastByRecId.get(id)!;
            const rec = recommendations[id] ?? {
              recommendation_id: id,
              kind: "dose_verdict",
              antigen: "",
              agent_rationale: result.rule_slug ?? id,
            };
            return (
              <RecommendationCard
                key={id}
                recommendation={rec}
                result={result}
                overrideEndpoint={override_endpoint}
                onOverrideSubmitted={onOverrideSubmitted}
              />
            );
          });
        })()}
      </div>

      {/* Footer summary */}
      <div style={{ borderTop: `1px solid ${H.rule}`, paddingTop: 10, fontFamily: F.mono, fontSize: 11, color: H.meta, letterSpacing: "0.08em" }}>
        {active_results.length} result{active_results.length !== 1 ? "s" : ""}
        {has_failures ? " · blocks present" : ""}
        {has_override_required ? " · structured override required" : ""}
      </div>
    </div>
  );
}
