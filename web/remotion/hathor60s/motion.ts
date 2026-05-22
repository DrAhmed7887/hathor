/**
 * Shared motion vocabulary for Hathor60s.
 *
 * Centralizes timing constants, easing curves, and helpers that drive the
 * "clinical glide" feel — restrained, accurate, no bounce. Scenes import
 * from here so cadence stays consistent and magic numbers stay out of the
 * scene files.
 */

import { Easing, interpolate, spring as remotionSpring } from "remotion";
import { FPS } from "./tokens";

// ── Beat lengths (in frames) ─────────────────────────────────────────
// One "beat" is a base unit; scene cadences are derived from these.
export const BEAT = {
  fast: Math.round(0.4 * FPS),   // 12f — small UI nudge
  med:  Math.round(0.6 * FPS),   // 18f — card lift, panel slide
  slow: Math.round(0.95 * FPS),  // 28f — camera glide, scan sweep
  hold: Math.round(0.25 * FPS),  // 8f  — settle pause
} as const;

// ── Eases ────────────────────────────────────────────────────────────
// Use `clinical` for entrances/lifts. Use `glide` for camera/scale moves.
// Use `linear` only for scan sweeps (literal motion of light).
export const EASE = {
  clinical: Easing.bezier(0.22, 0.8, 0.32, 1.0),  // ease-out, no overshoot
  glide:    Easing.bezier(0.42, 0, 0.18, 1),      // ease-in-out, smooth
  linear:   Easing.linear,
} as const;

// ── Spring presets ───────────────────────────────────────────────────
export const SPRING = {
  clinical: { damping: 220, mass: 0.9, stiffness: 130 },
  soft:     { damping: 180, mass: 1.0, stiffness: 95 },
  precise:  { damping: 260, mass: 0.7, stiffness: 180 },
} as const;

export function springAt(
  frame: number,
  delay: number,
  preset: keyof typeof SPRING = "clinical",
): number {
  return remotionSpring({
    frame: Math.max(0, frame - delay),
    fps: FPS,
    config: SPRING[preset],
    durationInFrames: 26,
  });
}

// ── Reveal helpers ───────────────────────────────────────────────────
/** 0→1 fade between [start,end] frames, with a clinical ease. */
export function reveal(frame: number, start: number, end: number): number {
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });
}

/** Stagger generator: returns reveal-progress for the i-th item. */
export function stagger(
  frame: number,
  baseStart: number,
  step: number,
  duration: number = BEAT.med,
) {
  return (i: number) => reveal(frame, baseStart + i * step, baseStart + i * step + duration);
}

/** Translate-Y ramp paired with a reveal: items rise into place. */
export function rise(progress: number, distance: number = 14): number {
  return (1 - progress) * distance;
}

/** Returns [0..1] within a window, looping is not allowed. */
export function window(frame: number, start: number, end: number): number {
  if (frame < start) return 0;
  if (frame > end) return 1;
  return (frame - start) / (end - start);
}

/** Inverse — for "hold then fade out". */
export function fadeOut(frame: number, start: number, end: number): number {
  return interpolate(frame, [start, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.clinical,
  });
}

/** Camera-style scale glide. Use sparingly — one per shot at most. */
export function cameraGlide(
  frame: number,
  start: number,
  end: number,
  fromScale: number = 1.0,
  toScale: number = 1.04,
): number {
  return interpolate(frame, [start, end], [fromScale, toScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.glide,
  });
}
