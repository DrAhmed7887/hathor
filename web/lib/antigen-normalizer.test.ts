/**
 * Tests for the Haiku-4.5 antigen normalizer sub-agent.
 *
 * The normalizer calls the Anthropic API; tests inject a mock client
 * so they run without network and without an API key. The contract
 * under test is the input/output shape and the safety coercion — the
 * model's clinical judgement is exercised in the real /api/parse-card
 * call path, not here.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CANONICAL_ANTIGENS,
  applyNormalizationsToRows,
  normalizeAntigens,
} from "./antigen-normalizer.ts";
import type { ParsedCardRow } from "./types.ts";

// ── Minimal mock Anthropic client ──────────────────────────────────────────
//
// Only the surface area normalizeAntigens uses: messages.create returning
// { content: [{ type: "tool_use", input: {...} }], stop_reason: "tool_use" }.

interface MockToolUseBlock {
  type: "tool_use";
  input: unknown;
}

interface MockResponse {
  content: MockToolUseBlock[];
  stop_reason: string;
}

function mockClient(response: MockResponse) {
  // Cast through unknown — tests do not need the full SDK type.
  return {
    messages: {
      create: async () => response,
    },
  } as unknown as Parameters<typeof normalizeAntigens>[0]["client"];
}

function row(antigen: string): ParsedCardRow {
  return {
    antigen,
    date: "2024-05-01",
    doseNumber: 1,
    doseKind: "primary",
    confidence: 0.95,
    reasoningIfUncertain: null,
    imageCropRegion: { x: 0, y: 0, width: 1, height: 0.1 },
    source: "vision",
  };
}

// ── normalizeAntigens ──────────────────────────────────────────────────────

test("normalizeAntigens: empty input returns empty array without calling the API", async () => {
  let called = false;
  const client = {
    messages: {
      create: async () => {
        called = true;
        return { content: [], stop_reason: "" };
      },
    },
  } as unknown as Parameters<typeof normalizeAntigens>[0]["client"];

  const out = await normalizeAntigens({ labels: [], client });
  assert.equal(out.length, 0);
  assert.equal(called, false, "empty input must short-circuit before API call");
});

test("normalizeAntigens: maps Hexyon to its component antigens", async () => {
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            {
              input: "Hexyon",
              canonical_antigens: ["DTP", "HepB", "Hib", "IPV"],
            },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({ labels: ["Hexyon"], client });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].canonical_antigens, ["DTP", "HepB", "Hib", "IPV"]);
});

test("normalizeAntigens: preserves input order even if the tool reorders", async () => {
  // Tool returns mappings in reverse order — caller still gets them
  // back in the order they passed in.
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            { input: "OPV", canonical_antigens: ["OPV"] },
            { input: "BCG", canonical_antigens: ["BCG"] },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({
    labels: ["BCG", "OPV"],
    client,
  });
  assert.deepEqual(out.map((m) => m.input), ["BCG", "OPV"]);
  assert.deepEqual(out[0].canonical_antigens, ["BCG"]);
  assert.deepEqual(out[1].canonical_antigens, ["OPV"]);
});

test("normalizeAntigens: drops antigen codes outside the canonical set", async () => {
  // The schema enum guards against this at the API boundary, but the
  // runtime coercion is the second line of defence in case the schema
  // ever loosens. "FakeFlu" is not canonical → dropped.
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            {
              input: "MultiPro",
              canonical_antigens: ["DTP", "FakeFlu", "Hib"],
            },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({ labels: ["MultiPro"], client });
  assert.deepEqual(out[0].canonical_antigens, ["DTP", "Hib"]);
});

test("normalizeAntigens: emits empty canonical_antigens for unmapped labels", async () => {
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            { input: "MysteryDrug", canonical_antigens: [] },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({ labels: ["MysteryDrug"], client });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].canonical_antigens, []);
});

test("normalizeAntigens: throws when the model fails to call the tool", async () => {
  const client = mockClient({
    stop_reason: "end_turn",
    content: [], // no tool_use block
  });

  await assert.rejects(
    normalizeAntigens({ labels: ["BCG"], client }),
    /did not call record_canonical_antigens/,
  );
});

test("normalizeAntigens: deduplicates repeated canonical antigens", async () => {
  // A model that mistakenly emits "DTP" twice in one mapping should
  // yield a single "DTP" entry — defensive in case prompt or schema
  // drift allows duplicates through.
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            {
              input: "DTP",
              canonical_antigens: ["DTP", "DTP"],
            },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({ labels: ["DTP"], client });
  assert.deepEqual(out[0].canonical_antigens, ["DTP"]);
});

// ── applyNormalizationsToRows ──────────────────────────────────────────────

test("applyNormalizationsToRows: attaches canonicalAntigens to matching rows", () => {
  const rows = [row("Hexyon"), row("BCG")];
  const out = applyNormalizationsToRows(rows, [
    {
      input: "Hexyon",
      canonical_antigens: ["DTP", "HepB", "Hib", "IPV"],
    },
    { input: "BCG", canonical_antigens: ["BCG"] },
  ]);
  assert.deepEqual(out[0].canonicalAntigens, ["DTP", "HepB", "Hib", "IPV"]);
  assert.deepEqual(out[1].canonicalAntigens, ["BCG"]);
});

test("applyNormalizationsToRows: leaves canonicalAntigens undefined when normalization is empty", () => {
  const rows = [row("MysteryDrug")];
  const out = applyNormalizationsToRows(rows, [
    { input: "MysteryDrug", canonical_antigens: [] },
  ]);
  assert.equal(out[0].canonicalAntigens, undefined);
});

test("applyNormalizationsToRows: passes rows through unchanged when normalizations is empty", () => {
  const rows = [row("BCG")];
  const out = applyNormalizationsToRows(rows, []);
  assert.equal(out, rows, "empty normalizations should short-circuit");
});

test("applyNormalizationsToRows: does not mutate input rows", () => {
  const rows = [row("Hexyon")];
  const before = JSON.stringify(rows[0]);
  applyNormalizationsToRows(rows, [
    {
      input: "Hexyon",
      canonical_antigens: ["DTP", "HepB", "Hib", "IPV"],
    },
  ]);
  assert.equal(JSON.stringify(rows[0]), before);
});

test("normalizeAntigens: Measles monovalent passes through as Measles only (not MMR)", async () => {
  // Clinical-safety regression: Nigeria's 9-month measles monovalent
  // dose must NOT be silently re-labelled as MMR. The downstream
  // catch-up logic for an Egyptian schedule treats these differently.
  // The Haiku response below mirrors what the prompt instructs the
  // model to emit; this test pins the coercion layer's behaviour
  // when the model behaves correctly.
  const client = mockClient({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        input: {
          mappings: [
            { input: "Measles", canonical_antigens: ["Measles"] },
            {
              input: "MMR",
              canonical_antigens: ["MMR", "Measles", "Mumps", "Rubella"],
            },
          ],
        },
      },
    ],
  });

  const out = await normalizeAntigens({
    labels: ["Measles", "MMR"],
    client,
  });

  assert.deepEqual(out[0].canonical_antigens, ["Measles"]);
  assert.equal(
    out[0].canonical_antigens.includes("MMR"),
    false,
    "Measles must never expand to include MMR",
  );
  // MMR DOES expand to its components, including the combined code.
  assert.ok(out[1].canonical_antigens.includes("MMR"));
  assert.ok(out[1].canonical_antigens.includes("Measles"));
  assert.ok(out[1].canonical_antigens.includes("Mumps"));
  assert.ok(out[1].canonical_antigens.includes("Rubella"));
});

test("applyNormalizationsToRows: never overwrites the row's antigen text", () => {
  // Even if the normalizer (or a future bug) returned bogus mappings,
  // the row's `antigen` string — the field downstream clinical logic
  // and Phase E read — must never be replaced. Normalization is
  // additive; canonicalAntigens is a HINT, not a substitution.
  const rows = [row("Measles")];
  const out = applyNormalizationsToRows(rows, [
    {
      input: "Measles",
      canonical_antigens: ["Measles"],
    },
  ]);
  assert.equal(out[0].antigen, "Measles", "antigen text is preserved");
  assert.deepEqual(out[0].canonicalAntigens, ["Measles"]);
});

test("CANONICAL_ANTIGENS contains the antigens Hathor's deterministic tool speaks", () => {
  // Spot check — the canonical list must include every antigen the
  // schedule engine and `lookup_vaccine_equivalence` produce. Drift
  // here would make Haiku silently strip valid mappings.
  for (const expected of [
    "BCG",
    "HepB",
    "OPV",
    "IPV",
    "DTP",
    "Hib",
    "PCV",
    "Rotavirus",
    "MMR",
    "Measles",
    "Varicella",
    "YellowFever",
  ]) {
    assert.ok(
      (CANONICAL_ANTIGENS as readonly string[]).includes(expected),
      `${expected} must be in CANONICAL_ANTIGENS`,
    );
  }
});
