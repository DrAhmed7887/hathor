"use client";

/**
 * PRD §6 point 6 — streaming chat intake with progress visibility.
 *
 * Physician-facing pre-visit prep. Talks to /api/chat (SSE), streams tokens
 * into the bubble as they arrive, and exits on the assistant's
 * INTAKE_COMPLETE sentinel with a lightweight IntakeContext for downstream
 * steps.
 *
 * Intentional minimality:
 *   - One question per turn (system prompt enforces).
 *   - No emoji (PRD §6 point 3 — clinical surface).
 *   - Pharos palette (matches app/page.tsx and the existing HITL/Phase-E
 *     components — avoids a second design system).
 *   - No free-text context distillation via a second model call. We keep
 *     the raw transcript for auditability and extract a DOB via regex
 *     because the engine needs that exact field; everything else is
 *     advisory and flows through as free-text for the card-parse hints.
 *
 * Not mounted on any page yet — step 10 decides whether /demo subsumes
 * /reconcile-card. This component is the intake widget that /demo will
 * host once that decision lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { streamSSE } from "@/lib/sse-parser";
import type { IntakeContext, IntakeMessage } from "@/lib/types";

// Pharos tokens — inline, matching the convention in app/page.tsx,
// reconcile-card/page.tsx, HITLPanel.tsx, RecommendationCard.tsx.
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
};

const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

const OPENING_MESSAGE =
  "I will gather a few prep details before we review the card. " +
  "To begin — what is the child's date of birth? Format YYYY-MM-DD preferred.";

const INTAKE_COMPLETE_SENTINEL = "INTAKE_COMPLETE";

// Lowest-risk DOB heuristic: explicit ISO form on its own line or with
// labelling. We do NOT try to infer DOB from free-text age phrases — the
// engine needs an exact date, not an approximation.
const DOB_REGEX = /\b(\d{4}-\d{2}-\d{2})\b/;

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 14);
}

function extractDob(transcript: IntakeMessage[]): string | undefined {
  // Walk user turns only — the assistant restating a DOB back doesn't
  // re-confirm it.
  for (const m of transcript) {
    if (m.role !== "user") continue;
    const match = m.content.match(DOB_REGEX);
    if (match) return match[1];
  }
  return undefined;
}

function stripSentinel(text: string): string {
  // The assistant signals completion by emitting INTAKE_COMPLETE on its
  // own line. Hide that sentinel from the rendered transcript.
  return text
    .replace(new RegExp(`\\n?\\s*${INTAKE_COMPLETE_SENTINEL}\\s*$`), "")
    .trim();
}

export interface ChatIntakeProps {
  onComplete?: (context: IntakeContext) => void;
  /** Optional heading override for callers that want their own frame. */
  heading?: string;
}

export function ChatIntake({
  onComplete,
  heading = "Pre-visit intake",
}: ChatIntakeProps) {
  const [messages, setMessages] = useState<IntakeMessage[]>(() => [
    { id: newId(), role: "assistant", content: OPENING_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the latest message as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || completed) return;

    const userMsg: IntakeMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };
    const assistantMsg: IntakeMessage = {
      id: newId(),
      role: "assistant",
      content: "",
      streaming: true,
    };

    // Snapshot the outgoing conversation (includes the user turn).
    const outgoing = [...messages, userMsg];

    setMessages([...outgoing, assistantMsg]);
    setInput("");
    setStreaming(true);
    setError(null);

    const wirePayload = {
      messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
    };

    let accumulated = "";
    try {
      for await (const ev of streamSSE("/api/chat", wirePayload)) {
        if (ev.type === "chunk") {
          const d = ev.data as { text?: string };
          if (typeof d.text === "string") {
            accumulated += d.text;
            const rendered = stripSentinel(accumulated);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: rendered } : m,
              ),
            );
          }
        } else if (ev.type === "error") {
          const d = ev.data as { message?: string };
          setError(d.message ?? "chat stream error");
        }
        // "start" and "done" are acknowledged by the loop ending naturally.
      }

      // Drop the streaming flag on the final message.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, streaming: false } : m,
        ),
      );

      // Completion detection — the model prints INTAKE_COMPLETE on its
      // final turn per the system prompt.
      if (accumulated.includes(INTAKE_COMPLETE_SENTINEL)) {
        setCompleted(true);
        const finalTranscript: IntakeMessage[] = [
          ...outgoing,
          {
            ...assistantMsg,
            content: stripSentinel(accumulated),
            streaming: false,
          },
        ];
        const ctx: IntakeContext = {
          childDob: extractDob(finalTranscript),
          rawTranscript: finalTranscript,
        };
        onComplete?.(ctx);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, streaming: false } : m,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, completed, messages, onComplete]);

  return (
    <section
      style={{
        background: H.card,
        border: `1px solid ${H.rule}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 420,
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
          Phase A · intake
        </div>
        <h2
          style={{
            fontFamily: F.serif,
            fontSize: 18,
            fontWeight: 400,
            color: H.ink,
            margin: "4px 0 0",
            letterSpacing: "-0.01em",
          }}
        >
          {heading}
        </h2>
      </header>

      {/* Transcript */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: H.paper,
        }}
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "#F3E3DF",
              border: "1px solid #A3453B",
              fontFamily: F.mono,
              fontSize: 12,
              color: "#A3453B",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        style={{
          padding: "12px 16px",
          borderTop: `1px solid ${H.rule}`,
          background: H.card,
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newline. Standard clinical-tool
            // ergonomics — physicians are keyboard-driven.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder={
            completed
              ? "Intake complete."
              : streaming
                ? "Waiting for reply…"
                : "Type your answer. Enter to send."
          }
          disabled={streaming || completed}
          style={{
            flex: 1,
            padding: "10px 12px",
            fontFamily: F.sans,
            fontSize: 14,
            lineHeight: 1.5,
            color: H.ink,
            background: completed ? H.paper2 : "#fff",
            border: `1px solid ${H.rule}`,
            borderRadius: 0,
            outline: "none",
            resize: "none",
          }}
        />
        <button
          type="submit"
          disabled={streaming || completed || !input.trim()}
          style={{
            padding: "10px 20px",
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#FFFDF7",
            background:
              streaming || completed || !input.trim() ? H.stone : H.copper,
            border: "none",
            cursor:
              streaming || completed || !input.trim()
                ? "not-allowed"
                : "pointer",
          }}
        >
          {completed ? "Done" : streaming ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: IntakeMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isAssistant ? "flex-start" : "flex-end",
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          padding: "10px 14px",
          fontFamily: isAssistant ? F.serif : F.sans,
          fontSize: isAssistant ? 15 : 14,
          lineHeight: 1.55,
          color: isAssistant ? H.ink : H.ink2,
          background: isAssistant ? H.card : H.paper2,
          border: `1px solid ${isAssistant ? H.rule : H.ruleSoft}`,
          borderLeft: isAssistant ? `3px solid ${H.copper}` : `1px solid ${H.ruleSoft}`,
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
        {message.streaming && (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 7,
              height: 14,
              marginLeft: 3,
              transform: "translateY(2px)",
              background: H.copper,
              animation: "hathor-caret 1s steps(2, start) infinite",
            }}
          />
        )}
        <style>{`
          @keyframes hathor-caret {
            0%, 100% { opacity: 1; }
            50%      { opacity: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}
