/**
 * Design tokens for Hathor 60s vertical short.
 *
 * Deliberately neutral / clinical / high-trust per storyboard render-notes:
 * the warm cream/terracotta Pharos palette used in the live web UI is NOT
 * mirrored here. The Pharos beam motif is the single stylistic flourish and
 * appears only in hook-1 and payoff-2.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DURATION_FRAMES = 60 * FPS; // 1800 frames

export const C = {
  // Neutral surface
  bg: "#F5F5F4",         // stone-100
  bgDeep: "#0F172A",     // slate-900 — closing card
  surface: "#FFFFFF",
  surfaceMuted: "#FAFAF9",

  // Ink
  ink: "#0F172A",        // slate-900
  inkMuted: "#475569",   // slate-600
  inkSoft: "#94A3B8",    // slate-400

  // Rules
  rule: "#E2E8F0",       // slate-200
  ruleSoft: "#F1F5F9",   // slate-100

  // Clinical accents
  ok: "#0F766E",         // teal-700 — confirmed
  okSoft: "#CCFBF1",     // teal-100
  warn: "#B45309",       // amber-700 — HITL / low confidence
  warnSoft: "#FEF3C7",   // amber-100

  // Pharos beam (used sparingly: hook-1 + payoff-2 only)
  beam: "rgba(251, 191, 36, 0.55)",   // amber-400 with alpha
  beamCore: "rgba(255, 230, 170, 0.9)",
} as const;

export const FONT = {
  sans:
    "system-ui, -apple-system, 'SF Pro Text', Segoe UI, Inter, sans-serif",
  mono:
    "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

/**
 * Shot timing — single source of truth.
 * Times are in seconds; frames are derived. Total must equal 60.
 */
export type ShotId =
  | "hook-1" | "hook-2"
  | "problem-1" | "problem-2"
  | "extract-1" | "extract-2"
  | "reconcile-1" | "reconcile-2" | "reconcile-3"
  | "payoff-1" | "payoff-2";

export const SHOTS: { id: ShotId; durationSec: number }[] = [
  { id: "hook-1",      durationSec: 4 },
  { id: "hook-2",      durationSec: 4 },
  { id: "problem-1",   durationSec: 5 },
  { id: "problem-2",   durationSec: 5 },
  { id: "extract-1",   durationSec: 5 },
  { id: "extract-2",   durationSec: 5 },
  { id: "reconcile-1", durationSec: 5 },
  { id: "reconcile-2", durationSec: 5 },
  { id: "reconcile-3", durationSec: 5 },
  { id: "payoff-1",    durationSec: 9 },
  { id: "payoff-2",    durationSec: 8 },
];

export function shotFrameOffsets(): { id: ShotId; from: number; durationInFrames: number }[] {
  let cursor = 0;
  return SHOTS.map((s) => {
    const durationInFrames = Math.round(s.durationSec * FPS);
    const from = cursor;
    cursor += durationInFrames;
    return { id: s.id, from, durationInFrames };
  });
}
