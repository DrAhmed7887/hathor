"use client";

/**
 * PRD §5.6 Vision Safety Loop — the REVIEW half (fast-path).
 *
 * Consumes ParsedCardOutput from /api/parse-card (step 6) and renders
 * each row with:
 *   - the cropped source region per PRD §5.6 requirement #1
 *   - the extracted value for each cell (antigen, date, dose#, lot)
 *   - confidence badge
 *   - reasoning_if_uncertain rendered verbatim for rows < 0.85
 *   - single-field click-to-edit per PRD §6 point 3 — "physician
 *     fixes one field at a time without retyping the rest"
 *   - row-level acknowledge / edit tracking so the Proceed button
 *     cannot advance until every amber row is resolved
 *
 * AUDIT RESULT vs. existing FieldRow.tsx (documented in commit):
 *   FieldRow renders ONE FIELD out of the agent-SSE HITL queue
 *   (HITLQueueItem has a single field_path + single FieldExtraction).
 *   ParsedCardRow from the fast path is WHOLE-DOSE (antigen + date +
 *   dose# + lot + one aggregate confidence). Forcing a single
 *   component to accept both shapes would require a discriminator
 *   prop and dual render modes that could drift. Contracts diverge —
 *   ParsedResults is a new component. FieldRow stays as-is; the
 *   step-2 audit gaps (per-field crop, red→amber migration) still
 *   belong to its own future refactor.
 *
 * Severity channel discipline (PRD §6 point 3):
 *   - AMBER for extraction uncertainty at any magnitude (< 0.85).
 *     The channel is semantic, not magnitude-based — a 0.55 row is
 *     still "review this," not "this will harm a child."
 *   - RED is NOT used in this component. Interval violations surface
 *     in ScheduleView (step 7b / RecommendationCard), not here.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  ImageCropRegion,
  ParsedCardRow,
} from "@/lib/types";
import { displayDoseLabel } from "@/lib/validation";
import {
  mergeEvidenceIntoRows,
  type LayoutAnalysisResult,
} from "@/lib/document-intelligence";
import { formatVisitDate, groupVisits } from "@/lib/visit-grouping";

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
  amber:     "#B8833B",
  amberSoft: "#F4E9D1",
  amberLine: "#E2C998",
  bad:       "#A3453B",
  badSoft:   "#F3E3DF",
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const CONFIDENCE_THRESHOLD = 0.85;
const CROP_DISPLAY_WIDTH = 220; // px — stable size, height derived from aspect

export interface ParsedRowEdit {
  /** Row index in the parent's rows array. */
  rowIndex: number;
  /** Which cell was edited. */
  field: "antigen" | "date" | "doseNumber" | "lotNumber";
  /** New value (string form; parent converts). */
  value: string;
}

export interface ParsedResultsProps {
  rows: ParsedCardRow[];
  /** URL or data URL of the (redacted) source image. If null, rows
   * render without crops — the extracted text is still reviewable. */
  imageUrl: string | null;
  /** Called when the clinician edits a cell. Parent owns the rows
   * array and re-renders with the updated value. */
  onRowsChanged: (rows: ParsedCardRow[]) => void;
  /** Called when every row is resolved and the clinician presses
   * Proceed. Optional — callers that only need review may omit. */
  onProceed?: () => void;
  /** Called when the clinician asks to re-parse the original image
   * with the current prompt/rules. Provided by the parent only when a
   * blob is still in memory — if undefined, the button is hidden. */
  onReparse?: () => void | Promise<void>;
  /** True while a re-parse is in flight. Disables the button and shows
   * a loading label so the clinician does not double-fire the call. */
  reparsing?: boolean;
  /** Optional slot above the row list. Reserved for step 10 to inject
   * the ExplainerParse Remotion composition without this component
   * depending on Remotion itself. */
  headerSlot?: React.ReactNode;
  /** CrossBeam-inspired staged extraction trace. When present, shows a
   * collapsible "Document intelligence trace" section — pages, regions,
   * evidence fragments, orientation/crop warnings. Safety gates (AMBER
   * review, RED engine verdicts) are unaffected by this field. */
  documentIntelligence?: LayoutAnalysisResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAmber(row: ParsedCardRow): boolean {
  return row.confidence < CONFIDENCE_THRESHOLD;
}

function fmtConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

/** CSS for rendering the image cropped to `region` inside a fixed-width
 * container, using a single <div> with background-image. The standard
 * "background-size: 100%/cropW" + "background-position: x/(1-cropW)"
 * trick — works for any crop rectangle inside [0,1]×[0,1]. */
function cropStyles(
  imageUrl: string,
  region: ImageCropRegion,
  displayWidth: number,
): React.CSSProperties {
  // Aspect ratio preserves the source crop shape. Guard tiny regions.
  const w = Math.max(0.01, region.width);
  const h = Math.max(0.01, region.height);
  const aspect = `${w} / ${h}`;
  const bgX = w >= 1 ? 0 : (region.x / (1 - w)) * 100;
  const bgY = h >= 1 ? 0 : (region.y / (1 - h)) * 100;

  return {
    width: displayWidth,
    aspectRatio: aspect,
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${bgX}% ${bgY}%`,
    backgroundRepeat: "no-repeat",
    border: `1px solid ${H.rule}`,
    background: "#000", // dark fallback behind any transparent pixels
    backgroundColor: "#000",
  };
}

// ── Row ──────────────────────────────────────────────────────────────────────

type CellField = "antigen" | "date" | "doseNumber" | "lotNumber";

function cellValue(row: ParsedCardRow, field: CellField): string {
  switch (field) {
    case "antigen":
      return row.antigen;
    case "date":
      return row.date ?? "";
    case "doseNumber":
      return row.doseNumber === null ? "" : String(row.doseNumber);
    case "lotNumber":
      return row.lotNumber ?? "";
  }
}

function applyEdit(row: ParsedCardRow, field: CellField, raw: string): ParsedCardRow {
  const v = raw.trim();
  switch (field) {
    case "antigen":
      return { ...row, antigen: v };
    case "date":
      return { ...row, date: v === "" ? null : v };
    case "doseNumber": {
      if (v === "") return { ...row, doseNumber: null };
      const n = Number.parseInt(v, 10);
      return { ...row, doseNumber: Number.isFinite(n) ? n : null };
    }
    case "lotNumber":
      return { ...row, lotNumber: v === "" ? null : v };
  }
}

interface RowCardProps {
  index: number;
  row: ParsedCardRow;
  imageUrl: string | null;
  resolved: boolean;
  onEdit: (field: CellField, value: string) => void;
  onAcknowledge: () => void;
  onSkip: () => void;
  onReject: (reason: string) => void;
}

function RowCard({
  index,
  row,
  imageUrl,
  resolved,
  onEdit,
  onAcknowledge,
  onSkip,
  onReject,
}: RowCardProps) {
  const amber = isAmber(row);
  const [editing, setEditing] = useState<CellField | null>(null);
  const [draft, setDraft] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const action = row.clinician_action ?? "none";
  const skipped = action === "skipped";
  const rejected = action === "rejected";

  const beginEdit = (field: CellField) => {
    setEditing(field);
    setDraft(cellValue(row, field));
  };
  const commit = () => {
    if (editing) onEdit(editing, draft);
    setEditing(null);
  };
  const cancel = () => {
    setEditing(null);
  };

  // Border + shell: amber when uncertain, resolved-amber when cleared,
  // neutral when confident. Never red.
  const shell: React.CSSProperties = amber
    ? {
        background: resolved ? H.card : H.amberSoft,
        border: `1px solid ${H.amberLine}`,
        borderLeft: `3px solid ${H.amber}`,
      }
    : {
        background: H.card,
        border: `1px solid ${H.rule}`,
        borderLeft: `3px solid ${H.stone}`,
      };

  return (
    <article
      style={{
        ...shell,
        padding: "16px 18px",
        display: "grid",
        gridTemplateColumns: `${CROP_DISPLAY_WIDTH}px 1fr`,
        gap: 18,
        alignItems: "flex-start",
        fontFamily: F.sans,
      }}
    >
      {/* Crop pane */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {imageUrl ? (
          <div
            aria-label={`Source crop for row ${index + 1}`}
            style={cropStyles(imageUrl, row.imageCropRegion, CROP_DISPLAY_WIDTH)}
          />
        ) : (
          <div
            style={{
              width: CROP_DISPLAY_WIDTH,
              aspectRatio: `${row.imageCropRegion.width} / ${row.imageCropRegion.height}`,
              border: `1px dashed ${H.rule}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: H.faint,
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            No image
          </div>
        )}
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10,
            color: H.faint,
            letterSpacing: "0.1em",
          }}
        >
          Row {index + 1} crop
        </div>
      </div>

      {/* Fields pane */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {/* Header row: antigen + confidence */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div>
              <Label>Antigen</Label>
              <EditableValue
                value={cellValue(row, "antigen")}
                editing={editing === "antigen"}
                draft={draft}
                setDraft={setDraft}
                onEditStart={() => beginEdit("antigen")}
                onCommit={commit}
                onCancel={cancel}
                placeholder="—"
                mono
                size="lg"
              />
            </div>
            {(row.doseKind === "booster" || row.doseKind === "birth") && (
              <KindPill kind={row.doseKind} />
            )}
          </div>

          <ConfidenceBadge confidence={row.confidence} />
        </div>

        {/* Three-up cells: date, dose#, lot */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.8fr 1fr",
            gap: 14,
          }}
        >
          <div>
            <Label>Date</Label>
            <EditableValue
              value={cellValue(row, "date")}
              editing={editing === "date"}
              draft={draft}
              setDraft={setDraft}
              onEditStart={() => beginEdit("date")}
              onCommit={commit}
              onCancel={cancel}
              placeholder="YYYY-MM-DD"
              mono
              inputType="date"
            />
          </div>
          <div>
            <Label>Dose #</Label>
            <EditableValue
              value={cellValue(row, "doseNumber")}
              editing={editing === "doseNumber"}
              draft={draft}
              setDraft={setDraft}
              onEditStart={() => beginEdit("doseNumber")}
              onCommit={commit}
              onCancel={cancel}
              placeholder={row.doseKind === "booster" ? "Booster" : "—"}
              mono
              inputType="number"
            />
            {row.doseKind === "booster" && row.doseNumber === null && (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: H.meta,
                }}
              >
                {displayDoseLabel(row)}
              </div>
            )}
          </div>
          <div>
            <Label>Lot</Label>
            <EditableValue
              value={cellValue(row, "lotNumber")}
              editing={editing === "lotNumber"}
              draft={draft}
              setDraft={setDraft}
              onEditStart={() => beginEdit("lotNumber")}
              onCommit={commit}
              onCancel={cancel}
              placeholder="—"
              mono
            />
          </div>
        </div>

        {/* Uncertainty reasoning */}
        {amber && row.reasoningIfUncertain && (
          <p
            style={{
              fontFamily: F.serif,
              fontSize: 13,
              fontStyle: "italic",
              color: H.amber,
              background: resolved ? "transparent" : "rgba(184, 131, 59, 0.06)",
              padding: resolved ? 0 : "8px 10px",
              margin: 0,
              borderLeft: resolved ? "none" : `2px solid ${H.amber}`,
              lineHeight: 1.55,
            }}
          >
            {row.reasoningIfUncertain}
          </p>
        )}

        {/* Acknowledge / Skip / Reject controls — shown for amber rows
            that aren't already resolved via an edit, AND for any row the
            clinician wants to actively skip or mark definitively absent.
            The trust gate (web/lib/trust-gate.ts) routes these:
              - confirmed/edited → admit to engine
              - skipped          → drop with reason "clinician skipped"
              - rejected         → routed to definitively_absent channel
                                   (NOT engine input — engine never sees
                                   a dose the clinician asserted didn't
                                   happen). Reject requires a reason. */}
        {amber && !resolved && !skipped && !rejected && !rejectOpen && (
          <div
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: H.meta,
              }}
            >
              Click a cell to correct, or
            </span>
            <button
              type="button"
              onClick={onAcknowledge}
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
              Keep as read
            </button>
            <button
              type="button"
              onClick={onSkip}
              title="Skip — do not include in this reconciliation. The visit stays unreviewed."
              style={{
                padding: "6px 14px",
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: H.meta,
                background: "transparent",
                border: `1px solid ${H.stone}`,
                cursor: "pointer",
              }}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              title="Reject — assert this dose was definitively NOT given. Requires a reason; logged to the audit trail and excluded from reconciliation."
              style={{
                padding: "6px 14px",
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: H.bad,
                background: "transparent",
                border: `1px solid ${H.bad}`,
                cursor: "pointer",
              }}
            >
              Reject
            </button>
          </div>
        )}

        {/* Reject reason inline editor — required by the trust gate. */}
        {rejectOpen && !rejected && (
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              background: H.badSoft,
              border: `1px solid ${H.bad}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <label
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: H.bad,
              }}
            >
              Reason for rejecting this dose (required)
            </label>
            <input
              autoFocus
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. parent confirmed dose was not given"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRejectOpen(false);
                  setRejectReason("");
                }
              }}
              style={{
                width: "100%",
                fontFamily: F.sans,
                fontSize: 13,
                padding: "6px 8px",
                background: "#fff",
                border: `1px solid ${H.bad}`,
                color: H.ink,
                outline: "none",
                borderRadius: 0,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason("");
                }}
                style={{
                  padding: "6px 12px",
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: H.meta,
                  background: "transparent",
                  border: `1px solid ${H.stone}`,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectReason.trim() === ""}
                onClick={() => {
                  const reason = rejectReason.trim();
                  if (reason === "") return;
                  onReject(reason);
                  setRejectOpen(false);
                  setRejectReason("");
                }}
                style={{
                  padding: "6px 12px",
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: rejectReason.trim() === "" ? H.faint : "#FFFDF7",
                  background: rejectReason.trim() === "" ? H.stone : H.bad,
                  border: "none",
                  cursor: rejectReason.trim() === "" ? "not-allowed" : "pointer",
                }}
              >
                Confirm reject
              </button>
            </div>
          </div>
        )}

        {amber && resolved && !skipped && !rejected && (
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: H.ok,
              textAlign: "right",
            }}
          >
            ✓ Reviewed
          </div>
        )}

        {skipped && (
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: H.meta,
              textAlign: "right",
            }}
          >
            ⊘ Skipped — not included in reconciliation
          </div>
        )}

        {rejected && (
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: H.bad,
              textAlign: "right",
            }}
          >
            ✕ Rejected as definitively absent
            {row.clinician_reason ? ` — ${row.clinician_reason}` : ""}
          </div>
        )}
      </div>
    </article>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: H.meta,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

interface EditableValueProps {
  value: string;
  editing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  onEditStart: () => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder?: string;
  mono?: boolean;
  size?: "md" | "lg";
  /** Native input type. "date" gives a browser date picker enforcing
   * YYYY-MM-DD wire format; "number" a numeric spinner; default text. */
  inputType?: "text" | "date" | "number";
}

function EditableValue({
  value,
  editing,
  draft,
  setDraft,
  onEditStart,
  onCommit,
  onCancel,
  placeholder,
  mono,
  size = "md",
  inputType = "text",
}: EditableValueProps) {
  if (editing) {
    return (
      <input
        autoFocus
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        min={inputType === "number" ? 1 : undefined}
        max={inputType === "number" ? 10 : undefined}
        style={{
          width: "100%",
          fontFamily: mono ? F.mono : F.sans,
          fontSize: size === "lg" ? 16 : 13,
          padding: "6px 8px",
          background: "#fff",
          border: `1px solid ${H.copper}`,
          color: H.ink,
          outline: "none",
          borderRadius: 0,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onEditStart}
      title="Click to edit"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        fontFamily: mono ? F.mono : F.sans,
        fontSize: size === "lg" ? 16 : 13,
        color: value ? H.ink : H.faint,
        background: "transparent",
        border: `1px solid ${H.ruleSoft}`,
        borderRadius: 0,
        cursor: "text",
      }}
    >
      {value || placeholder || "—"}
    </button>
  );
}

function KindPill({ kind }: { kind: "booster" | "birth" }) {
  const label = kind === "booster" ? "Booster" : "Birth dose";
  return (
    <span
      aria-label={`Dose class: ${label}`}
      style={{
        fontFamily: F.mono,
        fontSize: 9.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: H.copperInk,
        padding: "3px 8px",
        background: H.paper2,
        border: `1px solid ${H.copper}`,
        borderRadius: 0,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const amber = confidence < CONFIDENCE_THRESHOLD;
  const color = amber ? H.amber : H.ok;
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        padding: "4px 10px",
        background: amber ? H.amberSoft : H.paper2,
        border: `1px solid ${color}`,
        whiteSpace: "nowrap",
      }}
    >
      {fmtConfidence(confidence)} confidence
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ParsedResults({
  rows,
  imageUrl,
  onRowsChanged,
  onProceed,
  onReparse,
  reparsing,
  headerSlot,
  documentIntelligence,
}: ParsedResultsProps) {
  /** Rows the clinician explicitly acknowledged with "Keep as read".
   * Stored as row indices. An edit resolves the row implicitly. */
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
  /** Rows the clinician edited (any cell). Stored as row indices. */
  const [edited, setEdited] = useState<Set<number>>(new Set());

  const amberCount = useMemo(
    () => rows.reduce((n, r) => n + (isAmber(r) ? 1 : 0), 0),
    [rows],
  );

  const isResolved = useCallback(
    (index: number, row: ParsedCardRow) => {
      const action = row.clinician_action ?? "none";
      // Skip / reject are explicit clinician decisions — they resolve
      // the row even on a high-confidence read (e.g., the model read a
      // dose the parent denies was given).
      if (action === "skipped" || action === "rejected") return true;
      if (!isAmber(row)) return true;
      return acknowledged.has(index) || edited.has(index);
    },
    [acknowledged, edited],
  );

  const unresolvedCount = useMemo(
    () =>
      rows.reduce(
        (n, r, i) => n + (isAmber(r) && !isResolved(i, r) ? 1 : 0),
        0,
      ),
    [rows, isResolved],
  );

  const handleEdit = useCallback(
    (rowIndex: number, field: CellField, value: string) => {
      const before = rows[rowIndex];
      const after = applyEdit(before, field, value);
      if (
        before.antigen === after.antigen &&
        before.date === after.date &&
        before.doseNumber === after.doseNumber &&
        (before.lotNumber ?? null) === (after.lotNumber ?? null)
      ) {
        // No actual change — don't mark edited (prevents acknowledging
        // by clicking a cell and pressing Enter on unchanged text).
        return;
      }
      const next = [...rows];
      next[rowIndex] = after;
      onRowsChanged(next);
      setEdited((prev) => {
        const copy = new Set(prev);
        copy.add(rowIndex);
        return copy;
      });
    },
    [rows, onRowsChanged],
  );

  const handleAcknowledge = useCallback((rowIndex: number) => {
    setAcknowledged((prev) => {
      const copy = new Set(prev);
      copy.add(rowIndex);
      return copy;
    });
  }, []);

  /** Mark a row as "skipped" — the trust gate drops it with reason
   * "clinician skipped". The row is no longer engine input but the
   * card history retains its visible position. */
  const handleSkip = useCallback(
    (rowIndex: number) => {
      const next = [...rows];
      next[rowIndex] = {
        ...next[rowIndex],
        clinician_action: "skipped",
        clinician_action_at: new Date().toISOString(),
      };
      onRowsChanged(next);
    },
    [rows, onRowsChanged],
  );

  /** Mark a row as "rejected" — definitively absent. The trust gate
   * routes this to the definitively_absent channel, NOT the engine.
   * `reason` is non-empty (the modal disables Confirm otherwise). */
  const handleReject = useCallback(
    (rowIndex: number, reason: string) => {
      const trimmed = reason.trim();
      if (trimmed === "") return;
      const next = [...rows];
      next[rowIndex] = {
        ...next[rowIndex],
        clinician_action: "rejected",
        clinician_action_at: new Date().toISOString(),
        clinician_reason: trimmed,
      };
      onRowsChanged(next);
    },
    [rows, onRowsChanged],
  );

  // Evidence merge runs on every render — it's a pure pass-through on
  // rows, so the cost is negligible and the warnings stay in sync with
  // the latest clinician edits. We surface the merge warnings inside
  // the trace panel, not in the main review flow — safety gates remain
  // the only path that blocks Proceed.
  const mergeResult = useMemo(
    () => mergeEvidenceIntoRows(documentIntelligence ?? null, rows),
    [documentIntelligence, rows],
  );

  const proceedEnabled = unresolvedCount === 0 && rows.length > 0;

  // Template-inferred banner — shown when ANY row was synthesised from
  // a recognised template (rather than read by the vision pass). The
  // clinician needs to know so they don't trust dose numbers or dates
  // the model never actually confirmed.
  const templateInferredCount = useMemo(
    () => rows.filter((r) => r.source === "template_inferred").length,
    [rows],
  );
  const templateDisplayName = useMemo(() => {
    if (!documentIntelligence) return null;
    switch (documentIntelligence.recognized_template_id) {
      case "egypt_mohp_mandatory_childhood_immunization":
        return "Egyptian MoHP mandatory childhood immunization (التطعيمات الإجبارية)";
      case "who_icvp_international_certificate":
        return "WHO/IHR International Certificate of Vaccination or Prophylaxis (ICVP)";
      default:
        return null;
    }
  }, [documentIntelligence]);

  // Re-parse guard: if the clinician has corrections in flight, warn
  // before the fresh parse blows them away. edited.size is the
  // authoritative "has unsaved corrections" signal — acknowledgement
  // does not count (no value changed).
  const hasCorrections = edited.size > 0;
  const handleReparseClick = useCallback(() => {
    if (!onReparse || reparsing) return;
    if (hasCorrections) {
      const ok = window.confirm(
        "Re-parsing will replace current extracted rows. Continue?",
      );
      if (!ok) return;
    }
    void onReparse();
  }, [onReparse, reparsing, hasCorrections]);

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
            Phase D · extraction review
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
            {rows.length === 0
              ? "No rows extracted"
              : `${rows.length} row${rows.length === 1 ? "" : "s"} read from the card`}
          </h2>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.08em",
              color:
                rows.length === 0
                  ? H.amber
                  : amberCount > 0
                    ? H.amber
                    : H.meta,
            }}
          >
            {rows.length === 0
              ? "No rows to review"
              : amberCount === 0
                ? "All rows confident"
                : unresolvedCount === 0
                  ? `${amberCount} flagged · all reviewed`
                  : `${unresolvedCount} of ${amberCount} flagged row${amberCount === 1 ? "" : "s"} awaiting review`}
          </div>
          {onReparse && (
            <button
              type="button"
              onClick={handleReparseClick}
              disabled={reparsing}
              title={
                hasCorrections
                  ? "Re-run the vision pass with the current rules. Your edits will be replaced after confirmation."
                  : "Re-run the vision pass with the current rules."
              }
              style={{
                padding: "6px 12px",
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: reparsing ? H.faint : H.copperInk,
                background: "transparent",
                border: `1px solid ${reparsing ? H.stone : H.copper}`,
                cursor: reparsing ? "not-allowed" : "pointer",
              }}
            >
              {reparsing ? "Re-parsing…" : "Re-parse with current rules"}
            </button>
          )}
        </div>
      </header>

      {/* Optional Remotion / explainer slot reserved for step 10. */}
      {headerSlot && (
        <div
          style={{
            padding: "12px 20px",
            borderBottom: `1px solid ${H.rule}`,
            background: H.card,
          }}
        >
          {headerSlot}
        </div>
      )}

      {/* Visit summary — grouped view above the row detail list. */}
      {rows.length > 0 && (
        <VisitSummary rows={rows} />
      )}

      {/* Row list */}
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Template-inferred rows banner — judges see that the row list
            below was synthesised from a recognised template, not read
            directly. Shown above the row list, not in place of it. */}
        {templateInferredCount > 0 && (
          <TemplateInferredBanner
            count={templateInferredCount}
            templateName={templateDisplayName}
          />
        )}
        {rows.length === 0 && documentIntelligence &&
          documentIntelligence.evidence_fragments.length > 0 && (
            <EmptyRowsAmberReview layout={documentIntelligence} />
          )}
        {rows.length === 0 && (!documentIntelligence ||
          documentIntelligence.evidence_fragments.length === 0) && (
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 14,
              color: H.faint,
              padding: "18px 0",
              textAlign: "center",
            }}
          >
            The vision pass returned no rows. Check the image or retry.
          </div>
        )}
        {rows.map((r, i) => (
          <RowCard
            key={r.row_id ?? i}
            index={i}
            row={r}
            imageUrl={imageUrl}
            resolved={isResolved(i, r)}
            onEdit={(field, value) => handleEdit(i, field, value)}
            onAcknowledge={() => handleAcknowledge(i)}
            onSkip={() => handleSkip(i)}
            onReject={(reason) => handleReject(i, reason)}
          />
        ))}
      </div>

      {/* CrossBeam-inspired document intelligence trace. Collapsible —
          judges see the reasoning, clinicians can fold it away. Does
          NOT gate Proceed: safety gates own that path. */}
      {(documentIntelligence || mergeResult.warnings.length > 0) && (
        <DocumentIntelligenceTrace
          layout={documentIntelligence}
          mergeWarnings={mergeResult.warnings}
          usedFallback={mergeResult.used_fallback}
        />
      )}

      {/* Proceed footer */}
      {onProceed && rows.length > 0 && (
        <footer
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${H.rule}`,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 14,
            background: H.card,
          }}
        >
          {!proceedEnabled && (
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: H.amber,
              }}
            >
              {unresolvedCount} row{unresolvedCount === 1 ? "" : "s"} unresolved
            </span>
          )}
          <button
            type="button"
            onClick={onProceed}
            disabled={!proceedEnabled}
            style={{
              padding: "10px 22px",
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#FFFDF7",
              background: proceedEnabled ? H.copper : H.stone,
              border: "none",
              cursor: proceedEnabled ? "pointer" : "not-allowed",
            }}
          >
            Cross-check against WHO rules →
          </button>
        </footer>
      )}
    </section>
  );
}

// ── Document intelligence trace ──────────────────────────────────────────────

interface DocumentIntelligenceTraceProps {
  layout: LayoutAnalysisResult | undefined;
  mergeWarnings: string[];
  usedFallback: boolean;
}

function DocumentIntelligenceTrace({
  layout,
  mergeWarnings,
  usedFallback,
}: DocumentIntelligenceTraceProps) {
  const [open, setOpen] = useState(false);

  const regionCount = layout?.regions.length ?? 0;
  const tableRegions =
    layout?.regions.filter(
      (r) => r.kind === "vaccine_table" || r.kind === "vaccine_row",
    ) ?? [];
  const rowLabelFragments =
    layout?.evidence_fragments.filter((f) => f.kind === "row_label") ?? [];
  const dateFragments =
    layout?.evidence_fragments.filter((f) => f.kind === "date_cell") ?? [];

  // Short summary for the collapsed title — judges can read it at a
  // glance, then expand for the full audit trail.
  const summary = usedFallback
    ? "trace unavailable · direct parse used"
    : `${layout?.pages_detected ?? 1} page · ${regionCount} regions · ` +
      `${rowLabelFragments.length} row-label + ${dateFragments.length} date evidence`;

  return (
    <section
      style={{
        borderTop: `1px solid ${H.rule}`,
        background: H.paper2,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "transparent",
          border: "none",
          borderBottom: open ? `1px solid ${H.rule}` : "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: H.copperInk,
            }}
          >
            Document intelligence trace
          </div>
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 13,
              color: H.meta,
              lineHeight: 1.45,
            }}
          >
            {summary}
          </div>
        </div>
        <span
          aria-hidden
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: H.copper,
            letterSpacing: "0.12em",
          }}
        >
          {open ? "HIDE ↑" : "SHOW ↓"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p
            style={{
              fontFamily: F.serif,
              fontSize: 13,
              color: H.meta,
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            Hathor decomposes the card into layout regions before clinical
            validation. Low-confidence evidence remains AMBER until
            clinician review.
          </p>

          {/* Page-level banners */}
          {layout?.orientation_warning && (
            <TraceBanner
              label="Orientation"
              value={layout.orientation_warning}
            />
          )}
          {layout?.crop_warning && (
            <TraceBanner label="Crop" value={layout.crop_warning} />
          )}
          {usedFallback && (
            <TraceBanner
              label="Fallback"
              value="No layout trace returned — direct parse is in effect. Every row still passes both safety gates."
            />
          )}

          {/* Stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
            }}
          >
            <TraceStat
              label="Pages"
              value={String(layout?.pages_detected ?? 1)}
            />
            <TraceStat
              label="Regions"
              value={String(regionCount)}
            />
            <TraceStat
              label="Table / row regions"
              value={String(tableRegions.length)}
            />
            <TraceStat
              label="Row-label evidence"
              value={String(rowLabelFragments.length)}
            />
            <TraceStat
              label="Date-cell evidence"
              value={String(dateFragments.length)}
            />
            <TraceStat
              label="Overall confidence"
              value={
                layout
                  ? `${Math.round(layout.overall_confidence * 100)}%`
                  : "—"
              }
            />
          </div>

          {/* Row-label evidence list */}
          {rowLabelFragments.length > 0 && (
            <TraceFragmentList
              title="Printed row-label evidence"
              fragments={rowLabelFragments.map((f) => ({
                primary: f.row_label ?? f.source_text ?? "(no text)",
                secondary:
                  f.source_text && f.source_text !== f.row_label
                    ? f.source_text
                    : null,
                confidence: f.confidence,
                warnings: f.warnings,
              }))}
            />
          )}

          {/* Date-cell evidence list */}
          {dateFragments.length > 0 && (
            <TraceFragmentList
              title="Date-cell evidence"
              fragments={dateFragments.map((f) => ({
                primary: f.raw_date_text ?? f.source_text ?? "(no text)",
                secondary: null,
                confidence: f.confidence,
                warnings: f.warnings,
              }))}
            />
          )}

          {/* Merge + layout warnings */}
          {(mergeWarnings.length > 0 || (layout?.warnings.length ?? 0) > 0) && (
            <div
              style={{
                border: `1px solid ${H.amberLine}`,
                borderLeft: `3px solid ${H.amber}`,
                background: H.amberSoft,
                padding: "10px 14px",
                fontFamily: F.mono,
                fontSize: 11.5,
                color: H.amber,
                lineHeight: 1.55,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Warnings
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {layout?.warnings.map((w, i) => (
                  <li key={`lw${i}`}>{w}</li>
                ))}
                {mergeWarnings.map((w, i) => (
                  <li key={`mw${i}`}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TraceBanner({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: `1px solid ${H.amberLine}`,
        borderLeft: `3px solid ${H.amber}`,
        background: H.amberSoft,
        padding: "8px 14px",
        fontFamily: F.serif,
        fontSize: 13,
        color: H.ink2,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: H.amber,
          marginRight: 8,
        }}
      >
        {label}
      </span>
      {value}
    </div>
  );
}

function TraceStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: H.meta,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 16, color: H.ink }}>
        {value}
      </div>
    </div>
  );
}

/** Banner shown above the row list when rows were synthesised from a
 * recognised template. Judges see the provenance at a glance; the
 * clinician is reminded each row must still be confirmed before the
 * engine is allowed to run. This banner does NOT gate Proceed —
 * the existing AMBER review logic already blocks Proceed because
 * template-inferred rows are < 0.85 confidence. */
function TemplateInferredBanner({
  count,
  templateName,
}: {
  count: number;
  templateName: string | null;
}) {
  return (
    <div
      role="status"
      style={{
        border: `1px solid ${H.amberLine}`,
        borderLeft: `3px solid ${H.copper}`,
        background: H.paper2,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: H.copperInk,
        }}
      >
        Template inferred · clinician review required
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 14, color: H.ink, lineHeight: 1.5 }}>
        {count} row{count === 1 ? "" : "s"} below{" "}
        {count === 1 ? "was" : "were"} synthesised from the recognised
        template{templateName ? ` — ${templateName}` : ""} using date-cell
        evidence. The vision pass could not confirm the printed row
        labels, so each row is AMBER and must be confirmed or corrected
        before proceeding to validation.
      </div>
    </div>
  );
}

/** When the vision pass returned 0 rows but the trace has evidence,
 * we must NOT silently show "No rows extracted" — the clinician needs
 * to know the pipeline saw SOMETHING. Render an AMBER review table
 * listing the date-cell evidence verbatim so they can re-photograph
 * or enter manually. We do not invent ParsedCardRow values here —
 * inventing rows would launder uncertainty into the downstream engine. */
function EmptyRowsAmberReview({ layout }: { layout: LayoutAnalysisResult }) {
  const dateFragments = layout.evidence_fragments.filter(
    (f) => f.kind === "date_cell",
  );
  const rowLabelFragments = layout.evidence_fragments.filter(
    (f) => f.kind === "row_label",
  );
  // Heuristic document-type guess: the Egyptian MoHP card's mandatory-
  // immunizations title is a reliable template signal when present.
  const templateRegion = layout.regions.find((r) =>
    r.source_text?.includes("التطعيمات الإجبارية"),
  );
  return (
    <article
      role="status"
      style={{
        border: `1px solid ${H.amberLine}`,
        borderLeft: `3px solid ${H.amber}`,
        background: H.amberSoft,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: H.amber,
        }}
      >
        AMBER · clinician review required
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 15, color: H.ink }}>
        {templateRegion
          ? "Egyptian MoHP mandatory-immunizations card recognised, but no vaccine rows were auto-extracted."
          : "Card layout detected, but no vaccine rows were auto-extracted."}
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: F.serif,
          fontSize: 13,
          color: H.mute,
          lineHeight: 1.55,
        }}
      >
        Hathor saw {dateFragments.length} date cell
        {dateFragments.length === 1 ? "" : "s"} and {rowLabelFragments.length}{" "}
        row-label entries in the document intelligence trace. No row data is
        forwarded to the rules engine because no antigen or dose position was
        confirmed. Please re-photograph the card, re-parse with current rules,
        or transcribe doses manually before continuing.
      </p>
      {dateFragments.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: "8px 12px",
            background: H.card,
            border: `1px solid ${H.rule}`,
            maxHeight: 220,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {dateFragments.map((f, i) => (
            <li
              key={f.fragment_id || i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontFamily: F.mono,
                fontSize: 12,
                color: H.ink2,
              }}
            >
              <span>
                {i + 1}. {f.raw_date_text ?? f.source_text ?? "(no text)"}
              </span>
              <span
                style={{
                  color: f.confidence < 0.85 ? H.amber : H.ok,
                }}
              >
                {Math.round(f.confidence * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.1em",
          color: H.meta,
        }}
      >
        Neither Proceed nor Export is enabled — two-gate safety model in
        effect.
      </div>
    </article>
  );
}

function TraceFragmentList({
  title,
  fragments,
}: {
  title: string;
  fragments: Array<{
    primary: string;
    secondary: string | null;
    confidence: number;
    warnings: string[];
  }>;
}) {
  return (
    <div
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${H.rule}`,
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: H.copperInk,
        }}
      >
        {title}
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {fragments.map((f, i) => (
          <li
            key={i}
            style={{
              padding: "8px 12px",
              borderTop: i === 0 ? "none" : `1px solid ${H.ruleSoft}`,
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 12.5,
                  color: H.ink,
                  wordBreak: "break-word",
                }}
              >
                {f.primary}
              </div>
              {f.secondary && (
                <div
                  style={{
                    fontFamily: F.serif,
                    fontSize: 12,
                    color: H.faint,
                    fontStyle: "italic",
                    marginTop: 2,
                  }}
                >
                  {f.secondary}
                </div>
              )}
              {f.warnings.map((w, j) => (
                <div
                  key={j}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10.5,
                    color: H.amber,
                    marginTop: 2,
                    letterSpacing: "0.04em",
                  }}
                >
                  ⚠ {w}
                </div>
              ))}
            </div>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 10.5,
                color: f.confidence < 0.85 ? H.amber : H.ok,
                letterSpacing: "0.1em",
                whiteSpace: "nowrap",
              }}
            >
              {Math.round(f.confidence * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Visit summary (grouped view) ─────────────────────────────────────────────

function VisitSummary({ rows }: { rows: ParsedCardRow[] }) {
  const grouped = useMemo(() => groupVisits(rows), [rows]);
  if (grouped.groups.length === 0) return null;

  return (
    <section
      data-testid="visit-summary"
      style={{
        padding: "16px 20px",
        borderBottom: `1px solid ${H.rule}`,
        background: H.card,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: H.copperInk,
          marginBottom: 8,
        }}
      >
        Visits read from card
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {grouped.groups.map((group, i) => {
          const review = group.needsReview;
          const colour = review ? H.amber : H.ok;
          return (
            <li
              key={`${group.isoDate ?? "null"}-${i}`}
              data-testid={`visit-group-${group.isoDate ?? "no-date"}`}
              data-visit-count={group.count}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                gap: 12,
                alignItems: "baseline",
                padding: "6px 10px",
                background: review ? H.amberSoft : H.paper2,
                borderLeft: `2px solid ${colour}`,
              }}
            >
              <span
                style={{
                  fontFamily: F.serif,
                  fontSize: 14.5,
                  color: H.ink,
                }}
              >
                {formatVisitDate(group)}
              </span>
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 11,
                  color: H.meta,
                  letterSpacing: "0.06em",
                }}
              >
                {group.count} dose{group.count === 1 ? "" : "s"} recorded
              </span>
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: colour,
                }}
              >
                {review ? "Needs review" : "Confirmed"}
              </span>
            </li>
          );
        })}
      </ul>
      {grouped.collapsedFragmentDuplicates > 0 && (
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10.5,
            color: H.faint,
            letterSpacing: "0.04em",
            marginTop: 6,
          }}
        >
          {grouped.collapsedFragmentDuplicates} duplicate OCR detection
          {grouped.collapsedFragmentDuplicates === 1 ? "" : "s"} collapsed
          from the same evidence fragment.
        </div>
      )}
    </section>
  );
}
