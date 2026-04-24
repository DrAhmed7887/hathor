"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { streamSSE } from "@/lib/sse-parser";

// ── Pharos design system ────────────────────────────────────────────────────

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

function PharosGlyph({
  size = 32,
  color = H.copperInk,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
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
  const ruleWidth   = size <= 36 ? 32  : size <= 56 ? 48  : 64;
  const gapArabic   = Math.max(2, Math.round(size * 0.06));
  const gapRule     = Math.max(4, Math.round(size * 0.12));

  return (
    <div style={{ lineHeight: 1, fontFamily: F.serif }}>
      <div
        style={{
          fontFamily: F.arabic,
          fontSize: Math.round(size * arabicRatio),
          color: H.meta,
          direction: "rtl",
          marginBottom: gapArabic,
        }}
      >
        حتحور
      </div>
      <div
        style={{
          height: 1,
          background: H.copper,
          width: ruleWidth,
          marginBottom: gapRule,
        }}
      />
      <div
        style={{
          fontSize: size,
          fontWeight: 400,
          letterSpacing: size >= 56 ? "-0.03em" : "-0.02em",
          color: H.ink,
          lineHeight: 0.92,
        }}
      >
        Hathor
      </div>
    </div>
  );
}

// ── Tool display ────────────────────────────────────────────────────────────

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

function toolDisplayName(name: string): string {
  return (
    TOOL_DISPLAY[name] ??
    name.replace(/^mcp__\w+__/, "").replace(/_/g, " ")
  );
}

function summarizeToolInput(
  name: string,
  input: Record<string, unknown>
): string {
  switch (name) {
    case "mcp__hathor__compute_age_at_dose":
      return `DOB ${input.date_of_birth} → dose ${input.date_given}`;
    case "mcp__hathor__lookup_vaccine_equivalence":
      return `${input.vaccine_name ?? input.source_vaccine} → ${input.target_country ?? input.country}`;
    case "mcp__hathor__validate_dose":
      return `${input.antigen ?? input.vaccine_name} dose ${input.dose_number}`;
    case "mcp__hathor__check_interval_rule":
      return `${input.antigen}: ${
        Number(input.curr_dose_age_days ?? 0) -
        Number(input.prev_dose_age_days ?? 0)
      }d interval`;
    case "mcp__hathor__get_schedule":
      return `${input.country_code ?? input.country}, age ${input.child_age_months ?? input.age_months} m`;
    case "mcp__hathor__extract_vaccinations_from_card":
      return `Reading ${input.filename ?? "card"}`;
    case "mcp__hathor__compute_missing_doses":
      return "Diffing doses against schedule";
    case "mcp__hathor__build_catchup_schedule":
      return "Planning catch-up";
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}

function summarizeToolResult(
  name: string,
  result: Record<string, unknown>
): string {
  if (result.error) return `Error: ${result.error}`;
  switch (name) {
    case "mcp__hathor__compute_age_at_dose": {
      const days = result.age_days as number | undefined;
      const hr   = result.human_readable as string | undefined;
      return days != null ? `${days} days (${hr ?? ""})` : "Complete";
    }
    case "mcp__hathor__validate_dose":
      if (result.valid === true) return "Valid";
      if (result.valid === false) {
        const r = result.reasons as string[] | undefined;
        return `Invalid: ${r?.[0] ?? "interval too short"}`;
      }
      return "Complete";
    case "mcp__hathor__lookup_vaccine_equivalence": {
      const c =
        (result.components as string[] | undefined) ??
        (result.antigens   as string[] | undefined);
      return Array.isArray(c) && c.length > 0 ? c.join(" + ") : "Complete";
    }
    case "mcp__hathor__check_interval_rule":
      if (result.valid === false)
        return `Invalid (${result.actual_interval_days} < ${result.required_days} d)`;
      if (result.valid === true) return "Valid";
      return "Complete";
    case "mcp__hathor__get_schedule": {
      const doses = result.doses as unknown[] | undefined;
      const count =
        (result.dose_count as number | undefined) ?? doses?.length;
      return count != null ? `${count} doses loaded` : "Complete";
    }
    case "mcp__hathor__compute_missing_doses": {
      const s = result.summary as Record<string, number> | undefined;
      if (s) {
        const gaps = (s.overdue ?? 0) + (s.due_now ?? 0);
        return `${gaps} gaps identified`;
      }
      return "Complete";
    }
    case "mcp__hathor__build_catchup_schedule": {
      const v = result.suggested_visits as unknown[] | undefined;
      if (v) return `${v.length}-visit plan`;
      const n = result.total_doses_needed as number | undefined;
      return n != null ? `${n} doses planned` : "Complete";
    }
    default:
      return "Complete";
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface DoseRow {
  id: string;
  vaccine_trade_name: string;
  date_given: string;
}

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

// ── Constants ───────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";

const DEFAULT_DOSES: Omit<DoseRow, "id">[] = [
  { vaccine_trade_name: "BCG",                       date_given: "2024-06-16" },
  { vaccine_trade_name: "HepB birth dose",           date_given: "2024-06-16" },
  { vaccine_trade_name: "OPV0",                      date_given: "2024-06-16" },
  { vaccine_trade_name: "Pentavalent (DPT-HepB-Hib)", date_given: "2024-07-27" },
  { vaccine_trade_name: "OPV1",                      date_given: "2024-07-27" },
  { vaccine_trade_name: "PCV13",                     date_given: "2024-07-27" },
  { vaccine_trade_name: "Rotavirus",                 date_given: "2024-07-27" },
  { vaccine_trade_name: "Pentavalent (DPT-HepB-Hib)", date_given: "2024-08-24" },
  { vaccine_trade_name: "OPV2",                      date_given: "2024-08-24" },
  { vaccine_trade_name: "PCV13",                     date_given: "2024-08-24" },
  { vaccine_trade_name: "Rotavirus",                 date_given: "2024-08-24" },
  { vaccine_trade_name: "Pentavalent (DPT-HepB-Hib)", date_given: "2024-09-21" },
  { vaccine_trade_name: "OPV3",                      date_given: "2024-09-21" },
  { vaccine_trade_name: "PCV13",                     date_given: "2024-09-21" },
  { vaccine_trade_name: "IPV",                       date_given: "2024-09-21" },
  { vaccine_trade_name: "Measles",                   date_given: "2025-03-15" },
  { vaccine_trade_name: "Yellow Fever",              date_given: "2025-03-15" },
];

const FLAGSHIP_DOB     = "2024-06-15";
const FLAGSHIP_DOSES: Omit<DoseRow, "id">[] = DEFAULT_DOSES;
const FLAGSHIP_COUNTRY = "Egypt";

let _idCtr = 0;
const uid = () => String(++_idCtr);
function makeRow(v: Omit<DoseRow, "id">): DoseRow {
  return { ...v, id: uid() };
}

// ── Pilgrimage path station components ─────────────────────────────────────

type StationKind = "thinking" | "tool" | "text" | "error" | "arrive";

function StationGutter({
  kind,
  active,
  done,
  last,
}: {
  kind: StationKind;
  active: boolean;
  done: boolean;
  last: boolean;
}) {
  const beaconColor = active ? H.copper : done ? H.stone : H.rule;

  return (
    <div style={{ position: "relative", width: 32, flexShrink: 0, paddingTop: 4 }}>
      {!last && (
        <div
          style={{
            position: "absolute",
            left: 15, top: 20, bottom: -28,
            width: 1,
            background: done ? H.stone : H.rule,
            transition: "background 0.4s ease",
          }}
        />
      )}
      {kind === "tool" ? (
        <div
          style={{
            width: 12, height: 12,
            marginLeft: 10, marginTop: 4,
            border: `1.25px solid ${beaconColor}`,
            background: active ? H.copper : "transparent",
            transform: "rotate(45deg)",
            transition: "all 0.3s ease",
          }}
        />
      ) : kind === "arrive" ? (
        <div style={{ marginLeft: 2 }}>
          <PharosGlyph size={28} color={beaconColor} />
        </div>
      ) : (
        <>
          {active && (
            <div
              style={{
                position: "absolute", left: 7, top: 5,
                width: 18, height: 18, borderRadius: "50%",
                background: H.copper, opacity: 0.22,
                animation: "hathor-halo 1.6s ease-in-out infinite",
              }}
            />
          )}
          <div
            style={{
              width: 10, height: 10, borderRadius: "50%",
              background: kind === "error" ? H.bad : beaconColor,
              marginLeft: 11, marginTop: 4,
              transition: "background 0.3s ease",
            }}
          />
        </>
      )}
    </div>
  );
}

function ThinkingStation({ text, active }: { text: string; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.slice(0, 200) + (text.length > 200 ? "…" : "");

  return (
    <div style={{ flex: 1, paddingBottom: 24 }}>
      <div
        style={{
          display: "flex", alignItems: "baseline", gap: 10,
          marginBottom: 8, cursor: text.length > 200 ? "pointer" : "default",
        }}
        onClick={() => text.length > 200 && setExpanded((e) => !e)}
      >
        <MetaSpan color={active ? H.copperInk : H.meta}>Thinking</MetaSpan>
        {active && <MetaSpan color={H.copperInk}>writing…</MetaSpan>}
        {!active && text.length > 200 && (
          <MetaSpan color={H.faint}>{expanded ? "collapse" : "expand"}</MetaSpan>
        )}
      </div>
      <p
        style={{
          fontFamily: F.serif, fontSize: 16, lineHeight: 1.6,
          fontStyle: "italic",
          color: active ? H.ink : H.ink2,
          margin: 0, maxWidth: "68ch",
          cursor: text.length > 200 ? "pointer" : "default",
          transition: "color 0.4s ease",
        }}
        onClick={() => text.length > 200 && setExpanded((e) => !e)}
      >
        {expanded ? text : preview}
      </p>
    </div>
  );
}

function ToolStation({ tool, active }: { tool: ToolState; active: boolean }) {
  const display = toolDisplayName(tool.name);
  const param   = summarizeToolInput(tool.name, tool.input);
  const result  = tool.result
    ? summarizeToolResult(tool.name, tool.result)
    : null;
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
      <div
        style={{
          display: "inline-block",
          background: done || active ? H.card : "transparent",
          border: `1px solid ${active ? H.copper : done ? H.rule : H.ruleSoft}`,
          padding: "8px 12px",
          fontFamily: F.mono, fontSize: 12,
          color: active || done ? H.ink2 : H.faint,
          maxWidth: "100%",
        }}
      >
        <div>{param}</div>
        {result && (done || active) && (
          <div
            style={{
              marginTop: 5, paddingTop: 5,
              borderTop: `1px dashed ${H.rule}`,
              color: active ? H.copperInk : H.mute,
              fontSize: 11.5,
            }}
          >
            → {active ? "…" : result}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolGroupStation({
  indices,
  toolMap,
  active,
}: {
  indices: number[];
  toolMap: Record<number, ToolState>;
  active: boolean;
}) {
  const tools = indices.map((i) => toolMap[i]).filter(Boolean);

  return (
    <div style={{ flex: 1, paddingBottom: 24 }}>
      {tools.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <MetaSpan color={H.meta}>{tools.length} calls · parallel</MetaSpan>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tools.map((tool) => (
          <ToolStation
            key={tool.index}
            tool={tool}
            active={tool.status === "pending" && active}
          />
        ))}
      </div>
    </div>
  );
}

// ── Pilgrimage panel ────────────────────────────────────────────────────────

type StationType =
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool";     id: string; indices: number[] }
  | { kind: "text";     id: string; text: string }
  | { kind: "error";    id: string; message: string }
  | { kind: "arrive";   id: string };

function PilgrimagePanel({
  items,
  toolMap,
  running,
  finalPlan,
  collapsed,
  onToggleCollapse,
}: {
  items: ReasoningItem[];
  toolMap: Record<number, ToolState>;
  running: boolean;
  finalPlan: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        style={{
          width: "100%", textAlign: "left",
          background: H.paper2,
          border: `1px solid ${H.rule}`,
          padding: "14px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <MetaSpan>Agent reasoning · click to expand</MetaSpan>
        <PharosGlyph size={18} color={H.stone} />
      </button>
    );
  }

  const stations: StationType[] = items.map((item): StationType => {
    if (item.type === "thinking")   return { kind: "thinking", id: item.id, text: item.text };
    if (item.type === "tool_group") return { kind: "tool",     id: item.id, indices: item.indices };
    if (item.type === "text")       return { kind: "text",     id: item.id, text: item.text };
    return { kind: "error", id: item.id, message: item.message };
  });

  if (!running && finalPlan) {
    stations.push({ kind: "arrive", id: "arrive" });
  }

  const isLast   = (i: number) => i === stations.length - 1;
  const isActive = (i: number) => running && isLast(i);

  return (
    <div style={{ paddingBottom: 4 }}>
      <div
        style={{
          display: "flex", alignItems: "baseline",
          justifyContent: "space-between", marginBottom: 28,
        }}
      >
        <MetaSpan>Live reasoning · the agent at work</MetaSpan>
        {!running && (
          <button
            onClick={onToggleCollapse}
            style={{
              background: "transparent", border: "none",
              fontFamily: F.mono, fontSize: 10.5,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: H.faint, cursor: "pointer",
            }}
          >
            Collapse
          </button>
        )}
      </div>

      {stations.length === 0 && running && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 16px" }}>
          <div
            style={{
              width: 10, height: 10, borderRadius: "50%",
              background: H.copper,
              animation: "hathor-halo 1.6s ease-in-out infinite",
            }}
          />
          <MetaSpan color={H.copperInk}>Hathor is starting up…</MetaSpan>
        </div>
      )}

      {stations.map((station, i) => (
        <div
          key={station.id}
          className="hathor-station"
          style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
        >
          <StationGutter
            kind={station.kind}
            active={isActive(i)}
            done={!isActive(i)}
            last={isLast(i)}
          />
          {station.kind === "thinking" && (
            <ThinkingStation
              text={(station as Extract<StationType, { kind: "thinking" }>).text}
              active={isActive(i)}
            />
          )}
          {station.kind === "tool" && (
            <ToolGroupStation
              indices={(station as Extract<StationType, { kind: "tool" }>).indices}
              toolMap={toolMap}
              active={isActive(i)}
            />
          )}
          {station.kind === "text" && (
            <div style={{ flex: 1, paddingBottom: 20 }}>
              <p
                style={{
                  fontFamily: F.serif, fontSize: 15, lineHeight: 1.65,
                  color: H.ink2, margin: 0, maxWidth: "68ch",
                }}
              >
                {(station as Extract<StationType, { kind: "text" }>).text}
              </p>
            </div>
          )}
          {station.kind === "error" && (
            <div style={{ flex: 1, paddingBottom: 20 }}>
              <div
                style={{
                  background: H.badSoft,
                  border: `1px solid ${H.bad}`,
                  padding: "8px 12px",
                  fontFamily: F.mono, fontSize: 12, color: H.bad,
                }}
              >
                {(station as Extract<StationType, { kind: "error" }>).message}
              </div>
            </div>
          )}
          {station.kind === "arrive" && (
            <div style={{ flex: 1, paddingBottom: 8 }}>
              <MetaSpan color={H.copperInk}>Arrival</MetaSpan>
              <p
                style={{
                  fontFamily: F.serif, fontSize: 20,
                  letterSpacing: "-0.015em",
                  color: H.ink, margin: "6px 0 0",
                }}
              >
                Reconciliation report assembled.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Animated dots ───────────────────────────────────────────────────────────

function AnimatedDots({ active }: { active: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) { setCount(0); return; }
    const t = setInterval(() => setCount((c) => (c + 1) % 4), 400);
    return () => clearInterval(t);
  }, [active]);
  return <span>{".".repeat(count)}</span>;
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function HathorPage() {
  const [dob,         setDob]         = useState("2024-06-15");
  const [country,     setCountry]     = useState("Egypt");
  const [doses,       setDoses]       = useState<DoseRow[]>(() => DEFAULT_DOSES.map(makeRow));
  const [useFlagship, setUseFlagship] = useState(false);

  const [running,            setRunning]            = useState(false);
  const [status,             setStatus]             = useState("Ready");
  const [items,              setItems]              = useState<ReasoningItem[]>([]);
  const [toolMap,            setToolMap]            = useState<Record<number, ToolState>>({});
  const [finalPlan,          setFinalPlan]          = useState<string | null>(null);
  const [stats,              setStats]              = useState<RunStats | null>(null);
  const [started,            setStarted]            = useState(false);
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);

  const startTimeRef      = useRef<number>(0);
  const currentGroupIdRef = useRef<string | null>(null);
  const lastItemTypeRef   = useRef<"tool_group" | "other">("other");

  const toggleFlagship = (checked: boolean) => {
    setUseFlagship(checked);
    if (checked) {
      setDob(FLAGSHIP_DOB);
      setCountry(FLAGSHIP_COUNTRY);
      setDoses(FLAGSHIP_DOSES.map(makeRow));
    }
  };

  const addDose = () =>
    setDoses((prev) => [
      ...prev,
      makeRow({ vaccine_trade_name: "", date_given: "" }),
    ]);

  const removeDose = (id: string) =>
    setDoses((prev) => prev.filter((d) => d.id !== id));

  const updateDose = (
    id: string,
    field: keyof Omit<DoseRow, "id">,
    value: string
  ) =>
    setDoses((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );

  const handleSubmit = useCallback(async () => {
    setRunning(true);
    setStarted(true);
    setItems([]);
    setToolMap({});
    setFinalPlan(null);
    setStats(null);
    setStatus("Starting up");
    setReasoningCollapsed(false);
    currentGroupIdRef.current = null;
    lastItemTypeRef.current   = "other";

    const payload = {
      child_dob:      dob,
      target_country: country,
      model:          "claude-opus-4-7",
      given_doses: doses
        .filter((d) => d.vaccine_trade_name && d.date_given)
        .map((d) => ({
          vaccine_trade_name: d.vaccine_trade_name,
          date_given:         d.date_given,
          source:             "vaccination card",
        })),
    };

    try {
      for await (const sse of streamSSE(
        `${API_BASE}/reconcile-stream`,
        payload
      )) {
        const d = sse.data as Record<string, unknown>;

        if (sse.type === "agent_start") {
          startTimeRef.current = Date.now();
          setStatus("Starting up");
          const m = d.model as string | undefined;
          if (m) setStats((prev) => ({ ...(prev ?? {}), model: m }));
        } else if (sse.type === "thinking") {
          setStatus("Thinking");
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setItems((prev) => [
            ...prev,
            { type: "thinking", id: uid(), text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "tool_use") {
          const idx  = Number(d.index);
          const name = String(d.name ?? "");
          setStatus(toolDisplayName(name));

          const toolState: ToolState = {
            index: idx, name,
            input: (d.input as Record<string, unknown>) ?? {},
            status: "pending",
          };
          setToolMap((prev) => ({ ...prev, [idx]: toolState }));

          if (
            lastItemTypeRef.current === "tool_group" &&
            currentGroupIdRef.current
          ) {
            const gid = currentGroupIdRef.current;
            setItems((prev) =>
              prev.map((item) =>
                item.type === "tool_group" && item.id === gid
                  ? { ...item, indices: [...item.indices, idx] }
                  : item
              )
            );
          } else {
            const newGroupId = uid();
            currentGroupIdRef.current = newGroupId;
            lastItemTypeRef.current   = "tool_group";
            setItems((prev) => [
              ...prev,
              { type: "tool_group", id: newGroupId, indices: [idx] },
            ]);
          }
        } else if (sse.type === "tool_result") {
          const idx     = Number(d.index);
          const isError = Boolean(d.is_error);
          const result  = (d.result as Record<string, unknown>) ?? {};
          setToolMap((prev) => ({
            ...prev,
            [idx]: prev[idx]
              ? { ...prev[idx], status: isError ? "error" : "complete", result }
              : prev[idx],
          }));
        } else if (sse.type === "assistant_text") {
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setItems((prev) => [
            ...prev,
            { type: "text", id: uid(), text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "final_plan") {
          setStatus("Report ready");
          setFinalPlan(String(d.markdown ?? ""));
          setReasoningCollapsed(true);
          setToolMap((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(next)) {
              const key = Number(k);
              if (next[key].status === "pending")
                next[key] = { ...next[key], status: "complete" };
            }
            return next;
          });
        } else if (sse.type === "run_complete") {
          const elapsed = (
            (Date.now() - startTimeRef.current) / 1000
          ).toFixed(1);
          const count = d.tool_call_count as number | undefined;
          const cost  =
            d.cost_usd != null
              ? ` · $${Number(d.cost_usd).toFixed(4)}`
              : "";
          setStatus(`Done in ${elapsed}s · ${count ?? 0} calls${cost}`);
          setStats((prev) => ({
            ...(prev ?? {}),
            tool_call_count: count,
            cost_usd:     d.cost_usd     as number | undefined,
            input_tokens: d.input_tokens as number | undefined,
            output_tokens:d.output_tokens as number | undefined,
          }));
        } else if (sse.type === "error") {
          lastItemTypeRef.current   = "other";
          currentGroupIdRef.current = null;
          setStatus("Error");
          setItems((prev) => [
            ...prev,
            {
              type:    "error",
              id:      uid(),
              message: String(d.message ?? "Unknown error"),
            },
          ]);
        }
      }
    } catch (err) {
      setStatus("Connection error");
      setItems((prev) => [
        ...prev,
        {
          type:    "error",
          id:      uid(),
          message: err instanceof Error ? err.message : "Unknown error",
        },
      ]);
    } finally {
      setRunning(false);
      setToolMap((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          const key = Number(k);
          if (next[key].status === "pending")
            next[key] = { ...next[key], status: "complete" };
        }
        return next;
      });
    }
  }, [dob, country, doses]);

  return (
    <div style={{ minHeight: "100vh", background: H.paper, fontFamily: F.sans }}>

      {/* ── Header ── */}
      <header
        style={{
          background: H.paper,
          borderBottom: `1px solid ${H.rule}`,
          padding: "40px 48px 28px",
        }}
      >
        <div style={{ maxWidth: 900, margin: "0 auto", position: "relative" }}>
          {/* Pharos badge */}
          <div
            style={{
              position: "absolute", top: 0, right: 0,
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <MetaSpan color={H.meta}>Pharos · a beacon</MetaSpan>
            <div style={{ width: 1, height: 16, background: H.stone }} />
            <PharosGlyph size={26} />
          </div>

          <HathorMark size={64} />

          <div
            style={{
              marginTop: 28, paddingTop: 14,
              borderTop: `1px solid ${H.rule}`,
              display: "flex", justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <MetaSpan>Vaccination reconciliation for migrant families</MetaSpan>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <Link href="/demo" style={{ textDecoration: "none" }}>
                <MetaSpan color={H.copper}>Fast-path demo →</MetaSpan>
              </Link>
              <div style={{ width: 1, height: 10, background: H.stone, alignSelf: "center" }} />
              <Link href="/reconcile-card" style={{ textDecoration: "none" }}>
                <MetaSpan color={H.copper}>Agent flow →</MetaSpan>
              </Link>
              <div style={{ width: 1, height: 10, background: H.stone, alignSelf: "center" }} />
              <MetaSpan color={H.faint}>Built with Claude Opus 4.7</MetaSpan>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 48px" }}>

        {/* ── Form ── */}
        <section style={{ marginBottom: started ? 40 : 0 }}>
          <div
            style={{
              background: H.card,
              border: `1px solid ${H.rule}`,
              padding: "36px 40px",
            }}
          >
            <div style={{ marginBottom: 24 }}>
              <MetaSpan>Child vaccination record</MetaSpan>
              <h2
                style={{
                  fontFamily: F.serif, fontSize: 26, fontWeight: 400,
                  letterSpacing: "-0.016em", lineHeight: 1.2,
                  color: H.ink, margin: "8px 0 0",
                }}
              >
                Bring the doses. We&apos;ll reconcile them.
              </h2>
            </div>

            {/* Flagship toggle */}
            <div
              style={{
                background: useFlagship ? H.paper2 : "transparent",
                border: `1px solid ${useFlagship ? H.copper : H.rule}`,
                borderLeft: `3px solid ${useFlagship ? H.copper : H.stone}`,
                padding: "14px 16px", marginBottom: 24,
                display: "flex", alignItems: "center",
                justifyContent: "space-between",
                transition: "all 0.2s ease",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: F.serif, fontSize: 14.5,
                    color: H.ink, marginBottom: 3,
                  }}
                >
                  Lagos → Cairo demo
                </div>
                <MetaSpan color={H.meta}>
                  Nigerian infant · NPI primary series + Measles + YF · reconcile against Egyptian EPI
                </MetaSpan>
              </div>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
              >
                <MetaSpan color={H.meta}>Use scenario</MetaSpan>
                <input
                  type="checkbox"
                  checked={useFlagship}
                  onChange={(e) => toggleFlagship(e.target.checked)}
                  disabled={running}
                  style={{ width: 14, height: 14, accentColor: H.copper }}
                />
              </label>
            </div>

            {/* DOB + country */}
            <div
              style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: 20, marginBottom: 20,
              }}
            >
              <div>
                <Label
                  style={{
                    fontFamily: F.mono, fontSize: 10.5,
                    letterSpacing: "0.14em", textTransform: "uppercase",
                    color: H.meta, display: "block", marginBottom: 6,
                  }}
                >
                  Date of birth
                </Label>
                <Input
                  type="date"
                  value={dob}
                  onChange={(e) => { setUseFlagship(false); setDob(e.target.value); }}
                  disabled={running}
                  className="rounded-none text-sm bg-white border-[#E7E2DA] focus-visible:ring-[#CC785C]"
                  style={{ fontFamily: F.mono }}
                />
              </div>
              <div>
                <Label
                  style={{
                    fontFamily: F.mono, fontSize: 10.5,
                    letterSpacing: "0.14em", textTransform: "uppercase",
                    color: H.meta, display: "block", marginBottom: 6,
                  }}
                >
                  Target schedule
                </Label>
                <Select
                  value={country}
                  onValueChange={(v) => { setUseFlagship(false); if (v) setCountry(v); }}
                  disabled={running}
                >
                  <SelectTrigger
                    className="rounded-none text-sm bg-white border-[#E7E2DA]"
                    style={{ fontFamily: F.mono }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Egypt" style={{ fontFamily: F.mono }}>
                      Egypt · MoHP EPI
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: H.rule, marginBottom: 20 }} />

            {/* Doses */}
            <div>
              <div
                style={{
                  fontFamily: F.mono, fontSize: 10.5,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  color: H.meta, marginBottom: 12,
                }}
              >
                Given doses
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {doses.map((dose, i) => (
                  <div
                    key={dose.id}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        fontFamily: F.mono, fontSize: 10, color: H.faint,
                        width: 18, textAlign: "right", flexShrink: 0,
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Input
                      placeholder="Trade name (e.g. Pentavalent)"
                      value={dose.vaccine_trade_name}
                      onChange={(e) =>
                        updateDose(dose.id, "vaccine_trade_name", e.target.value)
                      }
                      disabled={running}
                      className="rounded-none text-sm flex-1 bg-white border-[#E7E2DA]"
                      style={{ fontFamily: F.serif }}
                    />
                    <Input
                      type="date"
                      value={dose.date_given}
                      onChange={(e) =>
                        updateDose(dose.id, "date_given", e.target.value)
                      }
                      disabled={running}
                      className="rounded-none text-sm w-36 bg-white border-[#E7E2DA]"
                      style={{ fontFamily: F.mono }}
                    />
                    <button
                      onClick={() => removeDose(dose.id)}
                      disabled={running || doses.length <= 1}
                      style={{
                        background: "transparent", border: "none",
                        color: running || doses.length <= 1 ? H.faint : H.mute,
                        cursor: running || doses.length <= 1 ? "not-allowed" : "pointer",
                        padding: "4px 6px", flexShrink: 0,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addDose}
                disabled={running}
                style={{
                  marginTop: 10,
                  background: "transparent",
                  border: `1px solid ${H.stone}`,
                  color: H.mute,
                  padding: "7px 14px",
                  fontFamily: F.mono, fontSize: 10.5,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  cursor: running ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <Plus size={11} /> Add dose
              </button>
            </div>

            {/* Submit */}
            <div
              style={{
                marginTop: 28, paddingTop: 20,
                borderTop: `1px solid ${H.rule}`,
                display: "flex", justifyContent: "flex-end",
                alignItems: "center", gap: 16,
              }}
            >
              {!started && (
                <span
                  style={{
                    fontFamily: F.serif, fontSize: 14,
                    fontStyle: "italic", color: H.meta,
                  }}
                >
                  8 tools · Claude Opus 4.7
                </span>
              )}
              {started && running && (
                <MetaSpan color={H.copperInk}>{status}</MetaSpan>
              )}
              <button
                onClick={handleSubmit}
                disabled={
                  running || !dob || doses.every((d) => !d.vaccine_trade_name)
                }
                style={{
                  background:
                    running || !dob || doses.every((d) => !d.vaccine_trade_name)
                      ? H.stone
                      : H.copper,
                  color: "#FFFDF7",
                  border: "none",
                  padding: "14px 26px",
                  fontFamily: F.mono, fontSize: 11.5,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  cursor:
                    running || !dob || doses.every((d) => !d.vaccine_trade_name)
                      ? "not-allowed"
                      : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "background 0.2s ease",
                }}
              >
                {running ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Reconciling
                    <AnimatedDots active={true} />
                  </>
                ) : (
                  "Reconcile →"
                )}
              </button>
            </div>
          </div>

          {!started && (
            <p
              style={{
                fontFamily: F.serif, fontSize: 14, fontStyle: "italic",
                color: H.meta, marginTop: 12, paddingLeft: 2,
              }}
            >
              Demo: reconciles a Nigerian infant&apos;s NPI vaccination card against
              Egypt&apos;s MoHP EPI schedule.
            </p>
          )}
        </section>

        {/* ── Reasoning stream ── */}
        {started && (
          <section style={{ marginBottom: 40 }}>
            <div
              style={{
                background: H.paper2,
                border: `1px solid ${H.rule}`,
                padding: "28px 36px",
              }}
            >
              <PilgrimagePanel
                items={items}
                toolMap={toolMap}
                running={running}
                finalPlan={finalPlan}
                collapsed={reasoningCollapsed && !running}
                onToggleCollapse={() => setReasoningCollapsed((c) => !c)}
              />
            </div>
          </section>
        )}

        {/* ── Report ── */}
        {finalPlan && (
          <section style={{ animation: "hathor-fade-in 0.5s ease-out both" }}>
            <div style={{ marginBottom: 28 }}>
              <MetaSpan color={H.copperInk}>Reconciliation report</MetaSpan>
              <div
                style={{
                  display: "flex", alignItems: "baseline",
                  gap: 14, marginTop: 8,
                }}
              >
                <h2
                  style={{
                    fontFamily: F.serif, fontSize: 30, fontWeight: 400,
                    letterSpacing: "-0.018em", lineHeight: 1.15,
                    color: H.ink, margin: 0,
                  }}
                >
                  Catch-up plan
                </h2>
                <div
                  style={{
                    height: 1, background: H.copper, width: 64,
                    transform: "translateY(-6px)", flexShrink: 0,
                  }}
                />
              </div>
            </div>

            <div
              style={{
                background: H.card,
                border: `1px solid ${H.rule}`,
                padding: "36px 40px",
              }}
            >
              <article className="prose max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1
                        style={{
                          fontFamily: F.serif, fontSize: 22, fontWeight: 400,
                          letterSpacing: "-0.015em", color: H.ink,
                          borderBottom: `1px solid ${H.copper}`,
                          paddingBottom: 8, marginTop: 32, marginBottom: 16,
                        }}
                      >
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2
                        style={{
                          fontFamily: F.serif, fontSize: 18, fontWeight: 400,
                          letterSpacing: "-0.01em", color: H.ink,
                          borderBottom: `1px solid ${H.rule}`,
                          paddingBottom: 6, marginTop: 28, marginBottom: 14,
                        }}
                      >
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3
                        style={{
                          fontFamily: F.mono, fontSize: 11,
                          letterSpacing: "0.14em", textTransform: "uppercase",
                          color: H.meta, marginTop: 20, marginBottom: 10,
                        }}
                      >
                        {children}
                      </h3>
                    ),
                    p({ children }) {
                      const text =
                        typeof children === "string"
                          ? children
                          : Array.isArray(children)
                          ? children.join("")
                          : "";
                      if (text.startsWith("⚕️")) {
                        return (
                          <div
                            style={{
                              borderLeft: `3px solid ${H.copper}`,
                              background: H.paper2,
                              padding: "14px 18px",
                              fontFamily: F.serif, fontSize: 14,
                              fontStyle: "italic", color: H.mute,
                              margin: "24px 0",
                            }}
                          >
                            {children}
                          </div>
                        );
                      }
                      return (
                        <p
                          style={{
                            fontFamily: F.serif, fontSize: 15,
                            lineHeight: 1.65, color: H.ink2,
                          }}
                        >
                          {children}
                        </p>
                      );
                    },
                    table: ({ children }) => (
                      <div style={{ overflowX: "auto", marginBottom: 20 }}>
                        <table
                          style={{
                            width: "100%", borderCollapse: "collapse",
                            fontFamily: F.mono, fontSize: 12,
                          }}
                        >
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th
                        style={{
                          padding: "8px 12px", background: H.paper2,
                          borderBottom: `1px solid ${H.rule}`,
                          color: H.meta, fontWeight: 400,
                          letterSpacing: "0.08em", textTransform: "uppercase",
                          fontSize: 10.5, textAlign: "left",
                        }}
                      >
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td
                        style={{
                          padding: "7px 12px",
                          borderBottom: `1px solid ${H.ruleSoft}`,
                          color: H.ink2, verticalAlign: "top",
                        }}
                      >
                        {children}
                      </td>
                    ),
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
      <footer
        style={{
          borderTop: `1px solid ${H.rule}`,
          background: H.paper,
          marginTop: 48, padding: "24px 48px",
        }}
      >
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div
            style={{
              borderLeft: `3px solid ${H.copper}`,
              paddingLeft: 16,
              marginBottom: stats ? 16 : 0,
            }}
          >
            <p
              style={{
                fontFamily: F.serif, fontSize: 14, fontStyle: "italic",
                color: H.mute, margin: 0, lineHeight: 1.6,
              }}
            >
              ⚕️ Decision support only — not a prescription. Final catch-up
              schedule must be confirmed by a licensed paediatrician.
            </p>
          </div>

          {stats && (
            <p
              style={{
                fontFamily: F.mono, fontSize: 10.5, color: H.faint,
                letterSpacing: "0.08em", marginTop: 12,
              }}
            >
              {stats.tool_call_count} tool calls ·{" "}
              {stats.input_tokens?.toLocaleString()} input ·{" "}
              {stats.output_tokens?.toLocaleString()} output tokens
              {stats.cost_usd != null ? ` · $${stats.cost_usd.toFixed(4)}` : ""}
              {stats.model ? ` · ${stats.model}` : " · claude-opus-4-7"}
            </p>
          )}

          <div
            style={{
              marginTop: 16, paddingTop: 14,
              borderTop: `1px solid ${H.rule}`,
              display: "flex", justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <MetaSpan>Vaccination reconciliation for migrant families</MetaSpan>
            <MetaSpan color={H.faint}>MIT licensed · Anthropic Claude Agent SDK</MetaSpan>
          </div>
        </div>
      </footer>
    </div>
  );
}
