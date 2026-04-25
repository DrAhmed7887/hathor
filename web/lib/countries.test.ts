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

test("Sudan, South Sudan, Eritrea, Ethiopia are needs_review", () => {
  const refugeeCodes: CountryCode[] = ["SD", "SS", "ER", "ET"];
  for (const code of refugeeCodes) {
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

test("Nigeria is included as needs_review and not labelled partial_ready", () => {
  assert.equal(COUNTRIES.NG.readiness, "needs_review");
  assert.equal(canRunReconciliation("NG"), false);
});

test("source selector lists every African country plus Egypt", () => {
  const codes = SELECTABLE_SOURCE_COUNTRIES.map((c) => c.code).sort();
  assert.deepEqual(codes, ["EG", "ER", "ET", "NG", "SD", "SS"]);
});

test("destination selector lists Egypt + needs_review African countries", () => {
  const codes = SELECTABLE_DESTINATION_COUNTRIES.map((c) => c.code).sort();
  assert.deepEqual(codes, ["EG", "ER", "ET", "NG", "SD", "SS"]);
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
  // The hackathon prompt is explicit: NG is included as an
  // English-language demo only, NOT as a top-by-number migration group.
  assert.doesNotMatch(text, /top\s+(migration|refugee)/);
  assert.match(text, /english/);
});
