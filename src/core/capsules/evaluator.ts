/**
 * Deterministic quality evaluator for portable capsules.
 *
 * This evaluator is intentionally lexical and stable. It checks whether a
 * portable capsule preserved the receiver-relevant facts that can be verified
 * without invoking a model.
 */

import type { ArtifactLedger } from "../session/types-v2";
import type { PortableCapsule } from "./types";

export interface PortableCapsuleQualityExpectation {
  goalKeywords: string[];
  decisions: string[];
  blockers: string[];
  artifacts: Partial<ArtifactLedger>;
  integrationActions: string[];
}

export interface PortableCapsuleQualityDimension {
  name: "goal" | "decisions" | "blockers" | "artifacts" | "integration";
  score: number;
  weight: number;
  matched: number;
  expected: number;
  missing: string[];
}

export interface PortableCapsuleQualityResult {
  score: number;
  passed: boolean;
  threshold: number;
  dimensions: PortableCapsuleQualityDimension[];
}

export interface PortableCapsuleQualityEvaluatorOptions {
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.9;
const WEIGHTS: Record<PortableCapsuleQualityDimension["name"], number> = {
  goal: 0.2,
  decisions: 0.2,
  blockers: 0.15,
  artifacts: 0.3,
  integration: 0.15,
};

export class PortableCapsuleQualityEvaluator {
  private readonly threshold: number;

  constructor(options: PortableCapsuleQualityEvaluatorOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  evaluate(capsule: PortableCapsule, expectation: PortableCapsuleQualityExpectation): PortableCapsuleQualityResult {
    const dimensions: PortableCapsuleQualityDimension[] = [
      scoreTextDimension("goal", expectation.goalKeywords, capsuleText(capsule, ["objective", "dispatch", "core"])),
      scoreTextDimension("decisions", expectation.decisions, capsuleText(capsule, ["patterns", "core"])),
      scoreTextDimension("blockers", expectation.blockers, capsuleText(capsule, ["dispatch", "core"])),
      scoreArtifactDimension(expectation.artifacts, capsule.artifacts),
      scoreTextDimension("integration", expectation.integrationActions, capsuleText(capsule, ["integration", "signals", "core"])),
    ];
    const score = roundScore(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0));

    return {
      score,
      passed: score >= this.threshold,
      threshold: this.threshold,
      dimensions,
    };
  }
}

function scoreTextDimension(
  name: PortableCapsuleQualityDimension["name"],
  expected: string[],
  haystack: string,
): PortableCapsuleQualityDimension {
  const missing = expected.filter((item) => !containsNormalized(haystack, item));
  const matched = expected.length - missing.length;

  return {
    name,
    score: ratio(matched, expected.length),
    weight: WEIGHTS[name],
    matched,
    expected: expected.length,
    missing,
  };
}

function scoreArtifactDimension(
  expected: Partial<ArtifactLedger>,
  actual: ArtifactLedger,
): PortableCapsuleQualityDimension {
  const checks: Array<{ label: string; matched: boolean }> = [
    ...artifactListChecks("read", expected.readFiles, actual.readFiles),
    ...artifactListChecks("modified", expected.modifiedFiles, actual.modifiedFiles),
    ...artifactListChecks("command", expected.verificationCommands, actual.verificationCommands),
  ];

  if (expected.verificationStatus) {
    checks.push({
      label: `verificationStatus:${expected.verificationStatus}`,
      matched: expected.verificationStatus === actual.verificationStatus,
    });
  }

  const matched = checks.filter((check) => check.matched).length;
  const missing = checks.filter((check) => !check.matched).map((check) => check.label);

  return {
    name: "artifacts",
    score: ratio(matched, checks.length),
    weight: WEIGHTS.artifacts,
    matched,
    expected: checks.length,
    missing,
  };
}

function artifactListChecks(label: string, expected: string[] | undefined, actual: string[]): Array<{ label: string; matched: boolean }> {
  if (!expected) return [];
  const actualText = actual.map(normalizeText).join("\n");
  return expected.map((item) => ({
    label: `${label}:${item}`,
    matched: containsNormalized(actualText, item),
  }));
}

function capsuleText(
  capsule: PortableCapsule,
  sections: Array<"objective" | "dispatch" | "core" | "patterns" | "signals" | "integration">,
): string {
  const parts: string[] = [];
  for (const section of sections) {
    switch (section) {
      case "objective":
        parts.push(capsule.objective);
        break;
      case "dispatch":
        parts.push(capsule.dispatchSummary);
        break;
      case "core":
        parts.push(...capsule.coreContent);
        break;
      case "patterns":
        parts.push(...capsule.patterns.map((pattern) => `${pattern.name} ${pattern.description}`));
        break;
      case "signals":
        parts.push(...capsule.signals);
        break;
      case "integration":
        parts.push(
          ...capsule.integrationPlan.flatMap((step) => [
            step.title,
            ...step.prerequisites,
            ...step.actions,
            ...step.verification,
            ...step.rollback,
          ]),
        );
        break;
    }
  }
  return parts.join("\n");
}

function containsNormalized(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (normalizedNeedle.length === 0) return true;
  return normalizedHaystack.includes(normalizedNeedle);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function ratio(matched: number, expected: number): number {
  if (expected === 0) return 1;
  return roundScore(matched / expected);
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
