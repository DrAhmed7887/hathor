/**
 * HATHOR chat intake — SSE streaming endpoint.
 *
 * Physician-facing pre-visit prep agent for the Phase 1.0 demo. The agent
 * gathers the five structured hints that steer the downstream card-parse
 * and schedule validation steps:
 *
 *   1. Child's age / DOB
 *   2. Country that issued the card (source)
 *   3. Whether prior doses are known
 *   4. Card language (when ambiguous)
 *   5. Known allergies or contraindications
 *
 * Wire format matches lib/sse-parser.ts (event: TYPE \n data: JSON \n\n).
 * Events emitted:
 *   - start  { model }          — once at the top
 *   - chunk  { text }           — per text delta
 *   - done   { stop_reason }    — at the end
 *   - error  { message }        — on exception
 *
 * Model selection:
 *   - HATHOR_CHAT_MODEL env override, else "claude-haiku-4-5-20251001".
 *   - Haiku 4.5 is chosen for chat intake per the build spec ("speed").
 *     CLAUDE.md's default-to-Opus-4.7 rule is deliberately overridden
 *     here — intake streaming latency is the most visible property of
 *     the demo, and intake turns are short + low-stakes. Card parsing
 *     (step 5) stays on Opus 4.7 per the spec.
 *
 * Runtime + duration per CLAUDE.md "Next 16 patterns":
 *   - runtime = 'nodejs' (Edge breaks Cache Components; not needed here).
 *   - maxDuration = 60 — safe ceiling for a conversational turn.
 */

import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.HATHOR_CHAT_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are HATHOR's pre-visit intake assistant for a physician in an Egyptian maternal-and-child-health clinic. Your job is to gather five structured hints before the physician reviews the child's paper vaccination card.

You are NOT making clinical decisions. You are NOT recommending vaccines. Those come from the downstream rules engine, which the physician will see next.

Your five targets, in order of priority:
1. Child's date of birth (YYYY-MM-DD preferred). If the physician gives only an age, ask for the DOB — the schedule engine needs the exact date.
2. Country that issued the vaccination card.
3. Whether prior doses are known in full, unknown, or only partially known.
4. The card's primary language (if the physician hasn't said).
5. Any known allergies or contraindications the physician already knows about (anaphylaxis history, immunosuppression, ongoing severe illness).

Rules:
- One question per turn. Never batch.
- Clinical tone. No emoji. No pleasantries beyond a single "Understood" or short acknowledgement.
- When you have enough information, end your final turn with the exact line:
    INTAKE_COMPLETE
  on its own line. The physician's UI uses that token to advance.
- If the physician says something you cannot parse as one of the five targets, ask once for clarification. If still unclear, record it as free-text context and move on.
- Physicians have 7–10 minutes per patient. Be brief.
- Never invent information the physician did not provide.
- Never recommend a vaccine schedule, dose timing, or catch-up plan. The rules engine owns that.`;

interface ChatRequestBody {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not set on the server" },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return Response.json(
      { error: "missing messages array" },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent("start", { model: MODEL })));

        const streamed = await client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          // Prompt caching on the system prompt — it is stable across every
          // intake request and long enough to benefit from the 5-minute TTL.
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: body.messages,
        });

        for await (const chunk of streamed) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(sseEvent("chunk", { text: chunk.delta.text })),
            );
          }
        }

        const final = await streamed.finalMessage();
        controller.enqueue(
          encoder.encode(
            sseEvent("done", {
              stop_reason: final.stop_reason,
              usage: final.usage,
            }),
          ),
        );
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown error";
        controller.enqueue(encoder.encode(sseEvent("error", { message })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
