"use client";

/**
 * Phase-F export — FHIR Immunization bundle + printable clinical letter.
 *
 * Consumes ReconciledDose[] from the step-10 composition (parsed rows
 * joined with engine verdicts from ScheduleView) and produces two
 * artifacts:
 *
 *   1. FHIR JSON download. Via buildImmunizationBundle in lib/fhir.ts
 *      (IMMZ-aligned, not IMMZ-conformant, Phase 1.0 posture). The
 *      builder refuses invalid doses by design — PRD §5.6 Reasoning
 *      Safety Loop enforced at the type-of-error level. Invalid doses
 *      show in the letter (physician needs visibility) but are filtered
 *      from the bundle (only engine-approved doses are data artifacts).
 *
 *   2. Clinical letter. Rendered into a hidden iframe with all styles
 *      inline; iframe.contentWindow.print() opens the browser's print
 *      dialog, which offers "Save as PDF" natively on every modern
 *      platform. No new dependencies.
 *
 * Deliberate design calls:
 *   - No PDF library dependency (jsPDF, pdfmake, html2pdf, react-pdf).
 *     CLAUDE.md scope discipline applies; browser print is sufficient
 *     for a demo and avoids adding weight.
 *   - Letter is a NARRATIVE artifact, not a data dump (PRD §8.2 +
 *     step-spec "PDF clinical letter format, not a data dump").
 *     Header / patient / summary counts / per-dose list / disclaimer.
 *   - Every letter and bundle is stamped with the HATHOR Phase 1.0
 *     disclosure so nothing it produces can be mistaken for a
 *     conformant clinical record.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { buildImmunizationBundle } from "@/lib/fhir";
import type {
  CountryCode,
  IntakeContext,
  ReconciledDose,
} from "@/lib/types";
import { COUNTRIES } from "@/lib/countries";

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
  bad:       "#A3453B",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export interface ExportPanelProps {
  doses: ReconciledDose[];
  childDob: string;
  sourceCountry?: CountryCode;
  destinationCountry?: CountryCode;
  /** Optional — rendered into the letter as context when present. */
  intake?: IntakeContext;
}

export function ExportPanel({
  doses,
  childDob,
  sourceCountry,
  destinationCountry,
  intake,
}: ExportPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [letterError, setLetterError] = useState<string | null>(null);

  const counts = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    let review = 0;
    for (const d of doses) {
      if (d.verdict.needs_clinician_confirmation) review++;
      else if (d.verdict.valid) valid++;
      else invalid++;
    }
    return { valid, invalid, review, total: doses.length };
  }, [doses]);

  const hasBlockingReview = counts.invalid > 0 || counts.review > 0;
  const canDownloadBundle = counts.valid > 0 && !hasBlockingReview;
  const canGenerateLetter = doses.length > 0 && !hasBlockingReview;

  const downloadFhir = useCallback(() => {
    try {
      const bundle = buildImmunizationBundle({ childDob }, doses);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/fhir+json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `hathor-immunization-bundle-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Release the URL after a tick to let the download kick off.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      // buildImmunization throws on invalid doses slipping through —
      // that should never happen at this layer (ScheduleView filters),
      // but surface rather than swallow.
      setLetterError(
        err instanceof Error ? err.message : "Failed to build bundle.",
      );
    }
  }, [childDob, doses]);

  const printLetter = useCallback(() => {
    setLetterError(null);
    const iframe = iframeRef.current;
    if (!iframe) {
      setLetterError("Print frame unavailable.");
      return;
    }
    const doc = iframe.contentDocument;
    if (!doc) {
      setLetterError("Could not access print frame.");
      return;
    }

    try {
      const html = renderLetterHtml({
        doses,
        childDob,
        sourceCountry,
        destinationCountry,
        intake,
        counts,
      });
      doc.open();
      doc.write(html);
      doc.close();

      const trigger = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      };
      // Small delay so the browser has laid out the iframe before we
      // fire print — some engines flash an empty preview otherwise.
      setTimeout(trigger, 80);
    } catch (err) {
      setLetterError(
        err instanceof Error ? err.message : "Failed to render letter.",
      );
    }
  }, [
    doses,
    childDob,
    sourceCountry,
    destinationCountry,
    intake,
    counts,
  ]);

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
          Phase F · export
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
          Export the reconciled record
        </h2>
      </header>

      {/* Summary + actions */}
      <div
        style={{
          padding: "18px 20px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
        }}
      >
        {/* FHIR column */}
        <div
          style={{
            background: H.card,
            border: `1px solid ${H.rule}`,
            padding: "16px 18px",
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
              color: H.meta,
            }}
          >
            Structured data · FHIR R4
          </div>
          <div style={{ fontFamily: F.serif, fontSize: 15, color: H.ink }}>
            Immunization bundle — {counts.valid} engine-validated dose
            {counts.valid === 1 ? "" : "s"}
          </div>
          {hasBlockingReview && (
            <p
              style={{
                fontFamily: F.sans,
                fontSize: 12.5,
                color: H.bad,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              Export is disabled until clinician-review and safety-blocking
              items are resolved.
            </p>
          )}
          <p
            style={{
              fontFamily: F.sans,
              fontSize: 12.5,
              color: H.mute,
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            JSON Bundle · one Patient + one Immunization per valid dose.
            IMMZ-aligned architecture, Phase 1.0 demo scope — NOT
            IMMZ-conformant. Invalid doses are not included in the
            bundle per PRD §5.6; they remain in the letter for
            physician visibility.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={downloadFhir}
              disabled={!canDownloadBundle}
              style={{
                padding: "10px 18px",
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#FFFDF7",
                background: canDownloadBundle ? H.copper : H.stone,
                border: "none",
                cursor: canDownloadBundle ? "pointer" : "not-allowed",
              }}
            >
              Download FHIR JSON
            </button>
          </div>
        </div>

        {/* Letter column */}
        <div
          style={{
            background: H.card,
            border: `1px solid ${H.rule}`,
            padding: "16px 18px",
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
              color: H.meta,
            }}
          >
            Narrative · clinical letter
          </div>
          <div style={{ fontFamily: F.serif, fontSize: 15, color: H.ink }}>
            Printable reconciliation letter
          </div>
          <p
            style={{
              fontFamily: F.sans,
              fontSize: 12.5,
              color: H.mute,
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            Includes all {counts.total} reviewed dose
            {counts.total === 1 ? "" : "s"}
            {counts.review > 0 && (
              <>
                , <strong style={{ color: "#B8833B" }}>{counts.review}
                awaiting clinician review</strong>
              </>
            )}
            {counts.invalid > 0 && (
              <>
                , <strong style={{ color: H.bad }}>{counts.invalid} with
                interval violations</strong>
              </>
            )}
            . Use your browser&apos;s print dialog to save as PDF.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={printLetter}
              disabled={!canGenerateLetter}
              style={{
                padding: "10px 18px",
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#FFFDF7",
                background: canGenerateLetter ? H.copper : H.stone,
                border: "none",
                cursor: canGenerateLetter ? "pointer" : "not-allowed",
              }}
            >
              Print clinical letter
            </button>
          </div>
        </div>
      </div>

      {letterError && (
        <div
          role="alert"
          style={{
            margin: "0 20px 18px",
            padding: "10px 14px",
            background: "#F4E9D1",
            border: "1px solid #B8833B",
            fontFamily: F.mono,
            fontSize: 12,
            color: "#B8833B",
          }}
        >
          {letterError}
        </div>
      )}

      {/* Hidden print surface */}
      <iframe
        ref={iframeRef}
        title="HATHOR clinical letter (print surface)"
        aria-hidden
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          border: 0,
          // position:absolute with zero size keeps the iframe out of
          // layout flow; print() still reads from its document.
        }}
      />
    </section>
  );
}

// ── Letter renderer ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface LetterArgs {
  doses: ReconciledDose[];
  childDob: string;
  sourceCountry?: CountryCode;
  destinationCountry?: CountryCode;
  intake?: IntakeContext;
  counts: { valid: number; invalid: number; review: number; total: number };
}

function renderLetterHtml({
  doses,
  childDob,
  sourceCountry,
  destinationCountry,
  intake,
  counts,
}: LetterArgs): string {
  const today = new Date().toISOString().slice(0, 10);
  const sourceName = sourceCountry ? COUNTRIES[sourceCountry].name : "—";
  const destName = destinationCountry
    ? COUNTRIES[destinationCountry].name
    : "—";

  const rowsHtml = doses
    .map((d, i) => {
      const amberReview = Boolean(d.verdict.needs_clinician_confirmation);
      const shellClass = amberReview
        ? "review"
        : d.verdict.valid
          ? "valid"
          : "invalid";
      const verdict = amberReview
        ? `<span class="verdict amber">Clinician review</span>`
        : d.verdict.valid
          ? `<span class="verdict ok">Valid</span>`
          : `<span class="verdict bad">Interval violation</span>`;
      // Header label: "DTP · booster" / "DTP · booster (dose 4)" /
      // "DTP · dose 3" depending on what the card actually said.
      const kind = d.parsed.doseKind;
      const doseNum = d.verdict.dose_number;
      const headerDose =
        kind === "booster"
          ? doseNum !== null
            ? `booster (dose ${doseNum})`
            : "booster"
          : kind === "birth"
            ? doseNum !== null
              ? `birth dose ${doseNum}`
              : "birth dose"
            : doseNum !== null
              ? `dose ${doseNum}`
              : "dose n/a";
      const reasons = d.verdict.reasons
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("");
      const flags = d.verdict.flags
        .map((f) => `<li>${escapeHtml(f)}</li>`)
        .join("");
      return `
        <article class="dose ${shellClass}">
          <header class="dose-head">
            <div>
              <div class="label">Dose ${i + 1}</div>
              <div class="antigen">${escapeHtml(d.parsed.antigen)} · ${headerDose}</div>
            </div>
            ${verdict}
          </header>
          <div class="dose-facts">
            <span><em>Date:</em> ${escapeHtml(d.parsed.date ?? "—")}</span>
            <span><em>Age at dose:</em> ${d.verdict.age_at_dose_days} days</span>
            ${
              d.parsed.lotNumber
                ? `<span><em>Lot:</em> ${escapeHtml(d.parsed.lotNumber)}</span>`
                : ""
            }
          </div>
          ${
            reasons
              ? `<div class="block reasons"><div class="label">Engine verdict</div><ul>${reasons}</ul></div>`
              : ""
          }
          ${
            flags
              ? `<div class="block flags"><div class="label">Flags</div><ul>${flags}</ul></div>`
              : ""
          }
        </article>`;
    })
    .join("");

  const intakeSummary =
    intake && (intake.cardLanguage || intake.priorDosesKnown || intake.knownAllergiesOrContraindications)
      ? `
        <section class="intake">
          <h3>Pre-visit intake</h3>
          <dl>
            ${intake.cardLanguage ? `<dt>Card language</dt><dd>${escapeHtml(intake.cardLanguage)}</dd>` : ""}
            ${intake.priorDosesKnown ? `<dt>Prior doses</dt><dd>${escapeHtml(intake.priorDosesKnown)}</dd>` : ""}
            ${intake.knownAllergiesOrContraindications ? `<dt>Allergies / contraindications</dt><dd>${escapeHtml(intake.knownAllergiesOrContraindications)}</dd>` : ""}
          </dl>
        </section>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>HATHOR · reconciliation letter · ${today}</title>
<style>
  @page { margin: 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1C1917;
    background: #ffffff;
    margin: 0;
    line-height: 1.5;
  }
  .letter { max-width: 720px; margin: 0 auto; padding: 8mm; }

  .banner {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 12px;
    border-bottom: 2px solid #CC785C;
    margin-bottom: 22px;
  }
  .brand {
    font-family: Georgia, serif;
    font-size: 28px;
    letter-spacing: -0.02em;
    color: #1C1917;
  }
  .kicker {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #9A5743;
    margin-bottom: 2px;
  }
  .issued {
    text-align: right;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    color: #6B6158;
    letter-spacing: 0.08em;
  }

  h2 {
    font-size: 18px;
    font-weight: 400;
    margin: 22px 0 6px;
    color: #1C1917;
    border-bottom: 1px solid #E7E2DA;
    padding-bottom: 4px;
  }
  h3 {
    font-size: 14px;
    font-weight: 400;
    margin: 14px 0 4px;
    color: #44403C;
  }
  p { margin: 0 0 10px; }

  dl { margin: 0; display: grid; grid-template-columns: 170px 1fr; row-gap: 4px; }
  dt {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6B6158;
    padding-top: 2px;
  }
  dd { margin: 0; font-size: 14px; color: #1C1917; }

  .summary {
    display: flex;
    gap: 16px;
    margin: 8px 0 16px;
    padding: 10px 14px;
    background: #FBF6EC;
    border: 1px solid #E7E2DA;
  }
  .summary .stat {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    letter-spacing: 0.06em;
    color: #44403C;
  }
  .summary .stat.bad   { color: #A3453B; }
  .summary .stat.ok    { color: #5F7A52; }
  .summary .stat.amber { color: #B8833B; }

  .dose {
    border: 1px solid #E7E2DA;
    padding: 10px 14px;
    margin: 8px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .dose.invalid { border-left: 3px solid #A3453B; }
  .dose.valid   { border-left: 3px solid #5F7A52; }
  .dose.review  { border-left: 3px solid #B8833B; }
  .dose-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .dose .label {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6B6158;
  }
  .dose .antigen {
    font-family: Georgia, serif;
    font-size: 15px;
    color: #1C1917;
    margin-top: 2px;
  }
  .dose-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    color: #44403C;
    margin: 2px 0 6px;
  }
  .dose-facts em {
    font-style: normal;
    color: #6B6158;
    letter-spacing: 0.06em;
  }
  .verdict {
    display: inline-block;
    padding: 2px 8px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .verdict.ok    { color: #5F7A52; border: 1px solid #5F7A52; background: #E8EEE1; }
  .verdict.bad   { color: #A3453B; border: 1px solid #A3453B; background: #F3E3DF; }
  .verdict.amber { color: #B8833B; border: 1px solid #B8833B; background: #F4E9D1; }

  .block { margin-top: 6px; }
  .block ul { margin: 4px 0 0 0; padding-left: 16px; }
  .block li { margin: 2px 0; font-size: 13px; }
  .reasons li { color: #1C1917; }
  .flags li { color: #6B6158; font-family: ui-monospace, monospace; font-size: 11.5px; }

  .disclosure {
    margin-top: 22px;
    padding: 10px 14px;
    border-top: 1px solid #E7E2DA;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: #6B6158;
    letter-spacing: 0.04em;
    line-height: 1.6;
  }
</style>
</head>
<body>
<main class="letter">
  <header class="banner">
    <div>
      <div class="kicker">Cross-border vaccination reconciliation</div>
      <div class="brand">HATHOR</div>
    </div>
    <div class="issued">
      Issued ${today}<br/>
      Reconciliation ${sourceName} → ${destName}
    </div>
  </header>

  <h2>Patient</h2>
  <dl>
    <dt>Child DOB</dt><dd>${escapeHtml(childDob)}</dd>
    <dt>Card origin</dt><dd>${escapeHtml(sourceName)}</dd>
    <dt>Destination schedule</dt><dd>${escapeHtml(destName)}</dd>
  </dl>

  ${intakeSummary}

  <h2>Reconciliation summary</h2>
  <div class="summary">
    <div class="stat">Total reviewed · ${counts.total}</div>
    <div class="stat ok">Engine-valid · ${counts.valid}</div>
    ${counts.review > 0 ? `<div class="stat amber">Clinician review · ${counts.review}</div>` : ""}
    ${counts.invalid > 0 ? `<div class="stat bad">Interval violations · ${counts.invalid}</div>` : ""}
  </div>

  <h2>Dose-by-dose review</h2>
  ${rowsHtml || "<p><em>No doses to display.</em></p>"}

  <div class="disclosure">
    Produced by HATHOR — cross-border vaccination reconciliation prototype,
    Phase 1.0 demo scope. This letter is a clinician-assist artifact and is
    NOT a substitute for a signed medical record. Schedule verdicts are
    generated by a deterministic WHO-DAK-aligned rules engine;
    extraction confidence from the vision pass was reviewed inline by the
    attending clinician before this letter was produced. Not IMMZ-conformant.
  </div>
</main>
</body>
</html>`;
}
