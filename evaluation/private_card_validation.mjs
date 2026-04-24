#!/usr/bin/env node
/**
 * Gated private-card validation runner.
 *
 * PURPOSE
 *   Mirror of the synthetic fixture harness, but pointed at the
 *   developer's LOCAL private card set. Used by Ahmed to confirm the
 *   pipeline changes on a real card (Sofia) between PRs without any
 *   real-card data entering the repo or CI.
 *
 * HARD PRIVACY GATE (defence in depth)
 *   1. Reads from cards/private/ ONLY. That directory is excluded
 *      from git via .gitignore (the blanket /cards/* rule plus the
 *      explicit reinforcement in .gitignore).
 *   2. Refuses to start unless HATHOR_PRIVATE_VALIDATION=1 is set in
 *      the environment. Without that env var, this script exits 0
 *      silently — CI runs without ever importing, invoking, or even
 *      listing it.
 *   3. Not referenced by any `npm run` script. CI invokes `npm test`
 *      which runs node --test over files in web/lib/*.test.ts. This
 *      script is in evaluation/ and is never imported by tests.
 *   4. Writes no result files unless HATHOR_PRIVATE_VALIDATION_WRITE
 *      is also set to an explicit output path — and even then, only
 *      summary counts are written, never the raw vision payload. The
 *      raw image and the raw model output stay in memory.
 *
 * EXPECTED WORKFLOW
 *   $ export HATHOR_PRIVATE_VALIDATION=1
 *   $ export ANTHROPIC_API_KEY=sk-ant-...
 *   $ node evaluation/private_card_validation.mjs cards/private/sofia.jpg
 *
 *   Without the env var:
 *   $ node evaluation/private_card_validation.mjs cards/private/sofia.jpg
 *   (exits 0 silently — gate refused)
 *
 * WHAT IT DOES
 *   - Posts the image to the live /api/parse-card endpoint (requires
 *     `npm run dev` in web/ or a deployed instance).
 *   - Runs the returned ParsedCardOutput through the same downstream
 *     pipeline the synthetic harness exercises.
 *   - Prints a summary table: rows_in, rows_out, vision vs. inferred
 *     counts, confirmation-gate preview.
 *
 *   This gives Ahmed a one-command sanity check per pipeline change,
 *   and makes Sofia-specific regressions measurable without ever
 *   committing Sofia's image or ground truth.
 */

const GATE_ENV = "HATHOR_PRIVATE_VALIDATION";

if (process.env[GATE_ENV] !== "1") {
  // Silent refusal. No stdout, no stderr, exit 0. This makes the
  // script indistinguishable from "not present" when the env var is
  // not set — which is the posture CI sees.
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node evaluation/private_card_validation.mjs <path-to-card-image>",
  );
  console.error("");
  console.error(
    "Path must be under cards/private/ (the only directory that is",
  );
  console.error("guaranteed to be gitignored for real-card images).");
  process.exit(2);
}

const imagePath = args[0];

if (!imagePath.startsWith("cards/private/")) {
  console.error(
    "Refusing: private validation accepts only paths under cards/private/.",
  );
  console.error(`  received: ${imagePath}`);
  console.error(
    "  This is a defence-in-depth rule — real-card images must live in",
  );
  console.error("  the gitignored private directory only.");
  process.exit(3);
}

const { existsSync, readFileSync, statSync } = await import("node:fs");
const { basename, extname } = await import("node:path");

if (!existsSync(imagePath)) {
  console.error(`File not found: ${imagePath}`);
  process.exit(4);
}

const stat = statSync(imagePath);
const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

console.log("");
console.log("── Private card validation ─────────────────────────────────");
console.log(`  file:  ${basename(imagePath)}`);
console.log(`  size:  ${sizeMb} MB`);
console.log("");

// Post to /api/parse-card running locally. The dev server must be
// up; otherwise this exits with a clear message rather than faking
// results.
const apiBase = process.env.HATHOR_API_BASE ?? "http://localhost:3000";
const parseUrl = `${apiBase}/api/parse-card`;

const form = new FormData();
const ext = extname(imagePath).toLowerCase();
const mediaType =
  ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
const blob = new Blob([readFileSync(imagePath)], { type: mediaType });
form.append("file", blob, basename(imagePath));

let response;
try {
  response = await fetch(parseUrl, { method: "POST", body: form });
} catch (err) {
  console.error(`Dev server unreachable at ${apiBase}.`);
  console.error(
    "  Start it with: cd web && npm run dev  (and set ANTHROPIC_API_KEY)",
  );
  console.error(`  cause: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(5);
}

if (!response.ok) {
  const body = await response.text();
  console.error(`parse-card returned ${response.status}:`);
  console.error(body);
  process.exit(6);
}

const parsed = await response.json();
const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
const visionRows = rows.filter(
  (r) => r.source === "vision" || r.source === undefined,
);
const visionAmbig = visionRows.filter((r) => (r.confidence ?? 0) < 0.85);
const inferred = rows.filter((r) => r.source === "template_inferred");
const wouldPass = visionRows.filter((r) => (r.confidence ?? 0) >= 0.85);

console.log("── Pipeline summary ───────────────────────────────────────");
console.log(`  rows returned        : ${rows.length}`);
console.log(`  vision rows          : ${visionRows.length}`);
console.log(`    · high confidence  : ${wouldPass.length}`);
console.log(`    · ambiguous (<.85) : ${visionAmbig.length}`);
console.log(`  template-inferred    : ${inferred.length}`);
console.log(`  confirmation gate    : ${wouldPass.length} rows`);
console.log(
  `  template match       : ${parsed.documentIntelligence?.recognized_template_id ?? "(missing)"}`,
);
console.log("");
console.log(
  "  Template-inferred rows never pre-pass the gate; the clinician must",
);
console.log("  confirm them before reconciliation runs.");
console.log("");

// Optional write of the SUMMARY ONLY — never the raw payload. Also
// gated behind an explicit env var.
const writePath = process.env.HATHOR_PRIVATE_VALIDATION_WRITE;
if (writePath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    writePath,
    JSON.stringify(
      {
        file: basename(imagePath),
        size_mb: sizeMb,
        rows_total: rows.length,
        vision_rows: visionRows.length,
        vision_high_confidence: wouldPass.length,
        vision_ambiguous: visionAmbig.length,
        template_inferred: inferred.length,
        confirmation_gate_admitted: wouldPass.length,
        template_match:
          parsed.documentIntelligence?.recognized_template_id ?? null,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`  wrote summary → ${writePath}`);
  console.log(
    "  (raw vision payload was NOT written; summary counts only)",
  );
  console.log("");
}
