/**
 * Bash tool tests.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(result.details?.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("возвращает stdout и stderr", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "echo stdout; echo stderr >&2" }, { cwd });

    expect(result.content[0].text).toContain("stdout");
    expect(result.content[0].text).toContain("stderr");
  });

  test("стримит построчный вывод до завершения команды", async () => {
    const cwd = makeCwd();
    const chunks: string[] = [];
    let firstChunkSeen = () => {};
    const firstChunk = new Promise<void>((resolve) => {
      firstChunkSeen = resolve;
    });
    let settled = false;
    const execution = bashTool.execute(
      { command: "printf 'first\\n'; sleep 0.2; printf 'second\\n'" },
      {
        cwd,
        onOutput: (chunk) => {
          chunks.push(chunk);
          firstChunkSeen();
        },
      },
    );
    void execution.then(() => {
      settled = true;
    });

    const firstEvent = await Promise.race([
      firstChunk.then(() => "chunk" as const),
      execution.then(() => "completed" as const),
    ]);

    expect(firstEvent).toBe("chunk");
    expect(settled).toBe(false);
    expect(chunks.join("")).toContain("first\n");

    await execution;
    expect(chunks.join("")).toContain("second\n");
  });

  test("редактирует секреты до отправки live output", async () => {
    const cwd = makeCwd();
    const chunks: string[] = [];

    await bashTool.execute(
      { command: "printf 'api_key=secret-value\\n'" },
      { cwd, onOutput: (chunk) => chunks.push(chunk) },
    );

    expect(chunks.join("")).toContain("api_key=[REDACTED]");
    expect(chunks.join("")).not.toContain("secret-value");
  });

  test("не стримит содержимое private key до безопасной редакции блока", async () => {
    const cwd = makeCwd();
    const chunks: string[] = [];

    await bashTool.execute(
      {
        command:
          "printf '%s\\n' '-----BEGIN PRIVATE KEY-----' 'private-material' '-----END PRIVATE KEY-----'",
      },
      { cwd, onOutput: (chunk) => chunks.push(chunk) },
    );

    expect(chunks.join("")).toContain("[REDACTED PRIVATE KEY]");
    expect(chunks.join("")).not.toContain("private-material");
  });

  test("команда с ошибкой возвращает exit code", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "exit 1" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exit code: 1");
  });

  test("masked wrapper с reported exit code не превращается в успешную команду", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute(
      { command: 'false; printf "typecheck failed\\n---typecheck exit: 2\\n"' },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.details?.exitCode).toBe(2);
    expect(result.details?.shellExitCode).toBe(0);
    expect(result.details?.reportedExitCode).toBe(2);
    expect(result.content[0].text).toContain("Exit code: 2");
  });

  test("formatter shell command reports changed files", async () => {
    const cwd = makeCwd();
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "app.ts"), "const value = 1;\n");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          format: "bun -e \"await Bun.write('src/app.ts', 'const value = 2;\\\\n')\"",
        },
      }),
    );

    const result = await bashTool.execute({ command: "bun run format" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.details?.changedFiles).toEqual(["src/app.ts"]);
    expect(result.details?.changedFileCount).toBe(1);
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

  test("выполняет routine file inspection через bash", async () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "file1.txt"), "content1");
    writeFileSync(join(cwd, "file2.txt"), "content2");

    const result = await bashTool.execute({ command: "pwd && ls -la" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(cwd);
    expect(result.content[0].text).toContain("file1.txt");
  });

  test("выполняет head/tail в пайпе", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "printf 'a\\nb\\n' | head -1" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text.trim()).toBe("a");
  });

  test("выполняет package-manager diagnostics с head/tail", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute(
      { command: "command -v uv >/dev/null || exit 0; uv add --help 2>&1 | tail -5" },
      { cwd },
    );

    expect(result.isError).toBe(false);
  });

  test("выполняет database diagnostics с head/tail", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute(
      { command: "command -v psql >/dev/null || exit 0; psql --version 2>&1 | head -1" },
      { cwd },
    );

    expect(result.isError).toBe(false);
  });

  test("не блокирует неизвестные toolchain-команды до shell execution", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "definitely-missing-zig-build-tool" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("command_not_found");
    expect(result.content[0].text).toContain("Exit code: 127");
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

  test("выполняет verification commands, пропущенные через head/tail", async () => {
    const cwd = makeCwd();
    const result = await bashTool.execute({ command: "bun --version 2>&1 | tail -1" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text.trim()).toMatch(/\d+\.\d+\.\d+/);
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
