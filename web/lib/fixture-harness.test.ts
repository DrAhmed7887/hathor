/**
 * Baseline assertions for the synthetic-fixture E2E harness.
 *
 * PR 0 SCOPE: freeze the PRE-FIX behavior of the deterministic
 * pipeline across all 14 committed synthetic fixtures × 3 drop modes.
 * PR 1 will intentionally break some of the `partial_vision`
 * assertions below — that is the measurable evidence that lifting the
 * zero-rows guard changes behavior in the expected direction. When
 * PR 1's implementation lands, update the tagged assertions (search
 * for "BASELINE-PR0" in this file) and leave a one-line note on how
 * the number changed and why.
 *
 * Run:
 *   node --experimental-strip-types --test web/lib/fixture-harness.test.ts
 *   npm test
 *
 * Coverage:
 *   - Egyptian MoHP fixtures route to the egypt template id.
 *   - Non-Egyptian fixtures route to unknown_vaccine_card and never
 *     produce template-inferred rows.
 *   - full_vision preserves every expected row, fires no inference.
 *   - partial_vision PRESERVES PR 0 BUG (zero-rows guard suppresses
 *     inference when any vision row survived). PR 1 flips this.
 *   - zero_vision is the only current path where inference fires.
 *   - The confirmation-gate preview excludes ambiguous and inferred
 *     rows — the Step 4 invariant future code must uphold.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadManifest,
  runScenario,
  type DropMode,
  type ManifestFixture,
} from "./fixture-harness.ts";

const MANIFEST = loadManifest();
const EGYPTIAN_FIXTURES = MANIFEST.fixtures.filter(
  (f) =>
    f.expected_template_id === "egypt_mohp_mandatory_childhood_immunization",
);
const NON_EGYPTIAN_FIXTURES = MANIFEST.fixtures.filter(
  (f) => f.expected_template_id === "unknown_vaccine_card",
);

test("manifest: the committed fixture set includes both template families", () => {
  assert.equal(
    MANIFEST.fixtures.length,
    14,
    "fixture count drift — regenerate with generate_synthetic_vaccination_cards.py",
  );
  assert.ok(
    EGYPTIAN_FIXTURES.length >= 8,
    "expected the majority of fixtures to target the Egyptian MoHP template",
  );
  assert.ok(
    NON_EGYPTIAN_FIXTURES.length >= 2,
    "expected at least two non-Egyptian fixtures as negative controls",
  );
});

// ── Egyptian fixtures × drop modes ──────────────────────────────────────────

for (const fixture of EGYPTIAN_FIXTURES) {
  test(`${fixture.id} · full_vision: every expected row survives, no inference`, () => {
    const run = runScenario(fixture, "full_vision");
    assert.equal(run.rows_in, fixture.expected_rows.length);
    assert.equal(run.rows_out, fixture.expected_rows.length);
    assert.equal(run.vision_rows, fixture.expected_rows.length);
    assert.equal(run.template_inferred_rows, 0);
    assert.equal(run.inference_fired, false);
    assert.equal(
      run.would_pass_confirmation_gate,
      run.rows_in_high_confidence,
      "confirmation-gate preview must equal the count of high-confidence vision rows",
    );
  });

  test(`${fixture.id} · partial_vision: inference fires per unfilled template row`, () => {
    const run = runScenario(fixture, "partial_vision");
    const keptCount = Math.ceil(fixture.expected_rows.length / 2);
    const TEMPLATE_SPECS = 9; // Egyptian MoHP has nine row_specs
    // PR 1: inference now fires per unfilled template row. For the
    // Egyptian template with nine specs, antigen-greedy matching
    // fills up to `keptCount` specs; the remaining (9 - keptCount)
    // specs surface as AMBER template-inferred slots. Each vision
    // row with a template antigen match claims exactly one spec, so
    // no duplicate predictions are emitted.
    const expectedInferred = Math.max(0, TEMPLATE_SPECS - keptCount);
    assert.equal(run.rows_in, keptCount);
    assert.equal(run.template_inferred_rows, expectedInferred);
    assert.equal(run.inference_fired, expectedInferred > 0);
    assert.equal(run.rows_out, keptCount + expectedInferred);
    // Confirmation-gate invariant across PR 0 and PR 1: template-
    // inferred rows NEVER pre-pass. The gate admits exactly the
    // high-confidence vision rows.
    assert.equal(
      run.would_pass_confirmation_gate,
      run.rows_in_high_confidence,
    );
  });

  test(`${fixture.id} · zero_vision: template inference fires and emits AMBER predictions`, () => {
    const run = runScenario(fixture, "zero_vision");
    assert.equal(run.rows_in, 0);
    // Template inference produces min(date_fragments, template_row_specs)
    // rows. For Egyptian fixtures the template has 9 row specs and the
    // harness emits one date fragment per expected_row — fixtures with
    // 9 expected rows produce 9 inferred rows; fixtures with more
    // date_cells emit unmapped_date_texts warnings rather than extra
    // rows. Assert the ceiling invariant only (template has 9 specs).
    assert.ok(
      run.template_inferred_rows <= 9,
      `${fixture.id} emitted ${run.template_inferred_rows} inferred rows; template has 9 specs`,
    );
    assert.ok(
      run.template_inferred_rows > 0,
      `${fixture.id} zero_vision should fire inference but did not`,
    );
    assert.equal(run.inference_fired, true);
    assert.equal(run.vision_rows, 0);
    assert.equal(
      run.would_pass_confirmation_gate,
      0,
      "template-inferred rows must never pre-pass the confirmation gate",
    );
  });
}

// ── Non-Egyptian fixtures: never produce template-inferred rows ─────────────

for (const fixture of NON_EGYPTIAN_FIXTURES) {
  for (const mode of ["full_vision", "partial_vision", "zero_vision"] as DropMode[]) {
    test(`${fixture.id} · ${mode}: unknown template never infers`, () => {
      const run = runScenario(fixture, mode);
      assert.equal(run.template_id, "unknown_vaccine_card");
      assert.equal(
        run.template_inferred_rows,
        0,
        "unknown template must never synthesize rows",
      );
      assert.equal(run.inference_fired, false);
      // Confirmation gate never admits non-vision rows, no matter what.
      assert.ok(
        run.would_pass_confirmation_gate <= run.rows_in_high_confidence,
      );
    });
  }
}

// ── Global invariants (apply across every fixture × every drop mode) ────────

test("invariant: template-inferred rows never pre-pass the confirmation gate", () => {
  const modes: DropMode[] = ["full_vision", "partial_vision", "zero_vision"];
  for (const fixture of MANIFEST.fixtures) {
    for (const mode of modes) {
      const run = runScenario(fixture, mode);
      if (run.template_inferred_rows > 0) {
        // The Step 4 (PR 1) filter will enforce this in production
        // code; PR 0 asserts the preview respects it already.
        const inferredAdmitted =
          run.would_pass_confirmation_gate >
          run.vision_rows - run.vision_ambiguous_rows;
        assert.equal(
          inferredAdmitted,
          false,
          `${fixture.id}/${mode}: confirmation gate admitted a template-inferred row`,
        );
      }
    }
  }
});

test("invariant: full_vision run count equals manifest expected_rows length", () => {
  for (const fixture of MANIFEST.fixtures) {
    const run = runScenario(fixture, "full_vision");
    assert.equal(
      run.rows_in,
      fixture.expected_rows.length,
      `${fixture.id}: rows_in ${run.rows_in} != expected ${fixture.expected_rows.length}`,
    );
  }
});

// ── Diagnostic report helper ───────────────────────────────────────────────
// Printed when HATHOR_HARNESS_VERBOSE is set; silent in CI. Useful for
// Ahmed running the suite locally to see the baseline table.

function formatRun(fixture: ManifestFixture, mode: DropMode): string {
  const r = runScenario(fixture, mode);
  return [
    r.fixture_id.padEnd(48),
    mode.padEnd(16),
    `in=${r.rows_in}/${fixture.expected_rows.length}`.padEnd(10),
    `out=${r.rows_out}`.padEnd(8),
    `inferred=${r.template_inferred_rows}`.padEnd(14),
    `confirm=${r.would_pass_confirmation_gate}`,
  ].join("  ");
}

test("diagnostic: print baseline table when HATHOR_HARNESS_VERBOSE is set", () => {
  if (process.env.HATHOR_HARNESS_VERBOSE !== "1") return;
  const modes: DropMode[] = ["full_vision", "partial_vision", "zero_vision"];
  console.log("");
  console.log(
    "── Baseline table (PR 0) ─────────────────────────────────────────",
  );
  for (const fixture of MANIFEST.fixtures) {
    for (const mode of modes) {
      console.log(formatRun(fixture, mode));
    }
  }
  console.log(
    "──────────────────────────────────────────────────────────────────",
  );
});
