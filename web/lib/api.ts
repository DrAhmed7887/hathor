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

// ── Phase E types ────────────────────────────────────────────────────────────

export type Severity = "pass" | "warn" | "fail" | "override_required";

export interface ValidationResult {
  recommendation_id: string;
  severity: Severity;
  rule_id: string | null;
  rule_slug: string | null;
  rule_rationale: string | null;
  override_allowed: true;
  override_logged_as: string;
  supersedes: string | null;
  override_justification_codes: string[];
}

export interface PhaseECompletePayload {
  session_id: string;
  has_failures: boolean;
  has_override_required: boolean;
  active_results: ValidationResult[];
  override_endpoint: string;
  expires_at: string;
}

export interface OverrideSubmission {
  recommendation_id: string;
  rule_id: string;
  severity: "fail" | "override_required";
  justification_code?: string | null;
  clinical_reason_text?: string | null;
}

type PostOverrideResult =
  | { ok: true; provenance_id: string }
  | { ok: false; status: 400 | 404 | 410 | 500; detail: string };

export async function postOverride(
  overrideEndpoint: string,
  body: OverrideSubmission
): Promise<PostOverrideResult> {
  const url = overrideEndpoint.startsWith("http")
    ? overrideEndpoint
    : `http://localhost:8000${overrideEndpoint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 400, detail: "Network error — server unreachable" };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { provenance_id?: string };
    return { ok: true, provenance_id: data.provenance_id ?? "" };
  }

  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.detail ?? detail;
  } catch {
    // use statusText
  }

  const status = res.status as 400 | 404 | 410 | 500;
  return { ok: false, status, detail };
}

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
