/**
 * Bash tool tests.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../../src/infrastructure/tools/local/bash";

describe("bash tool", () => {
  let tmpDir: string;

  function makeCwd(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "soba-test-bash-"));
    return tmpDir;
  }

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  test("выполняет простую команду", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo hello" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("hello");
  });

  test("возвращает stdout и stderr", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo stdout; echo stderr >&2" }, { cwd });

    expect(result.content[0].text).toContain("stdout");
    expect(result.content[0].text).toContain("stderr");
  });

  test("команда с ошибкой возвращает exit code", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "exit 1" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exit code: 1");
  });

  test("команда, завершённая сигналом, не печатает Exit code: null", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "kill -TERM $$" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.details?.exitCode).toBeNull();
    expect(result.details?.signalCode).toBe("SIGTERM");
    expect(result.error).toMatchObject({
      code: "command_terminated_by_signal",
      category: "command",
      retryable: false,
    });
    expect(result.content[0].text).toContain("Command terminated by signal: SIGTERM");
    expect(result.content[0].text).not.toContain("Exit code: null");
    expect(result.error?.nextAction).toContain("pkill -f");
  });

  test("неизвестная команда подсказывает использовать доступную альтернативу", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "soba-command-that-does-not-exist" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exit code: 127");
    expect(result.content[0].text).toContain("command_not_found");
    expect(result.content[0].text).toContain("Check whether the command exists");
    expect(result.content[0].text).toContain("available project tool");
  });

  test("возвращает validation error, если command отсутствует", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({} as never, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "bash_invalid_arguments",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("command must be provided");
    expect(result.content[0].text).toContain("do not retry unchanged");
  });

  test("возвращает validation error, если command не строка", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: undefined } as never, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "bash_invalid_arguments",
      category: "validation",
    });
    expect(result.content[0].text).not.toContain("/bin/sh");
  });

  test("возвращает validation error, если command пустой", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "   " }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("bash_invalid_arguments");
  });

  test("отклоняет routine file inspection через bash", async () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "file1.txt"), "content1");
    writeFileSync(join(cwd, "file2.txt"), "content2");

    const result = await bashTool.execute({ command: "pwd && ls -la" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "bash_routine_filesystem_inspection",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("Use ls for directory structure");
  });

  test("команда без вывода возвращает (no output)", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "true" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("(no output)");
  });

  test("поддерживает конвейеры (pipes)", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo 'a\nb\nc' | wc -l" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text.trim()).toBe("3");
  });

  test("поддерживает переменные окружения", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo $HOME" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text.trim().length).toBeGreaterThan(0);
  });

  test("exec работает в указанной cwd", async () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "project-file.txt"), "project content");

    const result = await bashTool.execute({
      command: "node -e \"console.log(require('fs').readFileSync('project-file.txt', 'utf8'))\"",
    }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("project content");
  });

  test("отклоняет verification commands, пропущенные через head/tail", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "bun test 2>&1 | tail -10" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "bash_verification_output_filter",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("verification commands must not be piped through head or tail");
  });

  test("truncateOutput ограничивает длинный вывод", async () => {
    const cwd = makeCwd();
    // Generate 3000 lines of output (exceeds 2000 line limit)
    const cmd = `for i in $(seq 1 3000); do echo "line $i"; done`;
    const result = await bashTool.execute({ command: cmd, timeout: 15 }, { cwd });

    expect(result.details?.truncated).toBe(true);
    expect(result.content[0].text).toContain("Output truncated");
    expect(result.content[0].text).toContain("saved to");
  });

  test("streaming truncation writes redacted full output to temp file", async () => {
    const cwd = makeCwd();
    const cmd = `for i in $(seq 1 3000); do echo "line $i api_key=secret-$i"; done`;
    const result = await bashTool.execute({ command: cmd, timeout: 15 }, { cwd });

    expect(result.details?.truncated).toBe(true);
    expect(typeof result.details?.tempPath).toBe("string");
    const tempPath = result.details?.tempPath as string;
    expect(existsSync(tempPath)).toBe(true);
    const fullOutput = readFileSync(tempPath, "utf-8");
    expect(fullOutput).toContain("line 1");
    expect(fullOutput).toContain("api_key=[REDACTED]");
    expect(fullOutput).not.toContain("api_key=secret-");
    expect(result.content[0].text.length).toBeLessThan(70 * 1024);
  });

  test("ограничивает слишком большой timeout, чтобы bash не висел часами", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo ok", timeout: 3600 }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.details?.timeoutSeconds).toBe(300);
    expect(result.details?.maxTimeoutSeconds).toBe(300);
    expect(result.content[0].text).toContain("Requested timeout 3600s adjusted to 300s");
    expect(result.content[0].text).toContain("ok");
  });

  test("использует runtime max timeout из ToolContext", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo ok", timeout: 3600 }, { cwd, bashMaxTimeoutSeconds: 45 });

    expect(result.isError).toBe(false);
    expect(result.details?.timeoutSeconds).toBe(45);
    expect(result.details?.maxTimeoutSeconds).toBe(45);
    expect(result.content[0].text).toContain("Requested timeout 3600s adjusted to 45s");
  });

  test("останавливает долгоживущий процесс по сигналу пользователя", async () => {
    const cwd = makeCwd();
    const controller = new AbortController();
    const execution = bashTool.execute(
      { command: "while true; do sleep 1; done", timeout: 30 },
      { cwd },
      controller.signal,
    );

    setTimeout(() => controller.abort(), 50);
    const result = await execution;

    expect(result.isError).toBe(true);
    expect(result.details?.aborted).toBe(true);
    expect(result.details?.timedOut).toBe(false);
    expect(result.content[0].text).toContain("Command stopped by user");
  });
});
