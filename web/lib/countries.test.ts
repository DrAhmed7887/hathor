/**
 * Country selector readiness tests.
 *
 * Why this exists: the partial_ready / needs_review distinction is the
 * single safety gate keeping Hathor from producing engine due/overdue
 * verdicts against unverified country schedules. The hackathon prompt
 * is explicit that needs_review countries must NOT receive definitive
 * clinical recommendations. These tests pin that contract — if a
 * future commit silently flips a needs_review country to partial_ready
 * (or removes the gating helper), this suite fires before a demo
 * misleads anyone.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  COUNTRIES,
  COUNTRY_SELECTOR_DISCLOSURE,
  READINESS_BANNER,
  SELECTABLE_DESTINATION_COUNTRIES,
  SELECTABLE_SOURCE_COUNTRIES,
  VALIDATED_DESTINATION,
  canRunReconciliation,
} from "./countries.ts";
import type { CountryCode } from "./types.ts";

test("Egypt is the sole partial_ready destination", () => {
  assert.equal(VALIDATED_DESTINATION, "EG");
  assert.equal(COUNTRIES.EG.readiness, "partial_ready");
  assert.equal(canRunReconciliation("EG"), true);
});

test("Top-5 UNHCR-Egypt source countries + WHO baseline are needs_review", () => {
  // Sudan, Syria, South Sudan, Eritrea, Ethiopia + the generic WHO
  // baseline. None of these has a clinically-signed-off schedule for
  // this demo; engine reconciliation must NOT run against them.
  const sourceCodes: CountryCode[] = ["SD", "SY", "SS", "ER", "ET", "WHO"];
  for (const code of sourceCodes) {
    assert.equal(
      COUNTRIES[code].readiness,
      "needs_review",
      `${COUNTRIES[code].name} must remain needs_review until clinically verified`,
    );
    assert.equal(
      canRunReconciliation(code),
      false,
      `${COUNTRIES[code].name} must NOT trigger engine reconciliation`,
    );
  }
});

test("Nigeria is retained in the registry as needs_review (eval continuity)", () => {
  assert.equal(COUNTRIES.NG.readiness, "needs_review");
  assert.equal(canRunReconciliation("NG"), false);
});

test("source selector lists top-5 UNHCR-Egypt countries plus WHO baseline", () => {
  // Picker order matters in the UI but the contract here is set
  // membership: Sudan, Syria, South Sudan, Eritrea, Ethiopia, WHO.
  // Egypt is NOT a source option (it is the destination); Nigeria is
  // intentionally omitted as it is not a top-by-number UNHCR-Egypt
  // source population.
  const codes = SELECTABLE_SOURCE_COUNTRIES.map((c) => c.code).sort();
  assert.deepEqual(codes, ["ER", "ET", "SD", "SS", "SY", "WHO"]);
});

test("destination selector lists Egypt + the top-5 source set + WHO baseline", () => {
  const codes = SELECTABLE_DESTINATION_COUNTRIES.map((c) => c.code).sort();
  assert.deepEqual(codes, ["EG", "ER", "ET", "SD", "SS", "SY", "WHO"]);
});

test("readiness banner copy clearly says no due/overdue verdicts for needs_review", () => {
  const text = READINESS_BANNER.needs_review.body.toLowerCase();
  assert.match(text, /not\s+clinically\s+verified/);
  assert.match(text, /not\s+produce|not\s+definitive|under\s+review/);
});

test("country selector disclosure mentions Egypt as partial-ready and others under verification", () => {
  const text = COUNTRY_SELECTOR_DISCLOSURE.toLowerCase();
  assert.match(text, /egypt/);
  assert.match(text, /partial[\s-]?ready/);
  assert.match(text, /verification|review/);
});

test("Nigeria blurb does NOT claim it is a top migration group to Egypt", () => {
  const text = COUNTRIES.NG.blurb.toLowerCase();
  // Hackathon prompt: NG is NOT a top-by-number migration group to Egypt.
  // The blurb must not falsely imply it is.
  assert.doesNotMatch(text, /top\s+(migration|refugee)/);
  // Nigeria is now retained for clinical-eval continuity rather than
  // shown as a public source option, so the blurb should say so.
  assert.match(text, /reference|continuity|registry|not.*public/);
});

test("WHO baseline blurb explains it is a generic fall-back, not a national schedule", () => {
  const text = COUNTRIES.WHO.blurb.toLowerCase();
  assert.match(text, /who/);
  // Must signal "generic / baseline / fall-back" so a clinician does
  // not mistake it for a real national programme.
  assert.match(text, /generic|baseline|fall-?back/);
});

test("Syria is needs_review and surfaces the 2/4/6-month schedule note", () => {
  // Syria's primary series is age-based (2/4/6 months) rather than
  // WHO 6/10/14-week — the picker blurb should make that visible to
  // the clinician picking an upload context.
  assert.equal(COUNTRIES.SY.readiness, "needs_review");
  const text = COUNTRIES.SY.blurb.toLowerCase();
  assert.match(text, /2\/4\/6|2-4-6/);
});
