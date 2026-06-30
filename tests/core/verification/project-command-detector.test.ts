import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectCommands } from "../../../src/engine/verification/project-command-detector";
import type { ProjectCommandFileReader, ProjectCommandSet } from "../../../src/engine/verification/types";

describe("project command detector", () => {
  test("SOBA fixture returns Bun/Biome-first verification commands", async () => {
    const cwd = process.cwd();

    const commands = await detectProjectCommands({
      cwd,
      projectFiles: testProjectFiles(cwd),
      projectInstructions: ["SOBA Agent uses Bun, Biome, TypeScript, and bun test."],
      includeFullGate: true,
    });

    expect(firstCommand(commands, "test")).toBe("bun test");
    expect(firstCommand(commands, "lint")).toBe("bun run lint");
    expect(firstCommand(commands, "typecheck")).toBe("bun run typecheck");
    expect(firstCommand(commands, "build")).toBe("bun run build");
    expect(commands.deadCode).toEqual([]);
    expect(allSelectedCommands(commands).some((command) => /(?:npm|eslint|prettier)/i.test(command))).toBe(false);
  });

  test("package with only test script returns targeted test command", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {
        scripts: {
          test: "bun test tests/parser.test.ts",
        },
      });

      const commands = await detectProjectCommands({ cwd, projectFiles: testProjectFiles(cwd) });

      expect(firstCommand(commands, "test")).toBe("bun test tests/parser.test.ts");
      expect(commands.lint).toEqual([]);
      expect(commands.skipped.some((skipped) => skipped.kind === "lint" && skipped.reason.includes("No lint"))).toBe(true);
    });
  });

  test("missing scripts returns safe empty command list with skipped reasons", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {});

      const commands = await detectProjectCommands({ cwd, projectFiles: testProjectFiles(cwd) });

      expect(commands.test).toEqual([]);
      expect(commands.lint).toEqual([]);
      expect(commands.typecheck).toEqual([]);
      expect(commands.build).toEqual([]);
      expect(commands.run).toEqual([]);
      expect(commands.deadCode).toEqual([]);
      expect(commands.skipped.map((skipped) => skipped.kind).sort()).toEqual([
        "build",
        "deadCode",
        "lint",
        "run",
        "test",
        "typecheck",
      ]);
    });
  });

  test("ESLint and Prettier are not selected for SOBA-style projects", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {
        scripts: {
          lint: "eslint . && prettier --check .",
        },
      });
      await writeFile(join(cwd, "biome.json"), "{}");

      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: ["SOBA Agent uses Biome. ESLint and Prettier are forbidden."],
      });

      expect(firstCommand(commands, "lint")).toBe("bunx biome check .");
      expect(allSelectedCommands(commands).some((command) => /(?:eslint|prettier)/i.test(command))).toBe(false);
      expect(commands.skipped.some((skipped) => skipped.source === "package-json" && skipped.kind === "lint")).toBe(true);
    });
  });

  test("project instructions override package scripts", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {
        scripts: {
          test: "bun test tests/package.test.ts",
          lint: "biome check .",
        },
      });

      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: ["Use `bun test tests/instructions.test.ts` and `bun run lint` for this project."],
      });

      expect(firstCommand(commands, "test")).toBe("bun test tests/instructions.test.ts");
      expect(firstCommand(commands, "lint")).toBe("bun run lint");
      expect(commands.test[0]?.source).toBe("project-instructions");
      expect(commands.lint[0]?.source).toBe("project-instructions");
    });
  });

  test("project instructions can select non-TypeScript verification commands", async () => {
    await withFixture(async (cwd) => {
      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: ["Use `zig build test` for tests and `make verify` for the project gate."],
      });

      expect(firstCommand(commands, "test")).toBe("zig build test");
      expect(firstCommand(commands, "run")).toBe("make verify");
    });
  });

  test("project instructions detect labeled uncommon toolchain commands without language allowlists", async () => {
    await withFixture(async (cwd) => {
      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: [
          [
            "Verification: cobc -x legacy/PAYROLL.COB && ./payroll_test",
            "Build: msbuild LegacyApp.dproj /t:Build",
          ].join("\n"),
        ],
      });

      expect(firstCommand(commands, "run")).toBe("cobc -x legacy/PAYROLL.COB && ./payroll_test");
      expect(firstCommand(commands, "build")).toBe("msbuild LegacyApp.dproj /t:Build");
    });
  });

  test("project instructions do not treat natural-language guidance as a shell command", async () => {
    await withFixture(async (cwd) => {
      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: ["Run the standard project checks before finishing."],
      });

      expect(commands.run).toEqual([]);
      expect(commands.test).toEqual([]);
      expect(commands.build).toEqual([]);
    });
  });

  test("README prose and project trees are not selected as verification commands", async () => {
    await withFixture(async (cwd) => {
      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: [
          [
            "The API uses `chi` for routing.",
            "Project layout:",
            "```",
            ".",
            "|-- main.go",
            "|-- go.mod",
            "`-- internal/",
            "    |-- openapi_test.go # spec validity tests",
            "    `-- handlers_test.go # end-to-end tests via httptest",
            "```",
          ].join("\n"),
        ],
      });

      expect(allSelectedCommands(commands)).not.toContain("chi");
      expect(allSelectedCommands(commands).some((command) => command.includes("handlers_test.go"))).toBe(false);
      expect(commands.test).toEqual([]);
      expect(commands.run).toEqual([]);
    });
  });

  test("does not reject npm or eslint commands from normal project instructions", async () => {
    await withFixture(async (cwd) => {
      const commands = await detectProjectCommands({
        cwd,
        projectFiles: testProjectFiles(cwd),
        projectInstructions: ["Run `npm test` and `eslint .` before finishing."],
      });

      expect(firstCommand(commands, "test")).toBe("npm test");
      expect(firstCommand(commands, "lint")).toBe("eslint .");
      expect(commands.skipped.some((skipped) => skipped.command === "npm test" || skipped.command === "eslint .")).toBe(
        false,
      );
    });
  });

  test("package script runner follows project package manager metadata and lockfiles", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {
        packageManager: "pnpm@9.0.0",
        scripts: {
          test: "vitest",
          verify: "custom-ci",
        },
      });

      const commands = await detectProjectCommands({ cwd, projectFiles: testProjectFiles(cwd) });

      expect(firstCommand(commands, "test")).toBe("pnpm run test");
      expect(firstCommand(commands, "run")).toBe("pnpm run verify");
    });
  });
});

async function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "soba-command-detector-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writePackageJson(cwd: string, packageJson: Record<string, unknown>): Promise<void> {
  await mkdir(cwd, { recursive: true });
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

function firstCommand(commands: ProjectCommandSet, kind: Exclude<keyof ProjectCommandSet, "skipped">): string | undefined {
  return commands[kind][0]?.command;
}

function allSelectedCommands(commands: ProjectCommandSet): string[] {
  return [
    ...commands.test,
    ...commands.lint,
    ...commands.typecheck,
    ...commands.build,
    ...commands.run,
    ...commands.deadCode,
  ].map((command) => command.command);
}
