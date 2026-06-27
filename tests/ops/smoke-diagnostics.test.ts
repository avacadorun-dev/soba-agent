import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";
import {
  parseSmokeDiagnosticsArgs,
  resolveSobaEntrypoint,
  runSmokeDiagnostics,
} from "../../scripts/smoke-diagnostics";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "soba-smoke-diagnostics-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("smoke diagnostics harness", () => {
  test("parses terminal-bench options", () => {
    expect(
      parseSmokeDiagnosticsArgs([
        "--profile",
        "terminal-bench",
        "--dry-run",
        "--json",
        "--run-external",
        "--require-external",
      ]),
    ).toEqual({
      profile: "terminal-bench",
      dryRun: true,
      json: true,
      runExternal: true,
      requireExternal: true,
      help: false,
    });
  });

  test("prefers a Linux x64 standalone binary for Terminal-Bench containers", () => {
    mkdirSync(join(tempDir, "dist", "bin"), { recursive: true });
    const binaryPath = join(tempDir, "dist", "bin", `soba-linux-x64-v${packageJson.version}`);
    writeFileSync(binaryPath, "");

    const entrypoint = resolveSobaEntrypoint({ cwd: tempDir });

    expect(entrypoint.mode).toBe("linux-x64-binary");
    expect(entrypoint.command).toEqual([binaryPath]);
  });

  test("falls back to built dist CLI when no Linux binary exists", () => {
    mkdirSync(join(tempDir, "dist"), { recursive: true });
    writeFileSync(join(tempDir, "dist", "cli.js"), "");

    const entrypoint = resolveSobaEntrypoint({ cwd: tempDir });

    expect(entrypoint.mode).toBe("bun-dist");
    expect(entrypoint.command).toEqual(["bun", join(tempDir, "dist", "cli.js")]);
  });

  test("runs local seed eval and CLI smoke steps", () => {
    const commands: string[][] = [];
    const result = runSmokeDiagnostics({
      cwd: tempDir,
      profile: "local",
      runCommand: (command) => {
        commands.push([...command]);
        return { exitCode: 0, stdout: "ok" };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed", "passed"]);
    expect(commands.map((command) => command.join(" "))).toEqual([
      "bun test tests/evals/agent-loop",
      "bun test tests/evals/skills",
      `bun ${join(tempDir, "src", "cli.ts")} --help`,
    ]);
  });

  test("skips Terminal-Bench container workload unless explicitly enabled", () => {
    const commands: string[][] = [];
    const result = runSmokeDiagnostics({
      commandExists: (command) => command === "harbor",
      cwd: tempDir,
      profile: "terminal-bench",
      runCommand: (command) => {
        commands.push([...command]);
        return { exitCode: 0 };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.steps.map((step) => [step.id, step.status])).toEqual([
      ["terminal-bench-entrypoint", "passed"],
      ["harbor-cli", "passed"],
      ["terminal-bench-oracle-smoke", "skipped"],
    ]);
    expect(commands).toEqual([["harbor", "--help"]]);
  });

  test("can require optional external smoke prerequisites", () => {
    const result = runSmokeDiagnostics({
      commandExists: () => false,
      cwd: tempDir,
      profile: "terminal-bench",
      requireExternal: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.steps.map((step) => [step.id, step.status])).toEqual([
      ["terminal-bench-entrypoint", "passed"],
      ["harbor-cli", "failed"],
      ["terminal-bench-oracle-smoke", "failed"],
    ]);
  });
});
