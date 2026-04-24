import type { ValidationResult } from "./api";

export interface PhaseERecommendationSummaryInput {
  recommendation_id: string;
  kind: string;
  antigen: string;
  source_dose_indices?: number[];
}

export interface PhaseEGroup {
  recommendationId: string;
  recommendation?: PhaseERecommendationSummaryInput;
  results: ValidationResult[];
  primaryResult: ValidationResult;
}

export interface PhaseESummary {
  cardStatus: "Review required" | "Ready after confirmation";
  dosesFound: number;
  confirmedMatches: number;
  needsClinicianReview: number;
  missingOrUncertainVaccines: number;
  exportStatus: string;
  groups: PhaseEGroup[];
  actionableGroups: PhaseEGroup[];
  passResults: ValidationResult[];
}

const SEVERITY_WEIGHT: Record<ValidationResult["severity"], number> = {
  pass: 0,
  warn: 1,
  fail: 2,
  override_required: 3,
};

function isSourceBackedDose(rec?: PhaseERecommendationSummaryInput) {
  return (
    rec?.kind === "dose_verdict" &&
    Array.isArray(rec.source_dose_indices) &&
    rec.source_dose_indices.length > 0
  );
}

function isMissingOrUncertain(group: PhaseEGroup) {
  const rec = group.recommendation;
  return (
    group.primaryResult.severity !== "pass" &&
    (
      !rec ||
      !Array.isArray(rec.source_dose_indices) ||
      rec.source_dose_indices.length === 0 ||
      group.primaryResult.severity === "warn"
    )
  );
}

export function buildPhaseESummary(
  activeResults: ValidationResult[],
  recommendations: Record<string, PhaseERecommendationSummaryInput>,
  resolvedRecommendationIds: Set<string> = new Set(),
): PhaseESummary {
  const byRecommendation = new Map<string, ValidationResult[]>();
  const firstOrder: string[] = [];

  for (const result of activeResults) {
    if (!byRecommendation.has(result.recommendation_id)) {
      byRecommendation.set(result.recommendation_id, []);
      firstOrder.push(result.recommendation_id);
    }
    byRecommendation.get(result.recommendation_id)!.push(result);
  }

  const groups = firstOrder.map((recommendationId) => {
    const results = byRecommendation.get(recommendationId)!;
    const primaryResult = [...results].sort(
      (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
    )[0];
    return {
      recommendationId,
      recommendation: recommendations[recommendationId],
      results,
      primaryResult,
    };
  });

  const unresolvedActionable = groups.filter(
    (group) =>
      group.primaryResult.severity !== "pass" &&
      !resolvedRecommendationIds.has(group.recommendationId),
  );

  const passResults = activeResults.filter((result) => result.severity === "pass");
  const dosesFound = groups.filter((group) => isSourceBackedDose(group.recommendation)).length;
  const confirmedMatches = groups.filter(
    (group) =>
      isSourceBackedDose(group.recommendation) &&
      group.results.every((result) => result.severity === "pass"),
  ).length;
  const missingOrUncertainVaccines = unresolvedActionable.filter(isMissingOrUncertain).length;

  return {
    cardStatus: unresolvedActionable.length > 0
      ? "Review required"
      : "Ready after confirmation",
    dosesFound,
    confirmedMatches,
    needsClinicianReview: unresolvedActionable.length,
    missingOrUncertainVaccines,
    exportStatus: unresolvedActionable.length > 0
      ? "Blocked pending clinician review"
      : "Ready after confirmation",
    groups,
    actionableGroups: unresolvedActionable,
    passResults,
  };
}
