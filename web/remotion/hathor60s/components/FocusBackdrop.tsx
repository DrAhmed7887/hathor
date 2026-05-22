/**
 * FocusBackdrop — dims and slightly desaturates inactive areas while a focal
 * region remains crisp. Used for "diagnostic focus" — calling attention to
 * a low-confidence row, an Override button, etc.
 *
 * Implementation: a dimming overlay above siblings, with a transparent
 * "spotlight" rect punched through using a radial gradient mask. Edges are
 * soft so it never reads as a hard scrim.
 */

import { ReactNode } from "react";

type Rect = { left: number; top: number; width: number; height: number };

export function FocusBackdrop({
  active,
  rect,
  intensity = 0.55,
  feather = 80,
  children,
}: {
  active: number; // 0..1, drives the dim level
  rect: Rect | null;
  intensity?: number;
  feather?: number;
  children?: ReactNode;
}) {
  if (active <= 0 || !rect) return <>{children}</>;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rx = rect.width / 2 + feather;
  const ry = rect.height / 2 + feather;

  // Two-stop radial: transparent at the focal area, dimmed past feather.
  const mask = `radial-gradient(ellipse ${rx}px ${ry}px at ${cx}px ${cy}px, transparent 55%, rgba(0,0,0,${intensity * active}) 100%)`;

  return (
    <>
      {children}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: mask,
          mixBlendMode: "multiply",
        }}
      />
    </>
  );
}
