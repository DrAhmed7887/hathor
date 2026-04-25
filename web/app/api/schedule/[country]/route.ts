/**
 * Serves the country schedule JSON files from /data/schedules to the
 * browser. The /scan page fetches Egypt + the source country and runs
 * the lightweight `reconcile()` diff client-side.
 *
 * Allow-listed to the four files we ship — no path traversal.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  EG: "egypt.json",
  NG: "nigeria.json",
  SD: "sudan.json",
  ET: "ethiopia.json",
  WHO: "who.json",
};

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/schedule/[country]">,
): Promise<Response> {
  const { country } = await ctx.params;
  const file = ALLOWED[country.toUpperCase()];
  if (!file) {
    return Response.json(
      { error: `unknown country code: ${country}` },
      { status: 404 },
    );
  }
  const filePath = path.join(process.cwd(), "..", "data", "schedules", file);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return Response.json(
      {
        error: `could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
