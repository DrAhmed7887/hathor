/**
 * Types and fetch helpers for the /reconcile/card and HITL correction endpoints.
 */

export interface FieldExtraction {
  value: string | null;
  confidence: number;
  needs_review: boolean;
  ambiguity_reason: string | null;
}

export interface HITLQueueItem {
  dose_index: number;
  field_path: string;
  reason: string;
  extracted: FieldExtraction;
}

export type CorrectionAction = "edit" | "keep" | "skip";

export interface Correction {
  field_path: string;
  action: CorrectionAction;
  corrected_value?: string;
}

export interface HITLRequiredPayload {
  session_id: string;
  hitl_queue: HITLQueueItem[];
  resume_endpoint: string;
  expires_at: string;
}

type PostCorrectionsResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 410; detail: string };

export async function postCorrections(
  resumeEndpoint: string,
  corrections: Correction[]
): Promise<PostCorrectionsResult> {
  const url = resumeEndpoint.startsWith("http")
    ? resumeEndpoint
    : `http://localhost:8000${resumeEndpoint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrections }),
    });
  } catch {
    return { ok: false, status: 400, detail: "Network error — server unreachable" };
  }

  if (res.ok) return { ok: true };

  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.detail ?? detail;
  } catch {
    // use statusText
  }

  const status = res.status as 400 | 404 | 410;
  return { ok: false, status, detail };
}
