import { describe, expect, test } from "bun:test";
import { parseArgs, printHelp } from "../../../src/apps/cli/args";
import { I18n } from "../../../src/shared/i18n/i18n";

describe("CLI adaptive loop options", () => {
  test("парсит adaptive loop policy, включая unlimited=0", () => {
    const args = parseArgs([
      "--max-agent-iterations",
      "0",
      "--max-stalled-iterations",
      "6",
      "--max-run-minutes",
      "90",
      "--bash-max-timeout-seconds",
      "45",
    ]);

    expect(args.maxAgentIterations).toBe(0);
    expect(args.maxStalledIterations).toBe(6);
    expect(args.maxRunMinutes).toBe(90);
    expect(args.bashMaxTimeoutSeconds).toBe(45);
  });

  test("включает сохранение loop debug через --debug", () => {
    expect(parseArgs(["--debug"]).debug).toBe(true);
    expect(parseArgs([]).debug).toBe(false);
  });

  test("распознаёт top-level init и отдаёт его флаги отдельному parser", () => {
    const args = parseArgs(["init", "--check", "--skip-mcp"]);

    expect(args.init).toBe(true);
    expect(args.initArgs).toEqual(["--check", "--skip-mcp"]);
    expect(args.prompt).toBeUndefined();
  });

  test("принимает только известные темы и отклоняет неизвестные", () => {
    expect(parseArgs(["--theme", "aurora"]).theme).toBe("aurora");
    // Unknown theme should error out
    const origExit = process.exit;
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args: string[]) => errors.push(args.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    try {
      parseArgs(["--theme", "laser"]);
      expect.unreachable("Expected parseArgs to throw for unknown theme");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(1)");
    }
    expect(errors.join(" ")).toContain('Unknown theme "laser"');
    console.error = origError;
    process.exit = origExit;
  });
});

describe("printHelp with i18n", () => {
  test("выводит help на английском без i18n", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: string[]) => logs.push(args.join(" "));
    try {
      printHelp();
      const output = logs.join("\n");
      expect(output).toContain("terminal AI coding assistant");
      expect(output).toContain("Usage: soba");
      expect(output).toContain("soba init");
      expect(output).toContain("Modes:");
      expect(output).toContain("Options:");
      expect(output).toContain("Interactive commands");
      expect(output).toContain("Environment variables");
      expect(output).toContain("--no-auto-compact");
      expect(output).toContain("--bash-max-timeout-seconds");
      expect(output).toContain("/capsule");
      expect(output).toContain("/skill:<name>");
      expect(output).toContain("SOBA_AUTO_COMPACT");
      expect(output).toContain("SOBA_BASH_MAX_TIMEOUT_SECONDS");
    } finally {
      console.log = origLog;
    }
  });

  test("выводит help на русском через i18n", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: string[]) => logs.push(args.join(" "));
    try {
      const i18n = new I18n("ru");
      printHelp(i18n);
      const output = logs.join("\n");
      expect(output).toContain("консольный AI-ассистент");
      expect(output).toContain("Использование: soba");
      expect(output).toContain("soba init");
      expect(output).toContain("Режимы:");
      expect(output).toContain("Опции:");
      expect(output).toContain("Интерактивные команды");
      expect(output).toContain("Переменные окружения");
      expect(output).toContain("--bash-max-timeout-seconds");
      expect(output).toContain("SOBA_BASH_MAX_TIMEOUT_SECONDS");
    } finally {
      console.log = origLog;
    }
  });

  test("выводит help на китайском через i18n", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: string[]) => logs.push(args.join(" "));
    try {
      const i18n = new I18n("zh");
      printHelp(i18n);
      const output = logs.join("\n");
      expect(output).toContain("终端 AI 编码助手");
      expect(output).toContain("用法: soba");
      expect(output).toContain("soba init");
      expect(output).toContain("模式:");
      expect(output).toContain("选项:");
      expect(output).toContain("交互命令");
      expect(output).toContain("环境变量");
      expect(output).toContain("--bash-max-timeout-seconds");
      expect(output).toContain("SOBA_BASH_MAX_TIMEOUT_SECONDS");
    } finally {
      console.log = origLog;
    }
  });
});
