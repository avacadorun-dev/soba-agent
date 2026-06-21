import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectCommands } from "../../../src/core/verification/project-command-detector";
import type { ProjectCommandSet } from "../../../src/core/verification/types";

describe("project command detector", () => {
  test("SOBA fixture returns Bun/Biome-first verification commands", async () => {
    const cwd = process.cwd();

    const commands = await detectProjectCommands({
      cwd,
      projectInstructions: ["SOBA Agent uses Bun, Biome, TypeScript, and bun test."],
      includeFullGate: true,
    });

    expect(firstCommand(commands, "test")).toBe("bun test");
    expect(firstCommand(commands, "lint")).toBe("bun run lint");
    expect(firstCommand(commands, "typecheck")).toBe("bunx tsc --noEmit");
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

      const commands = await detectProjectCommands({ cwd });

      expect(firstCommand(commands, "test")).toBe("bun test tests/parser.test.ts");
      expect(commands.lint).toEqual([]);
      expect(commands.skipped.some((skipped) => skipped.kind === "lint" && skipped.reason.includes("No lint"))).toBe(true);
    });
  });

  test("missing scripts returns safe empty command list with skipped reasons", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, {});

      const commands = await detectProjectCommands({ cwd });

      expect(commands.test).toEqual([]);
      expect(commands.lint).toEqual([]);
      expect(commands.typecheck).toEqual([]);
      expect(commands.build).toEqual([]);
      expect(commands.deadCode).toEqual([]);
    expect(commands.skipped.map((skipped) => skipped.kind).sort()).toEqual(["build", "deadCode", "lint", "test", "typecheck"]);
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
        projectInstructions: ["Use `bun test tests/instructions.test.ts` and `bun run lint` for this project."],
      });

      expect(firstCommand(commands, "test")).toBe("bun test tests/instructions.test.ts");
      expect(firstCommand(commands, "lint")).toBe("bun run lint");
      expect(commands.test[0]?.source).toBe("project-instructions");
      expect(commands.lint[0]?.source).toBe("project-instructions");
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

function firstCommand(commands: ProjectCommandSet, kind: Exclude<keyof ProjectCommandSet, "skipped">): string | undefined {
  return commands[kind][0]?.command;
}

function allSelectedCommands(commands: ProjectCommandSet): string[] {
  return [...commands.test, ...commands.lint, ...commands.typecheck, ...commands.build, ...commands.deadCode].map(
    (command) => command.command,
  );
}
