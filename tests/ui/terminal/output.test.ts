/**
 * TUI tests — colors, theme, status-bar, agent-status-line.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { I18n } from "../../../src/shared/i18n/i18n";
import { formatToolArgs, formatToolSummary } from "../../../src/ui/terminal/interactive-tui";
import {
  AGENT_STATUS_HINTS,
  AGENT_STATUS_SLOT_WIDTH,
  renderAgentStatus,
  renderThinkingStatus,
  SYNTHWAVE_NOODLE_FRAMES,
} from "../../../src/ui/terminal/output/agent-status-line";
import {
  bold,
  dim,
  hexToRgb,
  isColorDisabled,
  padToWidth,
  setColorDisabled,
  supportsTruecolor,
  truncateToWidth,
  visibleWidth,
} from "../../../src/ui/terminal/output/colors";
import { createRenderer } from "../../../src/ui/terminal/output/renderer";
import { Spinner } from "../../../src/ui/terminal/output/spinner";
import { renderStatusBar } from "../../../src/ui/terminal/output/status-bar";
import { DARK_THEME_TOKENS, getTheme, initTheme, LIGHT_THEME_TOKENS, setTheme, tFg } from "../../../src/ui/terminal/output/theme";

// ─── Colors ───

describe("colors", () => {
  beforeEach(() => {
    setColorDisabled(false);
  });

  test("hexToRgb парсит #RGB", () => {
    const rgb = hexToRgb("#f00");
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
  });

  test("hexToRgb парсит #RRGGBB", () => {
    const rgb = hexToRgb("#7aa2f7");
    expect(rgb.r).toBe(122);
    expect(rgb.g).toBe(162);
    expect(rgb.b).toBe(247);
  });

  test("bold оборачивает текст в ANSI escape", () => {
    const result = bold("hello");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[0m");
  });

  test("dim оборачивает текст в ANSI escape", () => {
    const result = dim("muted");
    expect(result).toContain("\x1b[2m");
    expect(result).toContain("muted");
  });

  test("visibleWidth считает видимые символы", () => {
    expect(visibleWidth("hello")).toBe(5);
    expect(visibleWidth("")).toBe(0);
    expect(visibleWidth("привет")).toBe(6);
  });

  test("visibleWidth игнорирует ANSI коды", () => {
    const colored = bold("hi");
    expect(visibleWidth(colored)).toBe(2);
  });

  test("truncateToWidth обрезает текст", () => {
    expect(truncateToWidth("hello world", 5)).toBe("hell…");
    expect(truncateToWidth("hi", 10)).toBe("hi");
  });

  test("padToWidth добавляет пробелы", () => {
    const result = padToWidth("hi", 5);
    expect(result.length).toBe(5);
    expect(result.startsWith("hi")).toBe(true);
  });

  test("isColorDisabled реагирует на setColorDisabled", () => {
    const before = isColorDisabled();
    setColorDisabled(true);
    expect(isColorDisabled()).toBe(true);
    setColorDisabled(false);
    expect(isColorDisabled()).toBe(false);
    // Restore
    if (before) setColorDisabled(true);
  });

  test("supportsTruecolor возвращает boolean", () => {
    expect(typeof supportsTruecolor()).toBe("boolean");
  });
});

// ─── Theme ───

describe("theme", () => {
  test("initTheme dark устанавливает тёмные токены", () => {
    initTheme("dark");
    expect(getTheme()).toBe(DARK_THEME_TOKENS);
  });

  test("initTheme light устанавливает светлые токены", () => {
    initTheme("light");
    expect(getTheme()).toBe(LIGHT_THEME_TOKENS);
    // Restore
    initTheme("dark");
  });

  test("setTheme переключает тему", () => {
    initTheme("dark");
    setTheme("light");
    expect(getTheme()).toBe(LIGHT_THEME_TOKENS);
    setTheme("dark");
    expect(getTheme()).toBe(DARK_THEME_TOKENS);
  });

  test("tFg применяет цвет из темы", () => {
    const before = isColorDisabled();
    setColorDisabled(false);
    initTheme("dark");
    const colored = tFg("accent", "test");
    expect(colored).toContain("test");
    expect(colored).toContain("\x1b[");
    setColorDisabled(before);
  });

  test("tFg без цвета возвращает plain текст", () => {
    setColorDisabled(true);
    const result = tFg("accent", "plain");
    expect(result).toBe("plain");
    setColorDisabled(false);
  });
});

// ─── Status Bar ───

describe("statusBar", () => {
  test("renderStatusBar содержит модель и cwd", () => {
    const bar = renderStatusBar({
      model: "gpt-4o",
      cwd: "/project",
      usedTokens: 5000,
      totalBudget: 128000,
    });

    expect(bar).toContain("soba");
    expect(bar).toContain("gpt-4o");
    expect(bar).toContain("5.0K");
  });

  test("renderStatusBar с budget показывает проценты", () => {
    const bar = renderStatusBar({
      model: "gpt-4o",
      cwd: "/test",
      usedTokens: 90000,
      totalBudget: 128000,
    });

    expect(bar).toContain("soba");
  });
});

describe("agent status line", () => {
  const stripBlessedTags = (text: string): string => text.replace(/\{\/?[a-z-]+\}/g, "");

  test("горячие клавиши начинаются на одной колонке во всех кадрах анимации", () => {
    const hintPositions = SYNTHWAVE_NOODLE_FRAMES.map((_, frameIndex) =>
      stripBlessedTags(renderThinkingStatus(frameIndex)).indexOf(AGENT_STATUS_HINTS),
    );

    expect(new Set(hintPositions)).toEqual(new Set([AGENT_STATUS_SLOT_WIDTH]));
  });

  test("статусы и анимация используют одинаковую фиксированную ширину", () => {
    const lines = [
      renderAgentStatus("agent is idle", true),
      renderAgentStatus("waiting for confirmation", false),
      ...SYNTHWAVE_NOODLE_FRAMES.map((_, frameIndex) => renderThinkingStatus(frameIndex)),
    ].map(stripBlessedTags);

    for (const line of lines) {
      expect(line.indexOf(AGENT_STATUS_HINTS)).toBe(AGENT_STATUS_SLOT_WIDTH);
      expect([...line].length).toBe(AGENT_STATUS_SLOT_WIDTH + [...AGENT_STATUS_HINTS].length);
    }
  });
});

// ─── Spinner ───

describe("spinner", () => {
  test("Spinner создаётся в остановленном состоянии", () => {
    const spinner = new Spinner();
    expect(spinner.isRunning).toBe(false);
  });
});

describe("Tool details", () => {
  test("показывает путь и диапазон read", () => {
    const lines = formatToolArgs("read", { path: "src/app.ts", offset: 20, limit: 40 });

    expect(lines.join("\n")).toContain("src/app.ts");
    expect(lines.join("\n")).toContain("offset=20");
    expect(lines.join("\n")).toContain("limit=40");
  });

  test("показывает команду bash", () => {
    expect(formatToolArgs("bash", { command: "bun test" }).join("\n")).toContain("bun test");
  });
});

describe("Tool summary", () => {
  test("read показывает путь", () => {
    expect(formatToolSummary("read", { path: "package.json" })).toBe("Read package.json");
  });

  test("read с offset и limit показывает диапазон", () => {
    expect(formatToolSummary("read", { path: "src/app.ts", offset: 20, limit: 40 })).toBe("Read src/app.ts:20+40");
  });

  test("read только с offset", () => {
    expect(formatToolSummary("read", { path: "src/app.ts", offset: 10 })).toBe("Read src/app.ts:10");
  });

  test("write показывает путь", () => {
    expect(formatToolSummary("write", { path: "src/cli.ts", content: "hello" })).toBe("Write src/cli.ts");
  });

  test("edit показывает путь и количество правок", () => {
    expect(formatToolSummary("edit", { path: "src/cli.ts", edits: [{}, {}] })).toBe("Edit src/cli.ts (2 changes)");
    expect(formatToolSummary("edit", { path: "src/cli.ts", edits: [{}] })).toBe("Edit src/cli.ts (1 change)");
    expect(formatToolSummary("edit", { path: "src/cli.ts" })).toBe("Edit src/cli.ts (1 change)");
  });

  test("bash показывает команду", () => {
    expect(formatToolSummary("bash", { command: "bun test" })).toBe("Bash bun test");
  });

  test("bash обрезает длинную команду", () => {
    const longCommand = `find . -name "*.ts" ${"x".repeat(100)}`;
    const summary = formatToolSummary("bash", { command: longCommand });
    expect(summary.startsWith("Bash ")).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(86); // "Bash " (5) + 80 + "…" (1)
  });

  test("ls показывает путь", () => {
    expect(formatToolSummary("ls", { path: "src/" })).toBe("Ls src/");
  });

  test("ls без пути", () => {
    expect(formatToolSummary("ls", {})).toBe("Ls");
  });

  test("checkpoint показывает kind и reason", () => {
    expect(formatToolSummary("checkpoint", { kind: "milestone", reason: "done" })).toBe(
      "Checkpoint milestone · done",
    );
  });

  test("checkpoint показывает completed/pending", () => {
    expect(
      formatToolSummary("checkpoint", {
        kind: "milestone",
        reason: "phase 1",
        completed: ["task-1", "task-2"],
        pending: ["task-3"],
      }),
    ).toBe("Checkpoint milestone · phase 1 · [2✓ 1⏳]");
  });

  test("checkpoint обрезает длинный reason", () => {
    const longReason = "a".repeat(100);
    const summary = formatToolSummary("checkpoint", { kind: "plan_pivot", reason: longReason });
    expect(summary.startsWith("Checkpoint plan_pivot · ")).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("activate_skill показывает имя", () => {
    expect(formatToolSummary("activate_skill", { name: "commit-message" })).toBe("Activate skill: commit-message");
  });

  test("deactivate_skill показывает имя", () => {
    expect(formatToolSummary("deactivate_skill", { name: "commit-message" })).toBe("Deactivate skill: commit-message");
  });

  test("неизвестный инструмент капитализируется", () => {
    expect(formatToolSummary("custom_tool", {})).toBe("Custom_tool");
  });
});

describe("Print renderer i18n", () => {
  test("рендерит начало one-shot сессии с переданной локализацией", () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const renderer = createRenderer({
        mode: "print",
        model: "test-model",
        cwd: process.cwd(),
        tokenBudget: 0,
        i18n: new I18n("en"),
      });
      renderer.renderSessionStart("12345678-session");
    } finally {
      console.log = originalLog;
    }

    expect(output.join("\n")).toContain("12345678");
    expect(output.join("\n")).toContain("test-model");
  });

  test("локализует собственные подписи, сохраняя внешний текст ошибки", () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const renderer = createRenderer({
        mode: "print",
        model: "test-model",
        cwd: process.cwd(),
        tokenBudget: 0,
        i18n: new I18n("zh"),
      });
      renderer.emit({ type: "error", timestamp: Date.now(), message: "HTTP 401" });
      renderer.emit({ type: "compaction_done", timestamp: Date.now(), tokensBefore: 100, tokensAfter: 25 });
    } finally {
      console.log = originalLog;
    }

    expect(output.join("\n")).toContain("错误: HTTP 401");
    expect(output.join("\n")).toContain("已压缩");
  });
});
