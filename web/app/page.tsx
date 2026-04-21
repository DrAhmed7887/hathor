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
  Wrench,
  Brain,
  CheckCircle,
  AlertCircle,
  Activity,
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

// ── Types ──────────────────────────────────────────────────────────────────

interface DoseRow {
  id: string;
  vaccine_trade_name: string;
  date_given: string;
}

type StreamEventKind =
  | { kind: "agent_start"; model: string; tools: number }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool_use";
      index: number;
      name: string;
      input: Record<string, unknown>;
      complete: boolean;
    }
  | { kind: "assistant_text"; text: string }
  | { kind: "error"; message: string };

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

let _idCtr = 0;
const uid = () => String(++_idCtr);

function makeRow(v: Omit<DoseRow, "id">): DoseRow {
  return { ...v, id: uid() };
}

function toolLabel(rawName: string): string {
  return rawName.replace(/^mcp__\w+__/, "").replace(/_/g, " ");
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.slice(0, 120) + (text.length > 120 ? "…" : "");
  return (
    <div
      className="border-l-2 border-slate-300 pl-3 py-1 cursor-pointer"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1 select-none">
        <Brain size={12} />
        <span>Thinking</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>
      <p className="text-sm text-slate-500 italic leading-relaxed whitespace-pre-wrap">
        {expanded ? text : preview}
      </p>
    </div>
  );
}

function ToolCard({
  event,
}: {
  event: Extract<StreamEventKind, { kind: "tool_use" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasInput = Object.keys(event.input).length > 0;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Wrench size={13} className="text-teal-600 shrink-0" />
          <span className="text-sm font-medium text-slate-700 truncate capitalize">
            {toolLabel(event.name)}
          </span>
          <span className="text-xs text-slate-400 shrink-0">#{event.index}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {event.complete ? (
            <CheckCircle size={14} className="text-teal-500" />
          ) : (
            <Loader2 size={14} className="text-teal-500 animate-spin" />
          )}
          {hasInput && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-0.5"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              params
            </button>
          )}
        </div>
      </div>
      {expanded && hasInput && (
        <pre className="mt-2 text-xs text-slate-600 bg-white border border-slate-100 rounded p-2 overflow-x-auto max-h-48">
          {JSON.stringify(event.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function StreamLog({ events }: { events: StreamEventKind[] }) {
  return (
    <div className="flex flex-col gap-2">
      {events.map((ev, i) => {
        if (ev.kind === "thinking") {
          return <ThinkingBlock key={i} text={ev.text} />;
        }
        if (ev.kind === "tool_use") {
          return <ToolCard key={i} event={ev} />;
        }
        if (ev.kind === "assistant_text") {
          return (
            <p key={i} className="text-sm text-slate-700 leading-relaxed">
              {ev.text}
            </p>
          );
        }
        if (ev.kind === "error") {
          return (
            <div
              key={i}
              className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2"
            >
              <AlertCircle size={14} />
              {ev.message}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function HathorPage() {
  const [dob, setDob] = useState("2024-06-15");
  const [country, setCountry] = useState("Germany");
  const [doses, setDoses] = useState<DoseRow[]>(() =>
    DEFAULT_DOSES.map(makeRow)
  );

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState<StreamEventKind[]>([]);
  const [finalPlan, setFinalPlan] = useState<string | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [started, setStarted] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll unless user scrolled up
  useEffect(() => {
    const el = logRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  const handleScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRef.current = !atBottom;
  }, []);

  const addDose = () =>
    setDoses((prev) => [...prev, makeRow({ vaccine_trade_name: "", date_given: "" })]);

  const removeDose = (id: string) =>
    setDoses((prev) => prev.filter((d) => d.id !== id));

  const updateDose = (id: string, field: keyof Omit<DoseRow, "id">, value: string) =>
    setDoses((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );

  const handleSubmit = useCallback(async () => {
    setRunning(true);
    setStarted(true);
    setEvents([]);
    setFinalPlan(null);
    setStats(null);
    setStatus("Starting…");
    userScrolledRef.current = false;

    const payload = {
      child_dob: dob,
      target_country: country,
      given_doses: doses
        .filter((d) => d.vaccine_trade_name && d.date_given)
        .map((d) => ({
          vaccine_trade_name: d.vaccine_trade_name,
          date_given: d.date_given,
          source: "vaccination card",
        })),
    };

    try {
      let lastToolIndex = 0;

      for await (const sse of streamSSE(`${API_BASE}/reconcile-stream`, payload)) {
        const d = sse.data as Record<string, unknown>;

        if (sse.type === "agent_start") {
          setStatus(`Agent started — ${d.tools} tools available`);
        } else if (sse.type === "thinking") {
          setStatus("Thinking…");
          setEvents((prev) => [
            // Mark previous tool as complete when a new event arrives
            ...markLastToolComplete(prev),
            { kind: "thinking", text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "tool_use") {
          const idx = Number(d.index);
          lastToolIndex = idx;
          const name = String(d.name ?? "");
          setStatus(`Calling: ${toolLabel(name)}`);
          setEvents((prev) => [
            ...markLastToolComplete(prev),
            {
              kind: "tool_use",
              index: idx,
              name,
              input: (d.input as Record<string, unknown>) ?? {},
              complete: false,
            },
          ]);
        } else if (sse.type === "assistant_text") {
          setStatus("Generating report…");
          setEvents((prev) => [
            ...markLastToolComplete(prev),
            { kind: "assistant_text", text: String(d.text ?? "") },
          ]);
        } else if (sse.type === "final_plan") {
          setStatus("Complete");
          setFinalPlan(String(d.markdown ?? ""));
          setEvents((prev) => markLastToolComplete(prev));
        } else if (sse.type === "run_complete") {
          setStats(d as RunStats);
          setStatus("Complete");
        } else if (sse.type === "error") {
          setStatus("Error");
          setEvents((prev) => [
            ...prev,
            { kind: "error", message: String(d.message ?? "Unknown error") },
          ]);
        }
      }
    } catch (err) {
      setStatus("Connection error");
      setEvents((prev) => [
        ...prev,
        {
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      ]);
    } finally {
      setRunning(false);
      setEvents((prev) => markLastToolComplete(prev));
    }
  }, [dob, country, doses]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
              Hathor
            </h1>
            <span className="text-slate-400">·</span>
            <p className="text-sm text-slate-500">
              Cross-border vaccination reconciliation
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* ── Input Form ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium text-slate-800">
              Child vaccination record
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dob" className="text-sm text-slate-600">
                  Date of birth
                </Label>
                <Input
                  id="dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  disabled={running}
                  className="text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm text-slate-600">Target country</Label>
                <Select value={country} onValueChange={(v) => v && setCountry(v)} disabled={running}>
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

            <Separator />

            <div className="flex flex-col gap-2">
              <Label className="text-sm text-slate-600">Given doses</Label>
              {doses.map((dose, i) => (
                <div key={dose.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-5 text-right shrink-0">
                    {i + 1}
                  </span>
                  <Input
                    placeholder="Trade name (e.g. Hexyon)"
                    value={dose.vaccine_trade_name}
                    onChange={(e) =>
                      updateDose(dose.id, "vaccine_trade_name", e.target.value)
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
                    className="shrink-0 text-slate-400 hover:text-red-500"
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
                disabled={running || !dob || doses.every((d) => !d.vaccine_trade_name)}
                className="bg-teal-600 hover:bg-teal-700 text-white text-sm px-6"
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

        {/* ── Agent Stream Panel ──────────────────────────────────────────── */}
        {started && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium text-slate-800">
                  Agent reasoning
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {running && (
                    <Activity size={13} className="text-teal-500 animate-pulse" />
                  )}
                  <span>{status}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div
                ref={logRef}
                onScroll={handleScroll}
                className="h-96 overflow-y-auto flex flex-col gap-3 pr-1"
              >
                <StreamLog events={events} />
                {running && events.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    Waiting for agent…
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Final Plan ─────────────────────────────────────────────────── */}
        {finalPlan && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium text-slate-800">
                Reconciliation report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <article className="prose prose-sm prose-slate max-w-none prose-table:text-xs prose-th:font-medium prose-td:py-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {finalPlan}
                </ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-6 py-5 flex flex-col gap-3">
          {stats && (
            <div className="flex items-center gap-6 text-xs text-slate-500">
              {stats.tool_call_count !== undefined && (
                <span>{stats.tool_call_count} tool calls</span>
              )}
              {stats.input_tokens !== undefined && (
                <span>
                  {stats.input_tokens.toLocaleString()} in /{" "}
                  {(stats.output_tokens ?? 0).toLocaleString()} out tokens
                </span>
              )}
              {stats.cost_usd !== undefined && (
                <span>${stats.cost_usd.toFixed(4)}</span>
              )}
            </div>
          )}
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚕️ Decision support only — not a prescription. Final catch-up
            schedule must be confirmed by a licensed paediatrician.
          </p>
          <p className="text-xs text-slate-400">
            Built with Claude Sonnet 4.6 · Anthropic Claude Agent SDK
          </p>
        </div>
      </footer>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function markLastToolComplete(events: StreamEventKind[]): StreamEventKind[] {
  // Find the last tool_use event and mark it complete
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "tool_use" && !ev.complete) {
      const updated = [...events];
      updated[i] = { ...ev, complete: true };
      return updated;
    }
  }
  return events;
}
