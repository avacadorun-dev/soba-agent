import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustManager } from "../../../src/application/trust/trust-manager";
import { EvidenceLedger } from "../../../src/engine/evidence/evidence-ledger";
import { runAutoVerifier } from "../../../src/engine/verification/auto-verifier";
import type { ProjectCommandFileReader } from "../../../src/engine/verification/types";
import type { ToolDefinition, ToolResult } from "../../../src/kernel/tools/types";

describe("auto verifier", () => {
  test("code mutation triggers targeted verification commands", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {
        scripts: {
          test: "bun test tests/unit.test.ts",
          lint: "biome check .",
        },
      });
      await writeFile(join(cwd, "tsconfig.json"), "{}");
      const ledger = ledgerWithMutation("src/core/file.ts");
      const executed: string[] = [];

      const result = await runAutoVerifier({
        cwd,
        taskKind: "bug_fix",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });

      expect(result.executions.map((execution) => execution.call.args.command)).toEqual([
        "bun test tests/unit.test.ts",
        "bun run lint",
        "bunx tsc --noEmit",
      ]);
      expect(executed).toEqual(["bun test tests/unit.test.ts", "bun run lint", "bunx tsc --noEmit"]);
      expect(ledger.getSummary().needsVerification).toBe(false);
    });
  });

  test("docs-only mutation does not trigger full command gate by default", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("docs/readme.md");

      const result = await runAutoVerifier({
        cwd,
        taskKind: "docs_change",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool([]),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });

      expect(result.executions).toEqual([]);
      expect(result.skipped[0]?.reason).toContain("Docs-only mutation");
      expect(ledger.getSummary().needsVerification).toBe(true);
    });
  });

  test("docs-only mutation skips command gates even if prompt task kind was feature", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("docs/guide.md");
      const executed: string[] = [];

      const result = await runAutoVerifier({
        cwd,
        taskKind: "feature",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });

      expect(result.executions).toEqual([]);
      expect(executed).toEqual([]);
      expect(result.skipped[0]?.reason).toContain("Docs-only mutation");
    });
  });

  test("failing command produces failed verification evidence and active diagnostic", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("src/core/file.ts");

      await runAutoVerifier({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool([], true),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });

      const entries = ledger.getEntries();
      expect(entries.some((entry) => entry.kind === "verification" && entry.status === "failure")).toBe(true);
      expect(ledger.getSummary().activeDiagnosticIds).toHaveLength(1);
      expect(ledger.getSummary().needsVerification).toBe(true);
    });
  });

  test("skipped command includes reason and is recorded in ledger", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("src/core/file.ts");
      const trustManager = new TrustManager({ repoRoot: cwd });
      trustManager.addCommandRule("bun test", "dangerous");

      const result = await runAutoVerifier({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool([]),
        toolContext: { cwd },
        trustManager,
        projectFiles: testProjectFiles(cwd),
      });

      expect(result.executions).toEqual([]);
      expect(result.skipped[0]?.reason).toContain("requires confirmation");
      expect(ledger.getEntries().some((entry) => entry.status === "rejected" && entry.summary.includes("skipped"))).toBe(
        true,
      );
    });
  });

  test("does not re-run identical verification for the same mutation set", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("src/core/file.ts");
      const attemptedFingerprints = new Set<string>();
      const executed: string[] = [];

      await runAutoVerifier({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed, true),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        attemptedFingerprints,
        projectFiles: testProjectFiles(cwd),
      });
      const second = await runAutoVerifier({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed, true),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        attemptedFingerprints,
        projectFiles: testProjectFiles(cwd),
      });

      expect(executed).toEqual(["bun test"]);
      expect(second.executions).toEqual([]);
      expect(second.skipped[0]?.reason).toContain("already attempted");
    });
  });

  test("uses generic run command from project instructions for unknown toolchains", async () => {
    await withFixture(async (cwd) => {
      const ledger = ledgerWithMutation("legacy/PAYROLL.COB");
      const executed: string[] = [];

      const result = await runAutoVerifier({
        cwd,
        taskKind: "feature",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectInstructions: ["Use `make verify` for this project."],
        projectFiles: testProjectFiles(cwd),
      });

      expect(result.executions.map((execution) => execution.call.args.command)).toContain("make verify");
      expect(executed).toContain("make verify");
      expect(ledger.getSummary().verificationKinds.has("run")).toBe(true);
      expect(ledger.getSummary().needsVerification).toBe(false);
    });
  });
});

function ledgerWithMutation(path: string): EvidenceLedger {
  const ledger = new EvidenceLedger();
  ledger.recordToolOutcome({
    toolCallId: "edit_1",
    toolName: "edit",
    arguments: JSON.stringify({ path }),
    isError: false,
    output: "edited",
    iteration: 1,
  });
  return ledger;
}

function makeBashTool(executed: string[], fail = false): ToolDefinition<Record<string, unknown>> {
  return {
    name: "bash",
    label: "bash",
    description: "Mock bash",
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(args): Promise<ToolResult> {
      const command = typeof args.command === "string" ? args.command : "";
      executed.push(command);
      return {
        content: [{ type: "text", text: fail ? "failed" : "passed" }],
        isError: fail,
      };
    },
  };
}

function testProjectFiles(cwd: string): ProjectCommandFileReader {
  return {
    async readText(relativePath) {
      try {
        return await readFile(join(cwd, relativePath), "utf8");
      } catch {
        return null;
      }
    },
    async exists(relativePath) {
      try {
        await stat(join(cwd, relativePath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "soba-auto-verifier-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writePackageJson(cwd: string, packageJson: Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}
