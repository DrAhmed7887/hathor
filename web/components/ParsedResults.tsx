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
  /** Optional slot above the row list. Reserved for step 10 to inject
   * the ExplainerParse Remotion composition without this component
   * depending on Remotion itself. */
  headerSlot?: React.ReactNode;
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
}

function RowCard({
  index,
  row,
  imageUrl,
  resolved,
  onEdit,
  onAcknowledge,
}: RowCardProps) {
  const amber = isAmber(row);
  const [editing, setEditing] = useState<CellField | null>(null);
  const [draft, setDraft] = useState("");

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
              placeholder="—"
              mono
              inputType="number"
            />
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

        {/* Acknowledge control — only shown for amber rows that aren't
            already resolved via an edit. */}
        {amber && !resolved && (
          <div
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "flex-end",
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
          </div>
        )}

        {amber && resolved && (
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
  headerSlot,
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

  const proceedEnabled = unresolvedCount === 0 && rows.length > 0;

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
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.08em",
            color: amberCount > 0 ? H.amber : H.meta,
          }}
        >
          {amberCount === 0
            ? "All rows confident"
            : unresolvedCount === 0
              ? `${amberCount} flagged · all reviewed`
              : `${unresolvedCount} of ${amberCount} flagged row${amberCount === 1 ? "" : "s"} awaiting review`}
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

      {/* Row list */}
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {rows.length === 0 && (
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
            key={i}
            index={i}
            row={r}
            imageUrl={imageUrl}
            resolved={isResolved(i, r)}
            onEdit={(field, value) => handleEdit(i, field, value)}
            onAcknowledge={() => handleAcknowledge(i)}
          />
        ))}
      </div>

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
