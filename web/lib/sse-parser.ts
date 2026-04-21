/**
 * Minimal SSE parser for fetch-based streaming (POST body requires fetch, not EventSource).
 * Parses the standard SSE wire format: event: TYPE\ndata: JSON\n\n
 */

export interface SSEEvent {
  type: string;
  data: unknown;
}

export function parseSSEChunk(
  buffer: string
): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    let eventType = "message";
    let dataLine = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLine = line.slice(6).trim();
      }
    }

    if (dataLine) {
      try {
        events.push({ type: eventType, data: JSON.parse(dataLine) });
      } catch {
        events.push({ type: eventType, data: { raw: dataLine } });
      }
    }
  }

  return { events, remainder };
}

export async function* streamSSE(
  url: string,
  body: unknown
): AsyncGenerator<SSEEvent> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSSEChunk(buffer);
    buffer = remainder;

    for (const event of events) {
      yield event;
    }
  }
}
