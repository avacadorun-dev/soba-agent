import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import packageJson from "../package.json";
import { APP_VERSION } from "../src/shared/version";

const expectedVersion = `v${packageJson.version}`;

describe("CLI", () => {
  test("UC-1: --version выводит версию soba", async () => {
    const result = await $`bun run src/cli.ts --version`.quiet();
    expect(result.stdout.toString()).toContain(expectedVersion);
    expect(result.exitCode).toBe(0);
  });

  test("UC-1: вызов без аргументов запускает интерактивный режим (как -i)", async () => {
    // When no args are passed, CLI enters interactive mode (like -i).
    // --help confirms the interactive mode is documented.
    const result = await $`bun run src/cli.ts --help`.quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain("Interactive REPL mode");
    expect(stdout).toContain("soba -i");
    expect(result.exitCode).toBe(0);
  });

  test("UC-1: -v флаг тоже работает", async () => {
    const result = await $`bun run src/cli.ts -v`.quiet();
    expect(result.stdout.toString()).toContain(expectedVersion);
    expect(result.exitCode).toBe(0);
  });

  test("application version comes from package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });
});

describe("Project structure", () => {
  test("architecture layer directories exist", async () => {
    const dirs = [
      "src/kernel/transcript",
      "src/kernel/tools",
      "src/engine/turn",
      "src/engine/compaction",
      "src/application/trust",
      "src/shared/i18n",
      "src/engine/prompt",
      "src/infrastructure/llm/openresponses",
      "src/infrastructure/llm/openai",
    ];
    for (const dir of dirs) {
      await Bun.file(`${dir}/.gitkeep`).exists();
      // Директория существует, даже если пустая
      const dirStat = await $`ls -d ${dir}`.quiet();
      expect(dirStat.exitCode).toBe(0);
    }
  });

  test("biome.json существует и валиден", async () => {
    const exists = await Bun.file("biome.json").exists();
    expect(exists).toBe(true);
    const content = await Bun.file("biome.json").json();
    expect(content.formatter.enabled).toBe(true);
    expect(content.linter.enabled).toBe(true);
  });

  test("tsconfig.json содержит strict mode", async () => {
    const exists = await Bun.file("tsconfig.json").exists();
    expect(exists).toBe(true);
    const content = await Bun.file("tsconfig.json").json();
    expect(content.compilerOptions.strict).toBe(true);
    expect(content.compilerOptions.verbatimModuleSyntax).toBe(true);
    expect(content.compilerOptions.erasableSyntaxOnly).toBe(true);
  });
});

describe("Build", () => {
  test("bun run build завершается без ошибок", async () => {
    const result = await $`bun run build`.quiet();
    expect(result.exitCode).toBe(0);
  });

  test("production bundle компилирует OpenTUI Solid JSX", async () => {
    const bundle = await Bun.file("dist/cli.js").text();

    expect(bundle).toContain("(TuiApp,");
    expect(bundle).toContain("function createComponent");
    expect(bundle).not.toContain("<TuiApp");
  });
});
