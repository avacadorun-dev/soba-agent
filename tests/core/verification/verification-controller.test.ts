import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustManager } from "../../../src/application/trust/trust-manager";
import { EvidenceLedger } from "../../../src/engine/evidence/evidence-ledger";
import type { ProjectCommandFileReader } from "../../../src/engine/verification/types";
import { VerificationController } from "../../../src/engine/verification/verification-controller";
import type { ToolDefinition, ToolResult } from "../../../src/kernel/tools/types";

describe("VerificationController", () => {
  test("runs auto-verification and keeps attempted fingerprints across calls", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const ledger = ledgerWithMutation("src/core/file.ts");
      const executed: string[] = [];
      const controller = new VerificationController();

      const first = await controller.runAutoVerification({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed, true),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });
      const second = await controller.runAutoVerification({
        cwd,
        taskKind: "test_failure",
        evidenceSummary: ledger.getSummary(),
        ledger,
        bashTool: makeBashTool(executed, true),
        toolContext: { cwd },
        trustManager: new TrustManager({ repoRoot: cwd }),
        projectFiles: testProjectFiles(cwd),
      });

      expect(first.didExecute).toBe(true);
      expect(second.didExecute).toBe(false);
      expect(second.result.skipped[0]?.reason).toContain("already attempted");
      expect(executed).toEqual(["bun test"]);
    });
  });

  test("maps failed and passed verification results through Fix-Until-Green", () => {
    const controller = new VerificationController();
    const ledger = ledgerWithMutation("src/core/file.ts");

    const recover = controller.observeVerificationToolResult({
      toolName: "bash",
      command: "bun test",
      isError: true,
      output: "(fail) parser > expected 1 got 2",
      ledger,
    });
    controller.recordMutationProgress("edit_2");
    const passed = controller.observeVerificationToolResult({
      toolName: "bash",
      command: "bun test",
      isError: false,
      output: "pass",
      ledger,
    });

    expect(recover.kind).toBe("recover");
    expect(passed.kind).toBe("passed");
    expect(ledger.getEntries().filter((entry) => entry.kind === "recovery_attempt")).toHaveLength(2);
  });

  test("ignores non-verification tool results", () => {
    const controller = new VerificationController();
    const result = controller.observeVerificationToolResult({
      toolName: "read",
      command: "",
      isError: false,
      output: "content",
      ledger: new EvidenceLedger(),
    });

    expect(result).toEqual({ kind: "none" });
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

async function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "soba-verification-controller-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writePackageJson(cwd: string, packageJson: Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
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
