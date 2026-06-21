/**
 * Тесты для автоматизации TUI slash-команд через прямое тестирование TuiStore
 * Цель: сократить SKIP_TUI для кейсов из manual regression cases
 * 
 * Примечание: @opentui/core требует TTY для stdin, поэтому pipe-эмуляция (echo "/exit" | soba -i) не работает.
 * Вместо этого мы тестируем TuiStore напрямую с mock executeCommand.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentLoop } from "../src/core/loop/agent-loop";
import { TuiStore } from "../src/widgets/tui/model/tui-store";
import type { InteractiveTUIOptions, TuiMessage } from "../src/widgets/tui/model/types";

function msgText(m: TuiMessage): string {
  if ("content" in m && typeof m.content === "string") return m.content;
  if ("summary" in m && typeof m.summary === "string") return m.summary;
  return "";
}

function createMockAgentLoop(): AgentLoop {
  return {
    getModel: () => "test-model",
    runTurn: async () => {},
  } as unknown as AgentLoop;
}

describe("TUI slash-commands via TuiStore", () => {
  let store: TuiStore;
  let exitRequested: boolean;

  beforeEach(() => {
    exitRequested = false;

    const options: InteractiveTUIOptions = {
      cwd: process.cwd(),
      tokenBudget: 10_000,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop: createMockAgentLoop(),
      toolNames: ["read", "edit", "bash"],
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
      executeCommand: async (input, onOutput) => {
        // Эмуляция обработки slash-команд
        if (input === "/exit") {
          exitRequested = true;
          return { handled: true, exit: true };
        }
        if (input === "/help") {
          onOutput?.({ type: "info", message: "Доступные команды: /help, /exit, /session, /budget", timestamp: Date.now() });
          return { handled: true, exit: false };
        }
        if (input === "/session") {
          onOutput?.({ type: "info", message: "Session: test-session | Tokens: 0/128000", timestamp: Date.now() });
          return { handled: true, exit: false };
        }
        if (input === "/budget") {
          onOutput?.({ type: "info", message: "Budget used: 0 / 10000 tokens", timestamp: Date.now() });
          return { handled: true, exit: false };
        }
        // По умолчанию передаём агенту
        return { handled: false, exit: false };
      },
    };

    store = new TuiStore(options, () => {
      exitRequested = true;
    });
  });

  afterEach(() => {
    store.dispose();
  });

  test("Кейс: /help показывает доступные команды", async () => {
    await store.submit("/help");
    
    expect(exitRequested).toBe(false);
    // Проверяем, что команда была обработана и вывела информацию
    // В реальном TuiStore это добавляет сообщение в ленту
    expect(store.messages().length).toBeGreaterThan(0);
  });

  test("Кейс: /session в свежей сессии не падает", async () => {
    await store.submit("/session");
    
    expect(exitRequested).toBe(false);
    expect(store.messages().length).toBeGreaterThan(0);
    
    // Проверяем, что в выводе есть упоминание сессии или токенов
    const lastMessage = store.messages()[store.messages().length - 1];
    expect(msgText(lastMessage)).toMatch(/Session|Tokens/i);
  });

  test("Кейс: /budget показывает информацию о бюджете", async () => {
    await store.submit("/budget");
    
    expect(exitRequested).toBe(false);
    expect(store.messages().length).toBeGreaterThan(0);
    
    const lastMessage = store.messages()[store.messages().length - 1];
    expect(msgText(lastMessage)).toMatch(/Budget|tokens/i);
  });

  test("Кейс: /exit завершает работу", async () => {
    await store.submit("/exit");
    
    expect(exitRequested).toBe(true);
  });

  test("Кейс: Обычный промпт передаётся агенту", async () => {
    await store.submit("скажи привет");
    
    expect(exitRequested).toBe(false);
    // Проверяем, что промпт был добавлен в историю
    // CommandHistory хранит записи, проверим через navigate или просто факт отсутствия ошибок
    expect(store.history.older()).toBe("скажи привет");
  });
});
