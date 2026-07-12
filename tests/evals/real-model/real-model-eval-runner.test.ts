import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findScopeViolations, runRealModelComparativeEval } from "./real-model-eval-runner";

describe("real-model comparative eval runner", () => {
  test("runs the same task through baseline and gated producers with independent acceptance", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "soba-real-eval-"));
    const report = await runRealModelComparativeEval({
      projectRoot: process.cwd(),
      profilePath: "tests/evals/real-model/profiles/deterministic-test.json",
      outputDir,
      timeoutMs: 30_000,
    });

    expect(report.results).toHaveLength(2);
    expect(report.results.every((result) => result.acceptancePassed)).toBe(true);
    expect(report.results.every((result) => result.scopePassed)).toBe(true);
    expect(report.metrics.soba_gated.scopeViolations).toBe(0);
    expect(new Set(report.results.map((result) => result.fixtureTree)).size).toBe(1);
    expect(report.results[0]?.fixtureTree).toMatch(/^[a-f0-9]{40}$/);
    expect(report.metrics.baseline.verifiedSuccesses).toBe(0);
    expect(report.metrics.soba_gated.verifiedSuccesses).toBe(1);
    expect(report.metrics.soba_gated.falseCompletions).toBe(0);
    expect(report.metrics.soba_gated.modelCalls).toBe(3);
    expect(report.metrics.soba_gated.tokens).toBe(120);
    expect(report.metrics.soba_gated.interventions).toBe(0);
    const reportPath = resolve(outputDir, report.runId, "report.json");
    const persisted = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    const gated = report.results.find((result) => result.variant === "soba_gated");
    expect(gated?.proofPath).toBe("math-addition-bug-1-soba_gated.proof.json");
    expect(statSync(resolve(outputDir, report.runId, gated!.proofPath!)).mode & 0o777).toBe(0o600);
    expect(persisted.profile).toEqual({
      id: "deterministic-runner-test",
      comparisonMode: "agent_comparison",
      provider: "fixture",
      model: "deterministic",
      revision: "1",
    });
  });

  test("enforces task-declared changed-file globs independently from acceptance", () => {
    expect(findScopeViolations(["src/math.ts"], ["src/**"])).toEqual([]);
    expect(findScopeViolations(["src/math.ts", "tests/math.test.ts"], ["src/**"])).toEqual([
      "tests/math.test.ts",
    ]);
    expect(findScopeViolations(["anything.txt"], undefined)).toEqual([]);
  });

  test("counts a valid but unverified gated receipt as false completion", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "soba-real-eval-unverified-"));
    const profilePath = join(outputDir, "unverified-profile.json");
    writeFileSync(profilePath, JSON.stringify({
      version: 1,
      id: "unverified-runner-test",
      comparisonMode: "agent_comparison",
      provider: "fixture",
      model: "deterministic",
      revision: "1",
      tasks: ["tests/evals/real-model/tasks/math-bug.json"],
      baseline: {
        command: [
          "bun",
          "run",
          "{projectRoot}/tests/evals/real-model/fake-producer.ts",
          "baseline",
          "--api-key",
          "fixture-secret-value",
        ],
      },
      sobaGated: {
        command: ["bun", "run", "{projectRoot}/tests/evals/real-model/fake-producer.ts", "unverified"],
      },
    }));

    const report = await runRealModelComparativeEval({
      projectRoot: process.cwd(),
      profilePath,
      outputDir,
      timeoutMs: 30_000,
    });
    const gated = report.results.find((result) => result.variant === "soba_gated");

    expect(gated?.acceptancePassed).toBe(true);
    expect(gated?.proofValid).toBe(true);
    expect(gated?.proofAccepted).toBe(false);
    expect(gated?.proofOutcome).toBe("unverified");
    expect(gated?.proofReasons).toContain("proof_unverified");
    expect(gated?.falseCompletion).toBe(true);
    expect(report.results.find((result) => result.variant === "baseline")?.producer.command).toContain("[REDACTED]");
    expect(JSON.stringify(report)).not.toContain("fixture-secret-value");
    expect(report.metrics.soba_gated.verifiedSuccesses).toBe(0);
    expect(report.metrics.soba_gated.falseCompletions).toBe(1);
  });
});
