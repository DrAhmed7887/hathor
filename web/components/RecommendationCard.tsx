"use client";

/**
 * PRD §5.6 + §6 AUDIT — Reasoning Safety Loop (per-recommendation)
 * ----------------------------------------------------------------
 * Renders one engine-validated recommendation + the clinician's override
 * pathway. This is the terminal node of the Reasoning Safety Loop: nothing
 * the agent said reaches this card without a corresponding ValidationResult
 * from the Python rules engine.
 *
 * Aligned with PRD:
 *   - SeverityBadge: pass / warn (amber) / fail (red) / override_required
 *     (plum). PRD §6 point 3: AMBER = review, RED = clinical-safety
 *     violation, plus an escalation channel for structured override. The
 *     three-channel split is clean — do not collapse.
 *   - Rule citation block: rule_id, rule_slug, rule_rationale rendered
 *     above the override controls. PRD §6 point 4 requires every
 *     recommendation to cite the WHO rule; this card delivers it.
 *   - Override pathway: justification code (override_required) + clinical
 *     reason text → postOverride → server writes FHIR Provenance with the
 *     DAK rule ID, original proposal, override reason, and timestamp.
 *     PRD §5.6 "Clinician final authority" — ✓.
 *
 * This component is the palette reference for the two severity channels.
 * FieldRow's red-for-OCR-uncertainty will migrate to THIS component's
 * amber (H.amber / H.amberSoft) in the later step that lands the
 * extraction-uncertainty UI.
 *
 * No gaps vs. PRD §5.6 / §6.
 */

import { useState } from "react";
import { postOverride, type ValidationResult } from "@/lib/api";

// ── Pharos palette (Commit 8 extensions) ─────────────────────────────────────
// amber (warn)  + plum (override_required) proposed and documented in the
// commit message. Consistent with the inline-per-file convention used in
// reconcile-card/page.tsx and FieldRow.tsx.
const H = {
  paper:      "#F6F0E4",
  paper2:     "#FBF6EC",
  card:       "#FFFDF7",
  rule:       "#E7E2DA",
  copper:     "#CC785C",
  copperInk:  "#9A5743",
  stone:      "#CFC4B1",
  ink:        "#1C1917",
  ink2:       "#292524",
  meta:       "#6B6158",
  faint:      "#A8A29E",
  ok:         "#5F7A52",
  bad:        "#A3453B",
  badSoft:    "#F3E3DF",
  badBorder:  "#D4837A",
  // NEW Commit 8 tokens ───────────
  amber:      "#B8833B",
  amberSoft:  "#F4E9D1",
  plum:       "#6E4A6B",
  plumSoft:   "#ECE0EA",
  plumRule:   "#B89AB2",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export interface Recommendation {
  recommendation_id: string;
  kind: string;
  antigen: string;
  agent_rationale: string;
  reasoning?: string;
  agent_confidence?: number;
  dose_number?: number | null;
  target_date?: string | null;
}

interface Props {
  recommendation: Recommendation;
  result: ValidationResult;
  overrideEndpoint: string;
  onOverrideSubmitted?: (payload: { recommendation_id: string; provenance_id: string }) => void;
}

// ── Shield glyph for override_required ───────────────────────────────────────

function ShieldGlyph({ size = 24, color = H.plum }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 L20 5 V11 C20 15.5 16.5 19.5 12 22 C7.5 19.5 4 15.5 4 11 V5 Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Severity-specific badges ─────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: ValidationResult["severity"] }) {
  const styles: Record<ValidationResult["severity"], { bg: string; fg: string; label: string }> = {
    pass:              { bg: H.paper2,   fg: H.ok,   label: "Pass" },
    warn:              { bg: H.amberSoft, fg: H.amber, label: "Advisory" },
    fail:              { bg: H.badSoft,   fg: H.bad,   label: "Requires physician review" },
    override_required: { bg: H.plumSoft,  fg: H.plum,  label: "Clinical override required" },
  };
  const s = styles[severity];
  return (
    <span
      data-testid={`severity-badge-${severity}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: s.bg, color: s.fg,
        fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
        padding: "4px 10px",
      }}
    >
      {severity === "override_required" && <ShieldGlyph size={14} color={s.fg} />}
      {s.label}
    </span>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────

export function RecommendationCard({
  recommendation,
  result,
  overrideEndpoint,
  onOverrideSubmitted,
}: Props) {
  const [justificationCode, setJustificationCode] = useState<string>("");
  const [freeText, setFreeText]                   = useState("");
  const [submitting, setSubmitting]               = useState(false);
  const [submitted, setSubmitted]                 = useState(false);
  const [submitError, setSubmitError]             = useState<string | null>(null);

  const isOverrideRequired = result.severity === "override_required";
  const isFail             = result.severity === "fail";
  const isWarn             = result.severity === "warn";

  // Submit enabled only when the payload is valid for the severity.
  const submitEnabled =
    !submitting &&
    !submitted &&
    (
      (isFail && freeText.trim().length > 0) ||
      (isOverrideRequired && justificationCode.length > 0)
    );

  async function handleSubmit() {
    if (!submitEnabled) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await postOverride(overrideEndpoint, {
      recommendation_id: recommendation.recommendation_id,
      rule_id:            result.rule_id ?? "",
      severity:           isOverrideRequired ? "override_required" : "fail",
      justification_code: isOverrideRequired ? justificationCode : null,
      clinical_reason_text: freeText.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
      onOverrideSubmitted?.({
        recommendation_id: recommendation.recommendation_id,
        provenance_id: res.provenance_id,
      });
    } else {
      setSubmitError(`${res.status}: ${res.detail}`);
    }
  }

  // Border + background palette per severity.
  const shell =
    isOverrideRequired ? { border: H.plumRule, left: H.plum,  bg: H.card } :
    isFail             ? { border: H.badBorder, left: H.bad,  bg: H.card } :
    isWarn             ? { border: H.rule,     left: H.amber, bg: H.card } :
                         { border: H.rule,     left: H.stone, bg: H.card };

  return (
    <article
      data-testid={`recommendation-card-${result.severity}`}
      style={{
        background: shell.bg,
        border: `1px solid ${shell.border}`,
        borderLeft: `3px solid ${shell.left}`,
        padding: "20px 24px",
        fontFamily: F.sans,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta }}>
            {recommendation.kind} · {recommendation.antigen}
          </div>
          <h3 style={{ fontFamily: F.serif, fontSize: 17, fontWeight: 400, color: H.ink, margin: "4px 0 0", lineHeight: 1.35 }}>
            {recommendation.agent_rationale}
          </h3>
        </div>
        <SeverityBadge severity={result.severity} />
      </div>

      {/* Override_required headline */}
      {isOverrideRequired && (
        <div
          data-testid="override-required-headline"
          style={{
            background: H.plumSoft,
            borderLeft: `2px solid ${H.plum}`,
            padding: "10px 14px",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ShieldGlyph size={16} color={H.plum} />
            <span style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: H.plum }}>
              Migrant Protocol · structured override
            </span>
          </div>
          <p style={{ fontFamily: F.serif, fontSize: 13.5, color: H.ink2, margin: 0, lineHeight: 1.5 }}>
            This rule carries documented adverse-event risk. Proceeding requires a structured justification, logged to FHIR Provenance.
          </p>
        </div>
      )}

      {/* Rule rationale (warn / fail / override_required) */}
      {result.severity !== "pass" && result.rule_slug && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, marginBottom: 4 }}>
            Rule · {result.rule_id} ({result.rule_slug})
          </div>
          {result.rule_rationale && (
            <p style={{ fontFamily: F.serif, fontSize: 14, color: H.ink2, margin: 0, lineHeight: 1.55, fontStyle: isWarn ? "italic" : "normal" }}>
              {result.rule_rationale}
            </p>
          )}
        </div>
      )}

      {/* Override pathway */}
      {(isFail || isOverrideRequired) && !submitted && (
        <div style={{ borderTop: `1px solid ${H.rule}`, paddingTop: 14, marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
          {isOverrideRequired && (
            <div>
              <label
                htmlFor={`justification-${recommendation.recommendation_id}`}
                style={{ display: "block", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.plum, marginBottom: 6 }}
              >
                Justification code (required)
              </label>
              <select
                id={`justification-${recommendation.recommendation_id}`}
                data-testid={`justification-select-${recommendation.recommendation_id}`}
                value={justificationCode}
                onChange={(e) => setJustificationCode(e.target.value)}
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontFamily: F.mono, fontSize: 12,
                  background: "#fff", color: H.ink,
                  border: `1px solid ${H.plumRule}`,
                  borderRadius: 0,
                }}
              >
                <option value="">— select a justification —</option>
                {result.override_justification_codes.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor={`reason-${recommendation.recommendation_id}`}
              style={{ display: "block", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, marginBottom: 6 }}
            >
              Clinical reason {isFail ? "(required)" : "(optional, supplements the code)"}
            </label>
            <textarea
              id={`reason-${recommendation.recommendation_id}`}
              data-testid={`reason-textarea-${recommendation.recommendation_id}`}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder={isFail ? "Why is this recommendation being overridden?" : "Additional clinical context (optional)"}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontFamily: F.sans, fontSize: 13, lineHeight: 1.5,
                background: "#fff", color: H.ink,
                border: `1px solid ${H.rule}`,
                borderRadius: 0,
                resize: "vertical",
              }}
            />
          </div>

          {submitError && (
            <div style={{ padding: "8px 10px", background: H.badSoft, border: `1px solid ${H.bad}`, fontFamily: F.mono, fontSize: 11, color: H.bad }}>
              {submitError}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              data-testid={`submit-override-${recommendation.recommendation_id}`}
              onClick={handleSubmit}
              disabled={!submitEnabled}
              style={{
                background: submitEnabled ? (isOverrideRequired ? H.plum : H.copper) : H.stone,
                color: "#FFFDF7",
                border: "none",
                padding: "10px 20px",
                fontFamily: F.mono, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
                cursor: submitEnabled ? "pointer" : "not-allowed",
              }}
            >
              {submitting ? "Submitting…" : "Submit override"}
            </button>
          </div>
        </div>
      )}

      {submitted && (
        <div
          data-testid={`override-submitted-${recommendation.recommendation_id}`}
          style={{ borderTop: `1px solid ${H.rule}`, paddingTop: 12, marginTop: 6, fontFamily: F.mono, fontSize: 11, color: H.ok, letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          ✓ Override logged to FHIR Provenance
        </div>
      )}
    </article>
  );
}
