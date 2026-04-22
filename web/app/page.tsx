"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { streamSSE } from "@/lib/sse-parser";

// ── Tool display name mapping ──────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, string> = {
  mcp__hathor__extract_vaccinations_from_card: "Reading vaccination card",
  mcp__hathor__compute_age_at_dose: "Computing age at dose",
  mcp__hathor__lookup_vaccine_equivalence: "Looking up vaccine equivalence",
  mcp__hathor__get_schedule: "Fetching target schedule",
  mcp__hathor__validate_dose: "Validating dose",
  mcp__hathor__check_interval_rule: "Checking interval rule",
  mcp__hathor__compute_missing_doses: "Computing missing doses",
  mcp__hathor__build_catchup_schedule: "Building catch-up schedule",
};

function toolDisplayName(name: string): string {
  return (
    TOOL_DISPLAY[name] ??
    name.replace(/^mcp__\w+__/, "").replace(/_/g, " ")
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

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
  | { type: "thinking"; id: string; text: string }
  | { type: "tool_group"; id: string; indices: number[] }
  | { type: "text"; id: string; text: string }
  | { type: "error"; id: string; message: string };

interface RunStats {
  tool_call_count?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";

const DEFAULT_DOSES: Omit<DoseRow, "id">[] = [
  { vaccine_trade_name: "Hexyon", date_given: "2024-08-15" },
  { vaccine_trade_name: "Hexyon", date_given: "2024-10-15" },
  { vaccine_trade_name: "Hexyon", date_given: "2024-12-15" },
  { vaccine_trade_name: "MMR", date_given: "2025-06-15" },
];

const FLAGSHIP_DOB = "2024-06-15";
const FLAGSHIP_DOSES: Omit<DoseRow, "id">[] = [
  { vaccine_trade_name: "Hexyon", date_given: "2024-08-15" },
  { vaccine_trade_name: "Hexyon", date_given: "2024-10-15" },
  { vaccine_trade_name: "Hexyon", date_given: "2024-12-15" },
  { vaccine_trade_name: "MMR", date_given: "2025-06-15" },
];
const FLAGSHIP_COUNTRY = "Germany";

let _idCtr = 0;
const uid = () => String(++_idCtr);
function makeRow(v: Omit<DoseRow, "id">): DoseRow {
  return { ...v, id: uid() };
}

// ── Tool input summarizer ──────────────────────────────────────────────────

function summarizeToolInput(
  name: string,
  input: Record<string, unknown>
): string {
  switch (name) {
    case "mcp__hathor__compute_age_at_dose":
      return `DOB ${input.date_of_birth} → dose ${input.date_given}`;
    case "mcp__hathor__lookup_vaccine_equivalence":
      return `${input.source_vaccine} → ${input.target_country ?? input.country}`;
    case "mcp__hathor__validate_dose":
      return `${input.antigen ?? input.vaccine_name} dose ${input.dose_number}, age ${input.age_at_dose_days ?? input.age_days} days → ${input.target_country ?? input.country}`;
    case "mcp__hathor__check_interval_rule":
      return `${input.antigen}: day ${input.prev_dose_age_days} → day ${input.curr_dose_age_days} (${
        Number(input.curr_dose_age_days ?? 0) -
        Number(input.prev_dose_age_days ?? 0)
      }-day interval)`;
    case "mcp__hathor__get_schedule":
      return `${input.country}, child age ${input.child_age_months ?? input.age_months} months`;
    case "mcp__hathor__extract_vaccinations_from_card":
      return `Reading ${input.filename ?? "card"}`;
    case "mcp__hathor__compute_missing_doses":
      return `Diffing validated doses against schedule`;
    case "mcp__hathor__build_catchup_schedule":
      return `Planning catch-up for overdue/due-now doses`;
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

// ── Tool result summarizer ─────────────────────────────────────────────────

function summarizeToolResult(
  name: string,
  result: Record<string, unknown>
): string {
  if (result.error) return `→ Error: ${result.error}`;
  switch (name) {
    case "mcp__hathor__compute_age_at_dose": {
      const days = result.age_days as number | undefined;
      const hr = result.human_readable as string | undefined;
      if (days != null) return `→ ${days} days (${hr ?? ""})`;
      return "→ Complete";
    }
    case "mcp__hathor__validate_dose": {
      if (result.valid === true) return "→ Valid";
      if (result.valid === false) {
        const reasons = result.reasons as string[] | undefined;
        return `→ Invalid: ${reasons?.[0] ?? "interval too short"}`;
      }
      return "→ Complete";
    }
    case "mcp__hathor__lookup_vaccine_equivalence": {
      const comps =
        (result.components as string[] | undefined) ??
        (result.antigens as string[] | undefined);
      if (Array.isArray(comps) && comps.length > 0)
        return `→ ${comps.join(" + ")}`;
      return "→ Complete";
    }
    case "mcp__hathor__check_interval_rule": {
      if (result.valid === false)
        return `→ Invalid (${result.actual_interval_days} < ${result.required_days} days)`;
      if (result.valid === true) return "→ Valid";
      return "→ Complete";
    }
    case "mcp__hathor__get_schedule": {
      const doses = result.doses as unknown[] | undefined;
      const count =
        (result.dose_count as number | undefined) ?? doses?.length;
      if (count != null) return `→ ${count} doses loaded`;
      return "→ Complete";
    }
    case "mcp__hathor__compute_missing_doses": {
      const summary = result.summary as
        | Record<string, number>
        | undefined;
      if (summary) {
        const gaps = (summary.overdue ?? 0) + (summary.due_now ?? 0);
        return `→ ${gaps} gaps identified`;
      }
      return "→ Complete";
    }
    case "mcp__hathor__build_catchup_schedule": {
      const visits = result.suggested_visits as unknown[] | undefined;
      if (visits) return `→ ${visits.length}-visit plan`;
      const needed = result.total_doses_needed as number | undefined;
      if (needed != null) return `→ ${needed} doses planned`;
      return "→ Complete";
    }
    default:
      return "→ Complete";
  }
}

// ── AnimatedDots ───────────────────────────────────────────────────────────

function AnimatedDots({ active }: { active: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) { setCount(0); return; }
    const t = setInterval(() => setCount((c) => (c + 1) % 4), 400);
    return () => clearInterval(t);
  }, [active]);
  return <span>{".".repeat(count)}</span>;
}

// ── ThinkingBlock ──────────────────────────────────────────────────────────

function ThinkingItem({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.slice(0, 160) + (text.length > 160 ? "…" : "");
  return (
    <div
      className="border-l-2 border-hathor-200 pl-4 py-2 my-3 cursor-pointer animate-in fade-in duration-200"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1.5 mb-1 select-none">
        <Sparkles size={14} className="text-hathor-400 shrink-0" />
        <span className="text-xs text-neutral-400 uppercase tracking-wide">
          Thinking
        </span>
        {expanded ? (
          <ChevronDown size={12} className="text-neutral-400" />
        ) : (
          <ChevronRight size={12} className="text-neutral-400" />
        )}
      </div>
      <p className="text-sm text-neutral-600 italic leading-relaxed whitespace-pre-wrap">
        {expanded ? text : preview}
      </p>
    </div>
  );
}

// ── ToolCard ───────────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ToolState }) {
  const display = toolDisplayName(tool.name);
  const paramSummary = summarizeToolInput(tool.name, tool.input);
  const resultSummary = tool.result
    ? summarizeToolResult(tool.name, tool.result)
    : null;

  const bgBorder =
    tool.status === "pending"
      ? "bg-neutral-50 border-neutral-200"
      : tool.status === "complete"
      ? "bg-hathor-50 border-neutral-200"
      : "bg-red-50 border-red-200";

  return (
    <div
      className={`rounded-md border p-3 transition-colors duration-300 ${bgBorder}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-neutral-900 text-sm">{display}</span>
          {paramSummary && (
            <span className="text-neutral-500 text-xs ml-2">{paramSummary}</span>
          )}
        </div>
        <div className="shrink-0 mt-0.5">
          {tool.status === "pending" && (
            <Loader2 size={14} className="text-hathor-500 animate-spin" />
          )}
          {tool.status === "complete" && (
            <CheckCircle2 size={14} className="text-green-600" />
          )}
          {tool.status === "error" && (
            <XCircle size={14} className="text-red-500" />
          )}
        </div>
      </div>
      {resultSummary && (
        <p className="text-neutral-700 text-xs mt-1.5">{resultSummary}</p>
      )}
      {tool.result && (
        <details className="mt-2">
          <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-600">
            Show detail
          </summary>
          <pre className="mt-1 text-xs bg-white border border-neutral-100 rounded p-2 overflow-x-auto max-h-48">
            {JSON.stringify(tool.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── ToolGroup ──────────────────────────────────────────────────────────────

function ToolGroup({
  indices,
  toolMap,
}: {
  indices: number[];
  toolMap: Record<number, ToolState>;
}) {
  const tools = indices.map((i) => toolMap[i]).filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      {tools.length > 1 && (
        <p className="text-neutral-400 text-xs uppercase tracking-wide">
          {tools.length} calls in parallel
        </p>
      )}
      {tools.map((t) => (
        <ToolCard key={t.index} tool={t} />
      ))}
    </div>
  );
}

// ── ReasoningPanel ─────────────────────────────────────────────────────────

function ReasoningPanel({
  items,
  toolMap,
  status,
  running,
  toolCount,
  collapsed,
  onToggleCollapse,
}: {
  items: ReasoningItem[];
  toolMap: Record<number, ToolState>;
  status: string;
  running: boolean;
  toolCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    const el = logRef.current;
    if (!el || userScrolled.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="w-full text-left text-sm text-neutral-500 hover:text-neutral-700 py-3 px-4 bg-neutral-50 border border-neutral-200 rounded-md transition-colors"
      >
        Agent completed {toolCount} tool call{toolCount !== 1 ? "s" : ""} —
        click to review reasoning
        <ChevronRight size={14} className="inline ml-1 -mt-0.5" />
      </button>
    );
  }

  return (
    <Card className="border-neutral-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-neutral-700">
            Agent reasoning
          </CardTitle>
          <div className="flex items-center gap-0.5 text-sm">
            {running ? (
              <span className="text-hathor-600">
                {status}
                <AnimatedDots active={true} />
              </span>
            ) : (
              <span className="text-neutral-500">{status}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={logRef}
          onScroll={() => {
            const el = logRef.current;
            if (!el) return;
            userScrolled.current =
              el.scrollHeight - el.scrollTop - el.clientHeight > 40;
          }}
          className="max-h-[28rem] overflow-y-auto flex flex-col gap-2 pr-1"
        >
          {items.map((item) => {
            if (item.type === "thinking")
              return <ThinkingItem key={item.id} text={item.text} />;
            if (item.type === "tool_group")
              return (
                <ToolGroup
                  key={item.id}
                  indices={item.indices}
                  toolMap={toolMap}
                />
              );
            if (item.type === "text")
              return (
                <p
                  key={item.id}
                  className="text-sm text-neutral-700 leading-relaxed"
                >
                  {item.text}
                </p>
              );
            if (item.type === "error")
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2"
                >
                  <XCircle size={14} />
                  {item.message}
                </div>
              );
            return null;
          })}
          {running && items.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-neutral-400 py-6">
              <Loader2 size={14} className="animate-spin" />
              Hathor is starting up
              <AnimatedDots active={true} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function HathorPage() {
  const [dob, setDob] = useState("2024-06-15");
  const [country, setCountry] = useState("Germany");
  const [doses, setDoses] = useState<DoseRow[]>(() =>
    DEFAULT_DOSES.map(makeRow)
  );
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6");
  const [useFlagship, setUseFlagship] = useState(false);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Hathor is starting up");
  const [items, setItems] = useState<ReasoningItem[]>([]);
  const [toolMap, setToolMap] = useState<Record<number, ToolState>>({});
  const [toolCount, setToolCount] = useState(0);
  const [finalPlan, setFinalPlan] = useState<string | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [started, setStarted] = useState(false);
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);

  const startTimeRef = useRef<number>(0);
  const currentGroupIdRef = useRef<string | null>(null);
  const lastItemTypeRef = useRef<"tool_group" | "other">("other");

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
    setToolCount(0);
    setFinalPlan(null);
    setStats(null);
    setStatus("Hathor is starting up");
    setReasoningCollapsed(false);
    currentGroupIdRef.current = null;
    lastItemTypeRef.current = "other";

    const payload = {
      child_dob: dob,
      target_country: country,
      model: selectedModel,
      given_doses: doses
        .filter((d) => d.vaccine_trade_name && d.date_given)
        .map((d) => ({
          vaccine_trade_name: d.vaccine_trade_name,
          date_given: d.date_given,
          source: "vaccination card",
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
          setStatus("Hathor is starting up");
        } else if (sse.type === "thinking") {
          setStatus("Thinking");
          lastItemTypeRef.current = "other";
          currentGroupIdRef.current = null;
          setItems((prev) => [
            ...prev,
            { type: "thinking", id: uid(), text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "tool_use") {
          const idx = Number(d.index);
          const name = String(d.name ?? "");
          setToolCount(idx);
          setStatus(toolDisplayName(name));

          const toolState: ToolState = {
            index: idx,
            name,
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
            lastItemTypeRef.current = "tool_group";
            setItems((prev) => [
              ...prev,
              { type: "tool_group", id: newGroupId, indices: [idx] },
            ]);
          }
        } else if (sse.type === "tool_result") {
          const idx = Number(d.index);
          const isError = Boolean(d.is_error);
          const result = (d.result as Record<string, unknown>) ?? {};
          setToolMap((prev) => ({
            ...prev,
            [idx]: prev[idx]
              ? { ...prev[idx], status: isError ? "error" : "complete", result }
              : prev[idx],
          }));
        } else if (sse.type === "assistant_text") {
          lastItemTypeRef.current = "other";
          currentGroupIdRef.current = null;
          setItems((prev) => [
            ...prev,
            { type: "text", id: uid(), text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "final_plan") {
          setStatus("Generating report");
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
          const cost = d.cost_usd != null
            ? ` · $${Number(d.cost_usd).toFixed(4)}`
            : "";
          setStatus(`Done in ${elapsed}s · ${count ?? 0} calls${cost}`);
          setStats({
            tool_call_count: count,
            cost_usd: d.cost_usd as number | undefined,
            input_tokens: d.input_tokens as number | undefined,
            output_tokens: d.output_tokens as number | undefined,
          });
        } else if (sse.type === "error") {
          lastItemTypeRef.current = "other";
          currentGroupIdRef.current = null;
          setStatus("Error");
          setItems((prev) => [
            ...prev,
            {
              type: "error",
              id: uid(),
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
          type: "error",
          id: uid(),
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
    <div className="min-h-screen bg-neutral-50">
      {/* ── Header ── */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-4xl font-serif text-neutral-900 tracking-tight">
            Hathor
          </h1>
          <p className="text-neutral-500 mt-1 text-sm">
            Cross-border vaccination reconciliation · Powered by {selectedModel === "claude-opus-4-7" ? "Claude Opus 4.7" : "Claude Sonnet 4.6"}
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* ── Input Form ── */}
        <div className="max-w-3xl">
          <Card className="border-neutral-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-serif text-neutral-800">
                Child vaccination record
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* ── Flagship toggle ── */}
              <div className="flex items-center justify-between bg-hathor-50 border border-hathor-200 rounded-md px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-800">
                    Cairo → Aachen demo
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Egyptian infant · Hexyon ×3 · MMR ×1 · Kita enrolment in 4 weeks
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-neutral-500">Use scenario</span>
                  <input
                    type="checkbox"
                    checked={useFlagship}
                    onChange={(e) => toggleFlagship(e.target.checked)}
                    disabled={running}
                    className="w-4 h-4 accent-hathor-500"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dob" className="text-sm text-neutral-600">
                    Date of birth
                  </Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dob}
                    onChange={(e) => { setUseFlagship(false); setDob(e.target.value); }}
                    disabled={running}
                    className="text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm text-neutral-600">
                    Target country
                  </Label>
                  <Select
                    value={country}
                    onValueChange={(v) => { setUseFlagship(false); if (v) setCountry(v); }}
                    disabled={running}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Germany">Germany (STIKO)</SelectItem>
                      <SelectItem value="WHO" disabled>
                        WHO EPI (coming soon)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ── Model selector ── */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm text-neutral-600">Model</Label>
                <Select
                  value={selectedModel}
                  onValueChange={(v) => v && setSelectedModel(v)}
                  disabled={running}
                >
                  <SelectTrigger className="text-sm w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                    <SelectItem value="claude-opus-4-7">Claude Opus 4.7</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                <Label className="text-sm text-neutral-600">Given doses</Label>
                {doses.map((dose, i) => (
                  <div key={dose.id} className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400 w-5 text-right shrink-0">
                      {i + 1}
                    </span>
                    <Input
                      placeholder="Trade name (e.g. Hexyon)"
                      value={dose.vaccine_trade_name}
                      onChange={(e) =>
                        updateDose(
                          dose.id,
                          "vaccine_trade_name",
                          e.target.value
                        )
                      }
                      disabled={running}
                      className="text-sm flex-1"
                    />
                    <Input
                      type="date"
                      value={dose.date_given}
                      onChange={(e) =>
                        updateDose(dose.id, "date_given", e.target.value)
                      }
                      disabled={running}
                      className="text-sm w-36"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDose(dose.id)}
                      disabled={running || doses.length <= 1}
                      className="shrink-0 text-neutral-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addDose}
                  disabled={running}
                  className="self-start text-xs mt-1"
                >
                  <Plus size={13} className="mr-1" />
                  Add dose
                </Button>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSubmit}
                  disabled={
                    running ||
                    !dob ||
                    doses.every((d) => !d.vaccine_trade_name)
                  }
                  className="bg-hathor-500 hover:bg-hathor-600 text-white px-6 py-2.5 font-medium"
                >
                  {running ? (
                    <>
                      <Loader2 size={14} className="animate-spin mr-2" />
                      Reconciling…
                    </>
                  ) : (
                    "Reconcile"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {!started && (
            <p className="text-neutral-400 text-sm mt-3 px-1">
              This demo reconciles an Egyptian infant&apos;s vaccination card
              against Germany&apos;s STIKO 2026 schedule.
            </p>
          )}
        </div>

        {/* ── Reasoning Panel ── */}
        {started && (
          <ReasoningPanel
            items={items}
            toolMap={toolMap}
            status={status}
            running={running}
            toolCount={toolCount}
            collapsed={reasoningCollapsed && !running}
            onToggleCollapse={() => setReasoningCollapsed((c) => !c)}
          />
        )}

        {/* ── Final Plan ── */}
        {finalPlan && (
          <section className="animate-in fade-in duration-400">
            <h2 className="text-2xl font-serif text-neutral-900 mb-5">
              Reconciliation report
            </h2>
            <article className="prose prose-neutral max-w-none prose-headings:font-serif prose-table:text-xs prose-th:font-medium prose-td:py-1.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p({ children }) {
                    const text =
                      typeof children === "string"
                        ? children
                        : Array.isArray(children)
                        ? children.join("")
                        : "";
                    if (text.startsWith("⚕️")) {
                      return (
                        <div className="border-l-4 border-hathor-400 bg-hathor-50 p-4 text-sm italic text-neutral-700 not-prose my-4 rounded-r">
                          {children}
                        </div>
                      );
                    }
                    return <p>{children}</p>;
                  },
                }}
              >
                {finalPlan}
              </ReactMarkdown>
            </article>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-neutral-200 bg-white mt-12">
        <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-3">
          {stats && (
            <p className="text-neutral-400 text-xs">
              {stats.tool_call_count} tool calls ·{" "}
              {stats.input_tokens?.toLocaleString()} input tokens ·{" "}
              {stats.output_tokens?.toLocaleString()} output tokens
              {stats.cost_usd != null
                ? ` · $${stats.cost_usd.toFixed(4)}`
                : ""}{" "}
              on {selectedModel}
            </p>
          )}
          <div className="border-l-4 border-hathor-400 bg-hathor-50 px-4 py-3 rounded-r">
            <p className="font-serif italic text-neutral-600 text-sm">
              ⚕️ Decision support only — not a prescription. Final catch-up
              schedule must be confirmed by a licensed paediatrician.
            </p>
          </div>
          <p className="text-neutral-400 text-xs">
            Built with {selectedModel} · Anthropic Claude Agent SDK
          </p>
        </div>
      </footer>
    </div>
  );
}
