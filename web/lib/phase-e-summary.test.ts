import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPhaseESummary } from "./phase-e-summary.ts";
import type { ValidationResult } from "./api.ts";

function result(
  recommendation_id: string,
  severity: ValidationResult["severity"],
  rule_slug: string,
): ValidationResult {
  return {
    recommendation_id,
    severity,
    rule_id: `TEST-${rule_slug}`,
    rule_slug,
    rule_rationale: `${rule_slug} rationale`,
    override_allowed: true,
    override_logged_as: "AuditEvent",
    supersedes: null,
    override_justification_codes: [],
  };
}

test("Phase E summary hides pass-only rows from actionable groups", () => {
  const summary = buildPhaseESummary(
    [
      result("rec-bcg", "pass", "antigen_in_scope"),
      result("rec-bcg", "pass", "min_age_valid"),
      result("rec-rota", "pass", "antigen_in_scope"),
      result("rec-rota", "override_required", "rotavirus_age_cutoff"),
    ],
    {
      "rec-bcg": {
        recommendation_id: "rec-bcg",
        kind: "dose_verdict",
        antigen: "BCG",
        source_dose_indices: [0],
      },
      "rec-rota": {
        recommendation_id: "rec-rota",
        kind: "dose_verdict",
        antigen: "Rotavirus",
        source_dose_indices: [],
      },
    },
  );

  assert.equal(summary.cardStatus, "Review required");
  assert.equal(summary.dosesFound, 1);
  assert.equal(summary.confirmedMatches, 1);
  assert.equal(summary.needsClinicianReview, 1);
  assert.equal(summary.missingOrUncertainVaccines, 1);
  assert.equal(summary.actionableGroups.length, 1);
  assert.equal(summary.actionableGroups[0].recommendationId, "rec-rota");
  assert.equal(summary.passResults.length, 3);
});

test("Phase E summary treats submitted reviews as resolved", () => {
  const summary = buildPhaseESummary(
    [result("rec-rota", "override_required", "rotavirus_age_cutoff")],
    {
      "rec-rota": {
        recommendation_id: "rec-rota",
        kind: "dose_verdict",
        antigen: "Rotavirus",
        source_dose_indices: [],
      },
    },
    new Set(["rec-rota"]),
  );

  assert.equal(summary.cardStatus, "Ready after confirmation");
  assert.equal(summary.needsClinicianReview, 0);
  assert.equal(summary.exportStatus, "Ready after confirmation");
});
