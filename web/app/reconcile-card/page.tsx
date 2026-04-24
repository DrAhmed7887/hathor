"use client";

import { useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { streamSSE } from "@/lib/sse-parser";
import { type HITLRequiredPayload, type PhaseECompletePayload } from "@/lib/api";
import { HITLPanel } from "@/components/HITLPanel";
import { PhaseEPanel } from "@/components/PhaseEPanel";
import { type Recommendation as PhaseERecommendation } from "@/components/RecommendationCard";

// ── Pharos design system ─────────────────────────────────────────────────────

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
  badSoft:   "#F3E3DF",
};

const F = {
  serif:  "Georgia, 'Times New Roman', serif",
  sans:   "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:   "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  arabic: "'SF Arabic', 'Geeza Pro', 'Traditional Arabic', 'Noto Naskh Arabic', serif",
};

const API_BASE = "http://localhost:8000";

// ── Shared micro-components ──────────────────────────────────────────────────

function MetaSpan({
  children,
  color = H.meta,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function PharosGlyph({ size = 32, color = H.copperInk }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block" }} aria-hidden>
      <line x1="4" y1="44" x2="44" y2="44" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      <rect x="14" y="30" width="20" height="13" fill="none" stroke={color} strokeWidth="1.25" />
      <rect x="17" y="19" width="14" height="11" fill="none" stroke={color} strokeWidth="1.25" />
      <rect x="20" y="11" width="8"  height="8"  fill="none" stroke={color} strokeWidth="1.25" />
      <circle cx="24" cy="8" r="1.75" fill={color} />
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.85">
        <line x1="24"   y1="5"   x2="24"   y2="2"   />
        <line x1="20.5" y1="6.5" x2="18.5" y2="4.5" />
        <line x1="27.5" y1="6.5" x2="29.5" y2="4.5" />
      </g>
    </svg>
  );
}

function HathorMark({ size = 48 }: { size?: number }) {
  const arabicRatio = size <= 36 ? 0.52 : size <= 56 ? 0.42 : 0.32;
  const ruleWidth   = size <= 36 ? 32 : size <= 56 ? 48 : 64;
  const gapArabic   = Math.max(2, Math.round(size * 0.06));
  const gapRule     = Math.max(4, Math.round(size * 0.12));
  return (
    <div style={{ lineHeight: 1, fontFamily: F.serif }}>
      <div style={{ fontFamily: F.arabic, fontSize: Math.round(size * arabicRatio), color: H.meta, direction: "rtl", marginBottom: gapArabic }}>حتحور</div>
      <div style={{ height: 1, background: H.copper, width: ruleWidth, marginBottom: gapRule }} />
      <div style={{ fontSize: size, fontWeight: 400, letterSpacing: size >= 56 ? "-0.03em" : "-0.02em", color: H.ink, lineHeight: 0.92 }}>Hathor</div>
    </div>
  );
}

// ── Tool display helpers ─────────────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, string> = {
  mcp__hathor__extract_vaccinations_from_card: "Reading vaccination card",
  mcp__hathor__compute_age_at_dose:            "Computing age at dose",
  mcp__hathor__lookup_vaccine_equivalence:     "Looking up vaccine equivalence",
  mcp__hathor__get_schedule:                   "Fetching target schedule",
  mcp__hathor__validate_dose:                  "Validating dose",
  mcp__hathor__check_interval_rule:            "Checking interval rule",
  mcp__hathor__compute_missing_doses:          "Computing missing doses",
  mcp__hathor__build_catchup_schedule:         "Building catch-up schedule",
};

function toolDisplayName(name: string) {
  return TOOL_DISPLAY[name] ?? name.replace(/^mcp__\w+__/, "").replace(/_/g, " ");
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ToolState {
  index: number;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "complete" | "error";
  result?: Record<string, unknown>;
}

type ReasoningItem =
  | { type: "thinking";   id: string; text: string }
  | { type: "tool_group"; id: string; indices: number[] }
  | { type: "text";       id: string; text: string }
  | { type: "error";      id: string; message: string };

interface RunStats {
  tool_call_count?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
}

let _id = 0;
const uid = () => String(++_id);

// ── Reasoning panel ──────────────────────────────────────────────────────────

function ToolStation({ tool, active }: { tool: ToolState; active: boolean }) {
  const display = toolDisplayName(tool.name);
  const done = tool.status === "complete";
  const err  = tool.status === "error";
  return (
    <div style={{ paddingBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <MetaSpan color={active ? H.copperInk : H.meta}>Tool · {display}</MetaSpan>
        {active && <MetaSpan color={H.copperInk}>running…</MetaSpan>}
        {done  && <MetaSpan color={H.ok}>✓ done</MetaSpan>}
        {err   && <MetaSpan color={H.bad}>✗ error</MetaSpan>}
      </div>
    </div>
  );
}

function ReasoningPanel({
  items,
  toolMap,
  running,
  collapsed,
  pausedForHITL,
  hitlCount,
  finalPlan,
  onToggle,
}: {
  items: ReasoningItem[];
  toolMap: Record<number, ToolState>;
  running: boolean;
  collapsed: boolean;
  pausedForHITL: boolean;
  hitlCount: number;
  finalPlan: string | null;
  onToggle: () => void;
}) {
  const headerBg    = pausedForHITL ? H.badSoft : H.paper2;
  const headerBorder = pausedForHITL ? H.bad : H.rule;
  const headerLeft  = pausedForHITL ? H.bad : H.stone;

  const collapsedLabel = pausedForHITL
    ? `Paused for review — ${hitlCount} field${hitlCount !== 1 ? "s" : ""} need input`
    : "Agent reasoning · click to expand";

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        style={{
          width: "100%", textAlign: "left",
          background: headerBg,
          border: `1px solid ${headerBorder}`,
          borderLeft: `3px solid ${headerLeft}`,
          padding: "14px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <MetaSpan color={pausedForHITL ? H.bad : H.meta}>{collapsedLabel}</MetaSpan>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: pausedForHITL ? H.bad : H.stone }}>▼</span>
      </button>
    );
  }

  return (
    <div
      style={{
        background: H.paper2,
        border: `1px solid ${headerBorder}`,
        borderLeft: `3px solid ${headerLeft}`,
        padding: "20px 28px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        {pausedForHITL ? (
          <MetaSpan color={H.bad}>
            Paused for review — {hitlCount} field{hitlCount !== 1 ? "s" : ""} need input
          </MetaSpan>
        ) : (
          <MetaSpan>Live reasoning · the agent at work</MetaSpan>
        )}
        <button
          onClick={onToggle}
          style={{
            background: "transparent", border: "none",
            fontFamily: F.mono, fontSize: 10.5,
            letterSpacing: "0.14em", textTransform: "uppercase",
            color: H.faint, cursor: "pointer",
          }}
        >
          Collapse ▲
        </button>
      </div>

      {items.length === 0 && running && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 12px" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: H.copper }} />
          <MetaSpan color={H.copperInk}>Hathor is starting up…</MetaSpan>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item) => {
          if (item.type === "thinking") {
            return (
              <div key={item.id} style={{ paddingBottom: 12 }}>
                <MetaSpan style={{ display: "block", marginBottom: 4 }}>Thinking</MetaSpan>
                <p style={{ fontFamily: F.serif, fontSize: 15, lineHeight: 1.6, fontStyle: "italic", color: H.ink2, margin: 0, maxWidth: "68ch" }}>
                  {item.text.length > 200 ? item.text.slice(0, 200) + "…" : item.text}
                </p>
              </div>
            );
          }
          if (item.type === "tool_group") {
            const tools = item.indices.map((i) => toolMap[i]).filter(Boolean);
            return (
              <div key={item.id} style={{ paddingBottom: 10 }}>
                {tools.length > 1 && <MetaSpan style={{ display: "block", marginBottom: 4 }}>{tools.length} calls · parallel</MetaSpan>}
                {tools.map((t) => <ToolStation key={t.index} tool={t} active={t.status === "pending" && running} />)}
              </div>
            );
          }
          if (item.type === "text") {
            return (
              <p key={item.id} style={{ fontFamily: F.serif, fontSize: 14, lineHeight: 1.6, color: H.ink2, margin: "0 0 10px", maxWidth: "68ch" }}>
                {item.text}
              </p>
            );
          }
          return (
            <div key={item.id} style={{ padding: "8px 12px", background: H.badSoft, border: `1px solid ${H.bad}`, fontFamily: F.mono, fontSize: 12, color: H.bad, marginBottom: 10 }}>
              {item.message}
            </div>
          );
        })}
        {!running && finalPlan && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8 }}>
            <PharosGlyph size={20} color={H.copperInk} />
            <MetaSpan color={H.copperInk}>Reconciliation report assembled.</MetaSpan>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ReconcileCardPage() {
  const [imagePath, setImagePath] = useState("cards/phase_d_demo.jpg");
  const [dob,       setDob]       = useState("2024-06-15");
  const [country,   setCountry]   = useState("Egypt");

  const [running,   setRunning]   = useState(false);
  const [started,   setStarted]   = useState(false);
  const [status,    setStatus]    = useState("Ready");

  const [items,     setItems]     = useState<ReasoningItem[]>([]);
  const [toolMap,   setToolMap]   = useState<Record<number, ToolState>>({});
  const [finalPlan, setFinalPlan] = useState<string | null>(null);
  const [stats,     setStats]     = useState<RunStats | null>(null);

  const [hitlPayload,        setHitlPayload]        = useState<HITLRequiredPayload | null>(null);
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);
  const [phaseE,             setPhaseE]             = useState<PhaseECompletePayload | null>(null);
  const [emittedRecsById,    setEmittedRecsById]    = useState<Record<string, PhaseERecommendation>>({});

  const startTimeRef      = useRef<number>(0);
  const currentGroupIdRef = useRef<string | null>(null);
  const lastItemTypeRef   = useRef<"tool_group" | "other">("other");

  const handleSubmit = useCallback(async () => {
    setRunning(true);
    setStarted(true);
    setItems([]);
    setToolMap({});
    setFinalPlan(null);
    setStats(null);
    setHitlPayload(null);
    setPhaseE(null);
    setEmittedRecsById({});
    setStatus("Starting up");
    setReasoningCollapsed(false);
    currentGroupIdRef.current = null;
    lastItemTypeRef.current   = "other";

    const payload = {
      image_path:     imagePath,
      child_dob:      dob,
      target_country: country,
      model:          "claude-opus-4-7",
    };

    try {
      for await (const sse of streamSSE(`${API_BASE}/reconcile/card`, payload)) {
        const d = sse.data as Record<string, unknown>;

        if (sse.type === "agent_start") {
          startTimeRef.current = Date.now();
          setStatus("Agent starting");
          const m = d.model as string | undefined;
          if (m) setStats((p) => ({ ...(p ?? {}), model: m }));

        } else if (sse.type === "thinking") {
          setStatus("Thinking");
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setItems((p) => [...p, { type: "thinking", id: uid(), text: String(d.text ?? "") }]);

        } else if (sse.type === "tool_use") {
          const idx  = Number(d.index);
          const name = String(d.name ?? "");
          setStatus(toolDisplayName(name));
          const ts: ToolState = { index: idx, name, input: (d.input as Record<string, unknown>) ?? {}, status: "pending" };
          setToolMap((p) => ({ ...p, [idx]: ts }));

          // Capture the Recommendation payload the agent passed to
          // emit_recommendations so we can show the full card later —
          // the phase_e_complete event only carries the ValidationResult.
          if (name === "mcp__hathor__emit_recommendations") {
            const input = (d.input as Record<string, unknown>) ?? {};
            const recsRaw = (input.recommendations as unknown[]) ?? [];
            const byId: Record<string, PhaseERecommendation> = {};
            for (const r of recsRaw) {
              if (r && typeof r === "object") {
                const rec = r as Record<string, unknown>;
                const id = String(rec.recommendation_id ?? "");
                if (id) {
                  byId[id] = {
                    recommendation_id: id,
                    kind: String(rec.kind ?? ""),
                    antigen: String(rec.antigen ?? ""),
                    agent_rationale: String(rec.agent_rationale ?? ""),
                    reasoning: rec.reasoning as string | undefined,
                    agent_confidence: rec.agent_confidence as number | undefined,
                    dose_number: (rec.dose_number as number | null) ?? null,
                    target_date: (rec.target_date as string | null) ?? null,
                    source_dose_indices: Array.isArray(rec.source_dose_indices)
                      ? (rec.source_dose_indices as number[])
                      : [],
                  };
                }
              }
            }
            setEmittedRecsById((prev) => ({ ...prev, ...byId }));
          }

          if (lastItemTypeRef.current === "tool_group" && currentGroupIdRef.current) {
            const gid = currentGroupIdRef.current;
            setItems((p) => p.map((item) =>
              item.type === "tool_group" && item.id === gid
                ? { ...item, indices: [...item.indices, idx] }
                : item
            ));
          } else {
            const newGid = uid();
            currentGroupIdRef.current = newGid;
            lastItemTypeRef.current   = "tool_group";
            setItems((p) => [...p, { type: "tool_group", id: newGid, indices: [idx] }]);
          }

        } else if (sse.type === "tool_result") {
          const idx     = Number(d.index);
          const isError = Boolean(d.is_error);
          const result  = (d.result as Record<string, unknown>) ?? {};
          setToolMap((p) => ({
            ...p,
            [idx]: p[idx] ? { ...p[idx], status: isError ? "error" : "complete", result } : p[idx],
          }));

        } else if (sse.type === "assistant_text") {
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setItems((p) => [...p, { type: "text", id: uid(), text: String(d.text ?? "") }]);

        } else if (sse.type === "hitl_required") {
          setStatus("Awaiting clinician review");
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          const hp = d as unknown as HITLRequiredPayload;
          setHitlPayload(hp);
          setReasoningCollapsed(true);
          // for-await loop remains blocked here until server resumes after corrections

        } else if (sse.type === "phase_e_complete") {
          setStatus("Phase E verdicts ready");
          const phasePayload = d as unknown as PhaseECompletePayload;
          setEmittedRecsById((prev) => {
            const next: Record<string, PhaseERecommendation> = {
              ...prev,
              ...(phasePayload.recommendations ?? {}),
            };
            for (const result of phasePayload.active_results) {
              if (result.agent_id && prev[result.agent_id]) {
                next[result.recommendation_id] = {
                  ...prev[result.agent_id],
                  recommendation_id: result.recommendation_id,
                };
              }
            }
            return next;
          });
          setPhaseE(phasePayload);

        } else if (sse.type === "hitl_timeout") {
          setStatus("Review timed out");
          setItems((p) => [...p, { type: "error", id: uid(), message: "HITL session expired before corrections were submitted. Please restart." }]);
          setHitlPayload(null);

        } else if (sse.type === "final_plan") {
          setStatus("Report ready");
          setFinalPlan(String(d.markdown ?? ""));
          setReasoningCollapsed(true);
          setHitlPayload(null);
          setToolMap((p) => {
            const n = { ...p };
            for (const k of Object.keys(n)) {
              const key = Number(k);
              if (n[key].status === "pending") n[key] = { ...n[key], status: "complete" };
            }
            return n;
          });

        } else if (sse.type === "run_complete") {
          const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
          const count   = d.tool_call_count as number | undefined;
          const cost    = d.cost_usd != null ? ` · $${Number(d.cost_usd).toFixed(4)}` : "";
          setStatus(`Done in ${elapsed}s · ${count ?? 0} calls${cost}`);
          setStats((p) => ({
            ...(p ?? {}),
            tool_call_count: count,
            cost_usd:      d.cost_usd      as number | undefined,
            input_tokens:  d.input_tokens  as number | undefined,
            output_tokens: d.output_tokens as number | undefined,
          }));

        } else if (sse.type === "error") {
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setStatus("Error");
          setItems((p) => [...p, { type: "error", id: uid(), message: String(d.message ?? "Unknown error") }]);
        }
      }
    } catch (err) {
      setStatus("Connection error");
      setItems((p) => [...p, { type: "error", id: uid(), message: err instanceof Error ? err.message : "Unknown error" }]);
    } finally {
      setRunning(false);
      setToolMap((p) => {
        const n = { ...p };
        for (const k of Object.keys(n)) {
          const key = Number(k);
          if (n[key].status === "pending") n[key] = { ...n[key], status: "complete" };
        }
        return n;
      });
    }
  }, [imagePath, dob, country]);

  function handleHITLConfirmed() {
    setHitlPayload(null);
    setReasoningCollapsed(false);
    setStatus("Resuming…");
    // The for-await loop in handleSubmit is still running and will receive
    // the next SSE events now that the server has resumed.
  }

  const hitlCount = hitlPayload?.hitl_queue.length ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: H.paper, fontFamily: F.sans }}>

      {/* ── Header ── */}
      <header style={{ background: H.paper, borderBottom: `1px solid ${H.rule}`, padding: "40px 48px 28px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", position: "relative" }}>
          <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <MetaSpan color={H.meta}>Pharos · a beacon</MetaSpan>
            <div style={{ width: 1, height: 16, background: H.stone }} />
            <PharosGlyph size={26} />
          </div>
          <HathorMark size={64} />
          <div style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${H.rule}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <MetaSpan>Card-first reconciliation · Phase D safety loop</MetaSpan>
            <MetaSpan color={H.faint}>Built with Claude Opus 4.7</MetaSpan>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 48px" }}>

        {/* ── Form ── */}
        <section style={{ marginBottom: started ? 40 : 0 }}>
          <div style={{ background: H.card, border: `1px solid ${H.rule}`, padding: "36px 40px" }}>
            <div style={{ marginBottom: 24 }}>
              <MetaSpan>Vaccination card · image path</MetaSpan>
              <h2 style={{ fontFamily: F.serif, fontSize: 26, fontWeight: 400, letterSpacing: "-0.016em", lineHeight: 1.2, color: H.ink, margin: "8px 0 0" }}>
                Supply a card path. Hathor reads it.
              </h2>
            </div>

            {/* Demo hint */}
            <div style={{ background: H.paper2, border: `1px solid ${H.rule}`, borderLeft: `3px solid ${H.stone}`, padding: "12px 16px", marginBottom: 24, fontFamily: F.mono, fontSize: 11, color: H.meta, letterSpacing: "0.06em" }}>
              Phase D demo: use <code style={{ color: H.copperInk }}>cards/phase_d_demo.jpg</code> to trigger HITL review.
              Happy path: use <code style={{ color: H.ok }}>cards/demo.jpg</code>.
            </div>

            {/* Image path */}
            <div style={{ marginBottom: 20 }}>
              <Label style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, display: "block", marginBottom: 6 }}>
                Image path (relative to repo root)
              </Label>
              <Input
                type="text"
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                disabled={running}
                placeholder="cards/phase_d_demo.jpg"
                className="rounded-none text-sm bg-white border-[#E7E2DA] focus-visible:ring-[#CC785C]"
                style={{ fontFamily: F.mono }}
              />
            </div>

            {/* DOB + country */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div>
                <Label style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, display: "block", marginBottom: 6 }}>
                  Date of birth
                </Label>
                <Input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  disabled={running}
                  className="rounded-none text-sm bg-white border-[#E7E2DA] focus-visible:ring-[#CC785C]"
                  style={{ fontFamily: F.mono }}
                />
              </div>
              <div>
                <Label style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, display: "block", marginBottom: 6 }}>
                  Target schedule
                </Label>
                <Select value={country} onValueChange={(v) => { if (v) setCountry(v); }} disabled={running}>
                  <SelectTrigger className="rounded-none text-sm bg-white border-[#E7E2DA]" style={{ fontFamily: F.mono }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Egypt" style={{ fontFamily: F.mono }}>Egypt · MoHP EPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Submit */}
            <div style={{ paddingTop: 20, borderTop: `1px solid ${H.rule}`, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 16 }}>
              {started && running && <MetaSpan color={H.copperInk}>{status}</MetaSpan>}
              {!started && (
                <span style={{ fontFamily: F.serif, fontSize: 14, fontStyle: "italic", color: H.meta }}>
                  Phase D vision gate · Claude Opus 4.7
                </span>
              )}
              <button
                onClick={handleSubmit}
                disabled={running || !imagePath.trim() || !dob}
                style={{
                  background: running || !imagePath.trim() || !dob ? H.stone : H.copper,
                  color: "#FFFDF7", border: "none", padding: "14px 26px",
                  fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.18em", textTransform: "uppercase",
                  cursor: running || !imagePath.trim() || !dob ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8, transition: "background 0.2s ease",
                }}
              >
                {running ? (
                  <><Loader2 size={13} className="animate-spin" />Reconciling…</>
                ) : "Reconcile →"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Reasoning panel ── */}
        {started && (
          <section style={{ marginBottom: 32 }}>
            <ReasoningPanel
              items={items}
              toolMap={toolMap}
              running={running}
              collapsed={reasoningCollapsed}
              pausedForHITL={!!hitlPayload && reasoningCollapsed}
              hitlCount={hitlCount}
              finalPlan={finalPlan}
              onToggle={() => setReasoningCollapsed((c) => !c)}
            />
          </section>
        )}

        {/* ── HITL panel ── */}
        {hitlPayload && (
          <section style={{ marginBottom: 32, animation: "hathor-fade-in 0.3s ease-out both" }}>
            <div style={{ marginBottom: 12 }}>
              <MetaSpan color={H.bad}>Clinician input required · Phase D</MetaSpan>
            </div>
            <HITLPanel
              payload={hitlPayload}
              imagePath={imagePath}
              onConfirmed={handleHITLConfirmed}
            />
          </section>
        )}

        {/* ── Phase E panel ── */}
        {phaseE && (
          <section style={{ marginBottom: 32, animation: "hathor-fade-in 0.4s ease-out both" }}>
            <PhaseEPanel
              payload={phaseE}
              recommendations={emittedRecsById}
            />
          </section>
        )}

        {/* ── Report ── */}
        {finalPlan && (
          <section style={{ animation: "hathor-fade-in 0.5s ease-out both" }}>
            <div style={{ marginBottom: 28 }}>
              <MetaSpan color={H.copperInk}>Reconciliation report</MetaSpan>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 8 }}>
                <h2 style={{ fontFamily: F.serif, fontSize: 30, fontWeight: 400, letterSpacing: "-0.018em", lineHeight: 1.15, color: H.ink, margin: 0 }}>
                  Catch-up plan
                </h2>
                <div style={{ height: 1, background: H.copper, width: 64, transform: "translateY(-6px)", flexShrink: 0 }} />
              </div>
            </div>
            <div style={{ background: H.card, border: `1px solid ${H.rule}`, padding: "36px 40px" }}>
              <article className="prose max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 400, color: H.ink, borderBottom: `1px solid ${H.copper}`, paddingBottom: 8, marginTop: 32, marginBottom: 16 }}>{children}</h1>,
                    h2: ({ children }) => <h2 style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 400, color: H.ink, borderBottom: `1px solid ${H.rule}`, paddingBottom: 6, marginTop: 28, marginBottom: 14 }}>{children}</h2>,
                    h3: ({ children }) => <h3 style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: H.meta, marginTop: 20, marginBottom: 10 }}>{children}</h3>,
                    p: ({ children }) => <p style={{ fontFamily: F.serif, fontSize: 15, lineHeight: 1.65, color: H.ink2 }}>{children}</p>,
                    table: ({ children }) => <div style={{ overflowX: "auto", marginBottom: 20 }}><table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F.mono, fontSize: 12 }}>{children}</table></div>,
                    th: ({ children }) => <th style={{ padding: "8px 12px", background: H.paper2, borderBottom: `1px solid ${H.rule}`, color: H.meta, fontWeight: 400, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 10.5, textAlign: "left" }}>{children}</th>,
                    td: ({ children }) => <td style={{ padding: "7px 12px", borderBottom: `1px solid ${H.ruleSoft}`, color: H.ink2, verticalAlign: "top" }}>{children}</td>,
                  }}
                >
                  {finalPlan}
                </ReactMarkdown>
              </article>
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ borderTop: `1px solid ${H.rule}`, background: H.paper, marginTop: 48, padding: "24px 48px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ borderLeft: `3px solid ${H.copper}`, paddingLeft: 16, marginBottom: stats ? 16 : 0 }}>
            <p style={{ fontFamily: F.serif, fontSize: 14, fontStyle: "italic", color: H.mute, margin: 0, lineHeight: 1.6 }}>
              ⚕️ Decision support only — not a prescription. Final catch-up schedule must be confirmed by a licensed paediatrician.
            </p>
          </div>
          {stats && (
            <p style={{ fontFamily: F.mono, fontSize: 10.5, color: H.faint, letterSpacing: "0.08em", marginTop: 12 }}>
              {stats.tool_call_count} tool calls · {stats.input_tokens?.toLocaleString()} input · {stats.output_tokens?.toLocaleString()} output tokens
              {stats.cost_usd != null ? ` · $${stats.cost_usd.toFixed(4)}` : ""}
              {stats.model ? ` · ${stats.model}` : " · claude-opus-4-7"}
            </p>
          )}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${H.rule}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <MetaSpan>Cross-border immunization reconciliation</MetaSpan>
            <MetaSpan color={H.faint}>MIT licensed · Anthropic Claude Agent SDK</MetaSpan>
          </div>
        </div>
      </footer>
    </div>
  );
}
