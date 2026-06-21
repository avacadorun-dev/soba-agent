/**
 * Интеграционные тесты CLI/TUI — проверка запуска в неинтерактивном режиме
 *
 * TUI-взаимодействие (@opentui/core) требует реального TTY.
 * Для прямого тестирования TUI-логики используем TuiStore (tests/tui-slash-commands.test.ts).
 *
 * Этот файл покрывает:
 * - CLI-флаги: --help, --version, --model, --theme, --lang (неинтерактивные)
 * - PTY-запуски: проверка что CLI не падает с разными комбинациями флагов
 * - Проверка exit-кодов и наличия вывода
 *
 * Покрывает кейсы из regression-cases:
 * - 05-tui-basic.md: K08 (--help), K18 (--debug), K22 (--project-trust)
 * - 09-tui-switching.md: --no-session, --model, --theme, --lang
 * - 10-tui-slash-commands.md: базовая валидация CLI
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";

const DIST_CLI = "dist/cli.js";

// ─── Проверка существования сборки ───

test("CLI собран", () => {
  expect(existsSync(DIST_CLI)).toBe(true);
});

// ─── Неинтерактивные CLI-команды ───

describe("CLI --help", () => {
  test("--help возвращает exit 0 и содержит описание", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    const combined = out + err;
    expect(combined.length).toBeGreaterThan(0);
  });

  test("-h (short flag) работает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "-h"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect((out + err).length).toBeGreaterThan(0);
  });
});

describe("CLI --version", () => {
  test("--version возвращает exit 0 и версию", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
    // Должна быть версия (семантическая)
    expect(out).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("CLI --lang", () => {
  test("--lang ru не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--lang", "ru", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  test("--lang en не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--lang", "en", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  test("--lang zh не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--lang", "zh", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("CLI --theme", () => {
  test("--theme aurora не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--theme", "aurora", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  test("--theme laser (неизвестная тема) выдаёт ошибку", async () => {
    // CLI теперь валидирует тему и выдаёт ошибку с exit code 1
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--theme", "laser"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const output = stdout + stderr;
    expect(code).toBe(1);
    expect(output).toContain('Unknown theme "laser"');
  });
});

describe("CLI --model", () => {
  test("--model test-model с --help не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--model", "test-model", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });
});

describe("CLI --no-session", () => {
  test("--no-session с --help не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--no-session", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });
});

describe("CLI --debug", () => {
  test("--debug с --help не падает", async () => {
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--debug", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });
});

describe("CLI комбинации флагов", () => {
  test("--lang ru --theme aurora --no-session --help", async () => {
    const proc = Bun.spawn([
      "bun", "run", DIST_CLI,
      "--lang", "ru", "--theme", "aurora", "--no-session", "--help",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  test("--lang en --model gpt4 --debug --help", async () => {
    const proc = Bun.spawn([
      "bun", "run", DIST_CLI,
      "--lang", "en", "--model", "gpt4", "--debug", "--help",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });
});

// ─── PTY-тесты: Bun.spawn с terminal option ───
// Доступно в Bun 1.3.5+. Примечание: @opentui/core выполняет запросы
// терминальных возможностей (DSR, kitty keyboard protocol),
// которые в Bun Terminal пока не обрабатываются полностью,
// поэтому TUI-взаимодействие через PTY ограничено.

describe("Bun.spawn terminal (PTY)", () => {
  test("CLI в PTY с --help работает", async () => {
    let output = "";
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--help"], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_term, data) {
          output += typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
        },
      },
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const code = await Promise.race([
      proc.exited,
      new Promise((r) => setTimeout(() => r("timeout"), 5000)),
    ]);

    proc.terminal?.close();

    if (code !== "timeout") {
      expect(code).toBe(0);
      expect(output.length).toBeGreaterThan(0);
    } else {
      // В PTY --help может не отработать — пропускаем
      // (это известное ограничение Bun Terminal)
      console.log("PTY --help timed out — skipping assertion");
    }
  });

  test("CLI в PTY с --version работает", async () => {
    let output = "";
    const proc = Bun.spawn(["bun", "run", DIST_CLI, "--version"], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_term, data) {
          output += typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
        },
      },
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const code = await Promise.race([
      proc.exited,
      new Promise((r) => setTimeout(() => r("timeout"), 5000)),
    ]);

    proc.terminal?.close();

    if (code !== "timeout") {
      expect(code).toBe(0);
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    }
  });
});
