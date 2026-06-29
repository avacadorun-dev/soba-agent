import { describe, expect, it } from "bun:test";
import {
  buildPortableCapsuleFromCheckpoint,
  PortableCapsuleQualityEvaluator,
} from "../../../src/application/capsules";
import {
  conversationExpectation,
  makeConversationCheckpoint,
  makeStructuredCheckpoint,
  structuredExpectation,
  structuredIntegrationPlan,
} from "./quality-fixtures";

describe("PortableCapsuleQualityEvaluator", () => {
  it("оценивает structured fixture выше порога 0.9", () => {
    const capsule = buildPortableCapsuleFromCheckpoint(makeStructuredCheckpoint(), {
      createdAt: "2026-06-19T00:00:00.000Z",
      integrationPlan: structuredIntegrationPlan,
      tier: "standard",
    });
    const evaluator = new PortableCapsuleQualityEvaluator({ threshold: 0.9 });

    const result = evaluator.evaluate(capsule, structuredExpectation);

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.dimensions.find((dimension) => dimension.name === "artifacts")?.score).toBe(1);
  });

  it("оценивает conversation fixture выше порога 0.8", () => {
    const capsule = buildPortableCapsuleFromCheckpoint(makeConversationCheckpoint(), {
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const evaluator = new PortableCapsuleQualityEvaluator({ threshold: 0.8 });

    const result = evaluator.evaluate(capsule, conversationExpectation);

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it("проваливает capsule, потерявшую decisions и artifact ledger", () => {
    const capsule = buildPortableCapsuleFromCheckpoint(makeStructuredCheckpoint(), {
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const degraded = {
      ...capsule,
      coreContent: ["Goal: provider registry"],
      patterns: [],
      artifacts: {
        readFiles: [],
        modifiedFiles: [],
        verificationCommands: [],
        verificationStatus: "unknown" as const,
      },
    };
    const evaluator = new PortableCapsuleQualityEvaluator({ threshold: 0.9 });

    const result = evaluator.evaluate(degraded, structuredExpectation);

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(0.9);
    expect(result.dimensions.find((dimension) => dimension.name === "decisions")?.missing.length).toBeGreaterThan(0);
    expect(result.dimensions.find((dimension) => dimension.name === "artifacts")?.missing.length).toBeGreaterThan(0);
  });
});
