import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SobaRuntime, UserTurnInput } from "../../../../src/application/types";
import { I18n } from "../../../../src/core/i18n/i18n";
import type { AgentLoop } from "../../../../src/core/loop/agent-loop";
import type { AgentEvent } from "../../../../src/core/loop/types";
import { ProjectTrustStore } from "../../../../src/core/skills/project-trust-store";
import { readChangeStats } from "../../../../src/ui/terminal/interactive/lib/project-info";
import { NotificationStore } from "../../../../src/ui/terminal/interactive/model/notification-store";
import { TuiStore } from "../../../../src/ui/terminal/interactive/model/tui-store";
import type { InteractiveTUIOptions } from "../../../../src/ui/terminal/interactive/model/types";
import {
  getProgressBarSegments,
  getTrustBadgeParts,
  SIDEBAR_COMPACT_LOGO_MAX_WIDTH,
  shouldUseCompactSidebarLogo,
} from "../../../../src/ui/terminal/interactive/ui/sidebar";

function createStore(onExit: () => void = () => {}): TuiStore {
  const agentLoop = {
    getModel: () => "test-model",
    runTurn: async () => {},
    getTrustManager: () => ({
      getPermissionMode: () => "ask" as const,
      setPermissionMode: (_mode: string) => {},
      clearSessionApprovals: () => {},
    }),
    abortActiveTool: () => false,
    abort: () => {},
    runShellCommand: async () => ({ content: [{ type: "text" as const, text: "ok" }], isError: false }),
    onEvent: () => () => {},
  } as unknown as AgentLoop;
  const options: InteractiveTUIOptions = {
    cwd: process.cwd(),
    tokenBudget: 10_000,
    contextWindow: 128_000,
    theme: "graphite",
    agentLoop,
    toolNames: ["read", "edit"],
    executeCommand: async (input) => ({ handled: true, exit: input === "/exit" }),
    debug: false,
    maxOutputTokens: 0,
    maxCompletionTokens: 0,
    maxAgentIterations: 0,
    maxStalledIterations: 4,
    maxRunMinutes: 0,
    autoCompact: true,
  };
  return new TuiStore(options, onExit);
}

function event(value: Record<string, unknown>): AgentEvent {
  return { ...value, timestamp: Date.now() } as unknown as AgentEvent;
}

describe("OpenTUI Solid store", () => {
  test("uses SobaRuntime for TUI user turns when runtime is available", async () => {
    let legacyRunTurnCalled = false;
    let runtimeInput: UserTurnInput | undefined;
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {
        legacyRunTurnCalled = true;
      },
      getSessionManager: () => ({
        isPersisted: () => false,
        getSessionId: () => "session_tui",
      }),
      getTrustManager: () => ({
        getPermissionMode: () => "ask" as const,
        setPermissionMode: (_mode: string) => {},
        clearSessionApprovals: () => {},
      }),
      abortActiveTool: () => false,
      abort: () => {},
      runShellCommand: async () => ({ content: [{ type: "text" as const, text: "ok" }], isError: false }),
      onEvent: () => () => {},
    } as unknown as AgentLoop;
    const runtime = {
      runTurn: async (input: UserTurnInput) => {
        runtimeInput = input;
        return {} as Awaited<ReturnType<SobaRuntime["runTurn"]>>;
      },
    } as unknown as SobaRuntime;
    const store = new TuiStore(
      {
        cwd: process.cwd(),
        tokenBudget: 10_000,
        contextWindow: 128_000,
        theme: "graphite",
        runtime,
        agentLoop,
        toolNames: ["read", "edit"],
        executeCommand: async () => ({ handled: true }),
        debug: false,
        maxOutputTokens: 0,
        maxCompletionTokens: 0,
        maxAgentIterations: 0,
        maxStalledIterations: 4,
        maxRunMinutes: 0,
        autoCompact: true,
      },
      () => {},
    );

    await store.submit("inspect runtime");

    expect(legacyRunTurnCalled).toBe(false);
    expect(runtimeInput).toEqual({
      sessionId: "session_tui",
      source: "tui",
      content: [{ type: "text", text: "inspect runtime" }],
    });
  });

  test("собирает streaming-ответ ассистента в одно markdown-сообщение", () => {
    const store = createStore();
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    store.onAgentEvent(event({ type: "assistant_text_delta", messageId: "m1", delta: "**Hello" }));
    store.onAgentEvent(event({ type: "assistant_text_done", messageId: "m1", fullText: "**Hello**" }));

    expect(store.messages()).toEqual([{ id: 1, type: "assistant", content: "**Hello**", streaming: false }]);
    expect(store.lastAssistantText()).toBe("**Hello**");
  });

  test("выносит evidence handoff в отдельный TUI block", () => {
    const store = createStore();
    store.onAgentEvent(
      event({
        type: "assistant_message",
        messageId: "m1",
        text: [
          "Готово",
          "",
          "**Evidence**",
          "- Status: verified",
          "- Changed files: modified src/app.ts (+1/-0)",
          "- Checks: Tests passed (bun test)",
          "- Risks: none",
        ].join("\n"),
      }),
    );

    expect(store.messages().map((message) => message.type)).toEqual(["assistant", "evidence"]);
    expect(store.messages()[0]).toMatchObject({ type: "assistant", content: "Готово" });
    expect(store.messages()[1]).toMatchObject({
      type: "evidence",
      summary: {
        status: "verified",
        changedFiles: ["modified src/app.ts (+1/-0)"],
        checks: ["Tests passed (bun test)"],
        risks: [],
      },
    });
    expect(store.getTranscriptText()).toContain("Evidence\nStatus: verified");
  });

  test("стримит reasoning в один блок и не дублирует его на финале", () => {
    const store = createStore();
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: "Думаю" }));
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: " дальше" }));
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    store.onAgentEvent(event({ type: "assistant_text_delta", messageId: "m1", delta: "Готово" }));
    store.onAgentEvent(
      event({
        type: "assistant_text_done",
        messageId: "m1",
        fullText: "Готово",
        reasoningContent: "Думаю дальше.",
      }),
    );

    expect(store.messages()).toEqual([
      { id: 1, type: "reasoning", content: "Думаю дальше." },
      { id: 2, type: "assistant", content: "Готово", streaming: false },
    ]);
  });

  test("собирает всю ленту сообщений в единый текст для копирования", () => {
    const store = createStore();
    store.onAgentEvent(event({ type: "turn_start", turnIndex: 1, userInput: "Проверь проект" }));
    store.onAgentEvent(
      event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "src/cli.ts" } }),
    );
    store.onAgentEvent(
      event({
        type: "tool_call_result",
        toolCallId: "t1",
        toolName: "read",
        result: { content: [{ type: "text", text: "file content" }] },
      }),
    );
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "read", durationMs: 12 }));
    store.onAgentEvent(event({ type: "assistant_message", messageId: "m1", text: "Готово" }));

    const transcript = store.getTranscriptText();
    expect(transcript).toContain("You\nПроверь проект");
    expect(transcript).toContain("→ Read src/cli.ts");
    expect(transcript).toContain("Assistant\nГотово");
  });

  test("working narration is visible in messages and transcript", () => {
    const store = createStore();
    store.onAgentEvent(
      event({
        type: "working_narration",
        eventType: "context_scan",
        message: "Checking project instructions.",
        evidenceIds: [],
      }),
    );

    expect(store.messages()).toEqual([
      {
        id: 1,
        type: "narration",
        eventType: "context_scan",
        content: "Checking project instructions.",
        evidenceIds: [],
      },
    ]);
    expect(store.getTranscriptText()).toContain("Checking project instructions.");
  });

  test("рендерит начало, результат и завершение тул-колла", () => {
    const store = createStore();
    store.onAgentEvent(
      event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "src/cli.ts" } }),
    );
    store.onAgentEvent(
      event({
        type: "tool_call_result",
        toolCallId: "t1",
        toolName: "read",
        result: { content: [{ type: "text", text: "file content" }] },
      }),
    );
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "read", durationMs: 12 }));

    // Tool-result is now always emitted (B2 collapsible tool results)
    expect(store.messages().map((message) => message.type)).toEqual(["tool-start", "tool-result", "tool-end"]);
    const startMessage = store.messages()[0];
    expect(startMessage).toMatchObject({ type: "tool-start", toolName: "read", summary: "Read src/cli.ts" });
    expect(store.messages()[1]).toMatchObject({ type: "tool-result", toolName: "read", content: "file content", durationMs: 12 });
    store.dispose();
  });

  test("рендерит ошибку тул-колла", () => {
    const store = createStore();
    store.onAgentEvent(
      event({ type: "tool_call_start", toolCallId: "t1", toolName: "bash", args: { command: "rm -rf /" } }),
    );
    store.onAgentEvent(
      event({
        type: "tool_call_result",
        toolCallId: "t1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "Permission denied" }], isError: true },
      }),
    );
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "bash", durationMs: 5 }));

    expect(store.messages().map((message) => message.type)).toEqual(["tool-start", "tool-result", "tool-end"]);
    expect(store.messages()[1]).toMatchObject({ type: "tool-result", isError: true, content: "Permission denied", toolName: "bash" });
    store.dispose();
  });

  test("dangerous confirmation передаёт одноразовое разрешение для y/yes", async () => {
    const store = createStore();
    let decision: string | null = null;
    await store.submit("run dangerous command");
    expect(store.isProcessing()).toBe(true);
    store.onAgentEvent(
      event({
        type: "dangerous_confirmation",
        toolName: "bash",
        toolCallId: "t1",
        description: "rm file",
        level: "dangerous",
        reason: "destructive",
        resolve: (value: "deny" | "once" | "session" | "repo" | "full") => {
          decision = value;
        },
      }),
    );

    await store.submit("y");
    expect(decision!).toBe("once");
    expect(store.confirmation()).toBeNull();
  });

  test("dangerous confirmation показывает короткое уведомление без текста команды", () => {
    const i18n = new I18n("en");
    const notificationStore = new NotificationStore({ i18n });
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
      getTrustManager: () => ({
        getPermissionMode: () => "ask" as const,
      }),
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 10_000,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["bash"],
      notificationStore,
      i18n,
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });
    const longCommand = "rm -rf node_modules && bun install && bun test --watch --very-long-argument";

    store.onAgentEvent(
      event({
        type: "dangerous_confirmation",
        toolName: "bash",
        toolCallId: "t1",
        description: longCommand,
        level: "dangerous",
        reason: `Dangerous command: ${longCommand}`,
        resolve: () => {},
      }),
    );

    expect(notificationStore.visible()).toHaveLength(1);
    expect(notificationStore.visible()[0]).toMatchObject({
      type: "warning",
      title: "Permission required",
      message: "Review the bash request in the TUI.",
    });
    expect(notificationStore.visible()[0].message).not.toContain(longCommand);
    store.dispose();
    notificationStore.dismissAll();
  });

  test("built-in TUI notifications are localized for en, ru and zh", () => {
    const cases = [
      {
        locale: "en",
        permissionTitle: "Permission required",
        budgetTitle: "Token budget critical",
        turnTitle: "Turn error",
        skillTitle: "Skill activated: review",
        compactionTitle: "Compaction complete",
      },
      {
        locale: "ru",
        permissionTitle: "Требуется разрешение",
        budgetTitle: "Бюджет токенов критический",
        turnTitle: "Ошибка хода",
        skillTitle: "Навык активирован: review",
        compactionTitle: "Сжатие завершено",
      },
      {
        locale: "zh",
        permissionTitle: "需要授权",
        budgetTitle: "Token 预算告急",
        turnTitle: "回合错误",
        skillTitle: "技能已激活: review",
        compactionTitle: "压缩完成",
      },
    ] as const;

    for (const item of cases) {
      const i18n = new I18n(item.locale);
      const notificationStore = new NotificationStore({ i18n });
      const agentLoop = {
        getModel: () => "test-model",
        runTurn: async () => {},
        getTrustManager: () => ({
          getPermissionMode: () => "ask" as const,
        }),
      } as unknown as AgentLoop;
      const store = new TuiStore({
        cwd: process.cwd(),
        tokenBudget: 10_000,
        contextWindow: 128_000,
        theme: "graphite",
        agentLoop,
        toolNames: ["bash"],
        notificationStore,
        i18n,
        executeCommand: async () => ({ handled: true }),
        debug: false,
        maxOutputTokens: 0,
        maxCompletionTokens: 0,
        maxAgentIterations: 0,
        maxStalledIterations: 4,
        maxRunMinutes: 0,
        autoCompact: true,
      });

      store.onAgentEvent(
        event({
          type: "dangerous_confirmation",
          toolName: "bash",
          toolCallId: "t1",
          description: "rm -rf node_modules",
          level: "dangerous",
          reason: "destructive",
          resolve: () => {},
        }),
      );
      expect(notificationStore.visible().at(-1)?.title).toBe(item.permissionTitle);

      store.onAgentEvent(
        event({
          type: "budget_update",
          usedTokens: 95,
          totalBudget: 100,
          percentage: 95,
        }),
      );
      expect(notificationStore.visible().at(-1)?.title).toBe(item.budgetTitle);

      store.onAgentEvent(event({ type: "turn_error", error: "boom" }));
      expect(notificationStore.visible().at(-1)?.title).toBe(item.turnTitle);

      store.onAgentEvent(event({ type: "skill_activated", skillName: "review", skillRevision: "abc123" }));
      expect(notificationStore.visible().at(-1)?.title).toBe(item.skillTitle);

      store.onAgentEvent(event({ type: "compaction_done", tokensSaved: 42, strategy: "portable" }));
      expect(notificationStore.visible().at(-1)?.title).toBe(item.compactionTitle);

      store.dispose();
      notificationStore.dismissAll();
    }
  });

  test("ставит сообщения в очередь во время работы, позволяет редактировать и отменять", async () => {
    const store = createStore();
    await store.submit("first");
    await store.submit("second");
    await store.submit("third");

    expect(store.queuedMessages().map((message) => message.content)).toEqual(["second", "third"]);

    await store.submit("/queue edit 1 revised second");
    await store.submit("/queue cancel 2");

    expect(store.queuedMessages()).toEqual([{ id: 1, content: "revised second", kind: "message" }]);
  });

  test("! выполняет shell напрямую, а !! скрывает результат", async () => {
    const shellCalls: Array<{ command: string; silent: boolean }> = [];
    const turns: string[] = [];
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async (input: string) => {
        turns.push(input);
      },
      runShellCommand: async (command: string, silent: boolean) => {
        shellCalls.push({ command, silent });
        return { content: [{ type: "text" as const, text: "ok" }], isError: false };
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["bash"],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    await store.submit("!pwd");
    await store.submit("!!bun test");

    expect(shellCalls).toEqual([
      { command: "pwd", silent: false },
      { command: "bun test", silent: true },
    ]);
    expect(turns).toEqual([]);
  });

  test("shell shortcut сохраняет режим вывода в очереди", async () => {
    const shellCalls: Array<{ command: string; silent: boolean }> = [];
    let releaseTurn: (() => void) | null = null;
    const activeTurn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => activeTurn,
      runShellCommand: async (command: string, silent: boolean) => {
        shellCalls.push({ command, silent });
        return { content: [{ type: "text" as const, text: "ok" }], isError: false };
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["bash"],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    const active = store.submit("agent task");
    await store.submit("!pwd");
    await store.submit("!!bun test");
    expect(store.queuedMessages()).toEqual([
      { id: 1, content: "pwd", kind: "shell" },
      { id: 2, content: "bun test", kind: "shell-silent" },
    ]);

    store.onAgentEvent(event({ type: "turn_end", stopReason: "completed" }));
    releaseTurn!();
    await active;
    expect(shellCalls).toEqual([
      { command: "pwd", silent: false },
      { command: "bun test", silent: true },
    ]);
  });

  test("после завершения turn автоматически запускает следующее сообщение из очереди", async () => {
    const turns: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async (input: string) => {
        turns.push(input);
        if (input === "first") await firstTurn;
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    const active = store.submit("first");
    await store.submit("second");
    store.onAgentEvent(event({ type: "turn_end", stopReason: "completed" }));
    releaseFirst!();
    await active;

    expect(turns).toEqual(["first", "second"]);
    expect(store.queuedMessages()).toEqual([]);
  });

  test("сообщение после turn_end остаётся в очереди до полного завершения runTurn", async () => {
    const turns: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async (input: string) => {
        turns.push(input);
        if (input === "first") await firstTurn;
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    const active = store.submit("first");
    store.onAgentEvent(event({ type: "turn_end", stopReason: "completed" }));
    await store.submit("second");

    expect(store.queuedMessages().map((message) => message.content)).toEqual(["second"]);
    releaseFirst!();
    await active;
    expect(turns).toEqual(["first", "second"]);
  });

  test("approval scope session, repo и full передаётся в agent loop", async () => {
    const store = createStore();
    await store.submit("dangerous");
    const decisions: string[] = [];
    const confirmation = (resolve: (decision: "deny" | "once" | "session" | "repo" | "full") => void) =>
      event({
        type: "dangerous_confirmation" as const,
        toolName: "bash",
        toolCallId: "t1",
        description: "rm -rf node_modules",
        level: "dangerous" as const,
        reason: "destructive",
        resolve,
      });

    store.onAgentEvent(confirmation((decision) => decisions.push(decision)));
    await store.submit("s");
    store.onAgentEvent(confirmation((decision) => decisions.push(decision)));
    await store.submit("r");
    store.onAgentEvent(confirmation((decision) => decisions.push(decision)));
    await store.submit("f");

    expect(decisions).toEqual(["session", "repo", "full"]);
    expect(store.permissionMode()).toBe("full");
  });

  test("/permissions переключает и очищает режим разрешений", async () => {
    const store = createStore();

    await store.submit("/permissions repo");
    expect(store.permissionMode()).toBe("repo");

    await store.submit("/permissions full");
    expect(store.permissionMode()).toBe("full");

    await store.submit("/permissions clear");
    expect(store.permissionMode()).toBe("ask");
  });

  test("/exit вызывает закрытие TUI", async () => {
    let exited = false;
    const store = createStore(() => {
      exited = true;
    });
    await store.submit("/exit");
    expect(exited).toBe(true);
  });

  test("навигация по истории возвращает предыдущие запросы", async () => {
    const store = createStore();
    await store.submit("first request");
    store.onAgentEvent(event({ type: "turn_end", stopReason: "completed" }));
    await store.submit("second request");

    expect(store.historyNavigate(1)).toBe("second request");
    expect(store.historyNavigate(1)).toBe("first request");
    expect(store.historyNavigate(-1)).toBe("second request");
  });

  test("навигация по истории возвращает slash-команды вместе с запросами", async () => {
    const store = createStore();
    await store.submit("inspect project");
    store.onAgentEvent(event({ type: "turn_end", stopReason: "completed" }));
    await store.submit("/session");
    await store.submit("/theme ember");

    expect(store.historyNavigate(1)).toBe("/theme ember");
    expect(store.historyNavigate(1)).toBe("/session");
    expect(store.historyNavigate(1)).toBe("inspect project");
  });

  test("/skill:<name> передаёт преобразованный prompt в agent turn", async () => {
    const turns: string[] = [];
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async (input: string) => {
        turns.push(input);
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async () => ({ handled: false, prompt: "Проверь staged diff" }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    await store.submit("/skill:commit-message Проверь staged diff");

    expect(turns).toEqual(["Проверь staged diff"]);
  });

  test("/theme меняет палитру запущенного TUI", async () => {
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async (_input, output) => {
        output({ type: "theme_changed", timestamp: Date.now(), theme: "ember" });
        return { handled: true };
      },
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    await store.submit("/theme ember");

    expect(store.themeName()).toBe("ember");
    expect(store.status()).toBe("theme: ember");
  });

  test("/compact no-op сбрасывает статус TUI после skipped event", async () => {
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async (_input, output) => {
        output({ type: "compaction_start", timestamp: Date.now(), tokensBefore: 7494 });
        output({
          type: "info",
          timestamp: Date.now(),
          message: "Manual compaction skipped: No reclaimable context",
        });
        output({
          type: "compaction_skipped",
          timestamp: Date.now(),
          reason: "No reclaimable context",
          tokensBefore: 7494,
          tokensAfter: 7494,
        });
        return { handled: true };
      },
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    await store.submit("/compact");

    expect(store.status()).toBe("agent is idle");
    expect(store.messages()).toContainEqual({
      id: 1,
      type: "info",
      content: "Manual compaction skipped: No reclaimable context",
    });
  });

  test("/lang обновляет chrome, но не переводит старые сообщения", async () => {
    const i18n = new I18n("en");
    const agentLoop = { getModel: () => "test-model", runTurn: async () => {} } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      i18n,
      executeCommand: async (_input, output) => {
        i18n.setLocale("ru");
        output({ type: "language_changed", timestamp: Date.now(), message: i18n.t("command.lang.changed", { locale: "ru" }) });
        return { handled: true };
      },
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    store.onAgentEvent(event({ type: "turn_error", error: "before" }));
    await store.submit("/lang ru");

    expect(store.getInputPlaceholder()).toBe("Спросите агента...");
    expect(store.messages()[0]).toMatchObject({ content: "Error: before" });
    expect(store.messages()[1]).toMatchObject({ content: "Язык изменён на: ru" });
  });

  test("cancel вызывает abort агента и сбрасывает состояние", () => {
    let aborted = false;
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
      abortActiveTool: () => false,
      abort: () => {
        aborted = true;
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    store.cancel();

    expect(aborted).toBe(true);
    expect(store.isProcessing()).toBe(false);
    expect(store.isIdle()).toBe(true);
    expect(store.status()).toBe("agent is idle");
    expect(store.messages().some((message) => message.type === "info" && message.content === "Operation cancelled")).toBe(
      true,
    );
  });

  test("cancel останавливает активный tool и оставляет агента работающим", () => {
    let toolAborted = false;
    let turnAborted = false;
    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
      abortActiveTool: () => {
        toolAborted = true;
        return true;
      },
      abort: () => {
        turnAborted = true;
      },
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: process.cwd(),
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });
    void store.submit("start server");

    store.cancel();

    expect(toolAborted).toBe(true);
    expect(turnAborted).toBe(false);
    expect(store.isProcessing()).toBe(true);
    expect(store.isIdle()).toBe(false);
    expect(store.messages().some((message) => message.type === "info" && message.content.includes("agent continues"))).toBe(
      true,
    );
  });
});

describe("CHANGES panel", () => {
  test("читает git diff --numstat", () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    Bun.spawnSync(["git", "init"], { cwd });
    Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd });
    writeFileSync(join(cwd, "file.txt"), "first\n");
    Bun.spawnSync(["git", "add", "file.txt"], { cwd });
    Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd });
    writeFileSync(join(cwd, "file.txt"), "first\nsecond\n");

    expect(readChangeStats(cwd)).toEqual([{ path: "file.txt", added: 1, removed: 0 }]);
  });

  test("включает untracked файлы из git status --porcelain", () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    Bun.spawnSync(["git", "init"], { cwd });
    Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd });
    writeFileSync(join(cwd, "new-file.ts"), "new content\n");

    expect(readChangeStats(cwd)).toEqual([{ path: "new-file.ts", added: 0, removed: 0 }]);
  });

  test("возвращает пустой массив для чистого репозитория", () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    Bun.spawnSync(["git", "init"], { cwd });

    expect(readChangeStats(cwd)).toEqual([]);
  });
});

describe("Project trust status", () => {
  test("показывает UNTRUSTED когда проект не одобрен", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-trust-test-"));
    const sobaDir = join(tempDir, ".soba");
    const trustStore = new ProjectTrustStore({ sobaDir });

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: tempDir,
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      trustStore,
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    expect(store.projectTrusted()).toBe(false);
    store.dispose();
  });

  test("показывает TRUSTED когда проект одобрен", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-trust-test-"));
    const sobaDir = join(tempDir, ".soba");
    const trustStore = new ProjectTrustStore({ sobaDir });
    const identity = ProjectTrustStore.computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: tempDir,
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      trustStore,
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    expect(store.projectTrusted()).toBe(true);
    store.dispose();
  });

  test("обновляется при trust_changed событии (approve)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-trust-test-"));
    const sobaDir = join(tempDir, ".soba");
    const trustStore = new ProjectTrustStore({ sobaDir });

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: tempDir,
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      trustStore,
      executeCommand: async (_input, output) => {
        // Simulate /project-trust approve
        const identity = ProjectTrustStore.computeProjectIdentity(tempDir);
        trustStore.approve(identity, "test-fingerprint");
        output({ type: "trust_changed", trusted: true, timestamp: Date.now() });
        return { handled: true };
      },
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    expect(store.projectTrusted()).toBe(false);
    await store.submit("/project-trust approve");
    expect(store.projectTrusted()).toBe(true);
    store.dispose();
  });

  test("обновляется при trust_changed событии (revoke)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-trust-test-"));
    const sobaDir = join(tempDir, ".soba");
    const trustStore = new ProjectTrustStore({ sobaDir });
    const identity = ProjectTrustStore.computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd: tempDir,
      tokenBudget: 0,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: [],
      trustStore,
      executeCommand: async (_input, output) => {
        // Simulate /project-trust revoke
        trustStore.revoke(identity);
        output({ type: "trust_changed", trusted: false, timestamp: Date.now() });
        return { handled: true };
      },
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    expect(store.projectTrusted()).toBe(true);
    await store.submit("/project-trust revoke");
    expect(store.projectTrusted()).toBe(false);
    store.dispose();
  });
});

describe("Sidebar reactivity", () => {
  test("activePane отражает текущую область клавиатурного ввода для sidebar-индикатора", () => {
    const store = createStore();

    expect(store.activePane()).toBe("input");

    store.setActiveUiPane("output");
    expect(store.activePane()).toBe("output");

    store.cycleSidebarMode(1);
    expect(store.activePane()).toBe("sidebar");

    store.openSearch();
    expect(store.activePane()).toBe("overlay");

    store.closeSearch();
    expect(store.activePane()).toBe("input");

    store.dispose();
  });

  test("context meter segments пересчитываются для нового процента заполнения", () => {
    expect(getProgressBarSegments(0)).toEqual({ filled: 0, empty: 10, roundedPercent: 0 });
    expect(getProgressBarSegments(42.4)).toEqual({ filled: 4, empty: 6, roundedPercent: 42 });
    expect(getProgressBarSegments(95.1)).toEqual({ filled: 10, empty: 0, roundedPercent: 95 });
  });

  test("trust badge uses explicit status labels instead of yes/no", () => {
    expect(getTrustBadgeParts(true)).toMatchObject({
      icon: "✓",
      label: "trusted",
      detail: "skills on",
      tone: "trusted",
    });
    expect(getTrustBadgeParts(false)).toMatchObject({
      icon: "⚠",
      label: "untrusted",
      detail: "approve",
      tone: "untrusted",
    });
  });

  test("brand logo switches to compact one-line variant for narrow sidebar", () => {
    expect(shouldUseCompactSidebarLogo(SIDEBAR_COMPACT_LOGO_MAX_WIDTH)).toBe(true);
    expect(shouldUseCompactSidebarLogo(SIDEBAR_COMPACT_LOGO_MAX_WIDTH + 1)).toBe(false);
  });

  test("budget_update обновляет effective context tokens для sidebar без смены режима", () => {
    const store = createStore();

    store.onAgentEvent(
      event({
        type: "budget_update",
        usedTokens: 12_000,
        totalBudget: 100_000,
        percentage: 12,
        effectiveContextTokens: 42_000,
      }),
    );

    expect(store.usedTokens()).toBe(12_000);
    expect(store.effectiveContextTokens()).toBe(42_000);
    expect(getProgressBarSegments((store.effectiveContextTokens() / store.options.contextWindow) * 100)).toEqual({
      filled: 3,
      empty: 7,
      roundedPercent: 33,
    });
    store.dispose();
  });

  test("fileTree обновляется через refreshFileTreeDeferred после tool_call_end", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    writeFileSync(join(cwd, "existing.ts"), "content");

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd,
      tokenBudget: 10_000,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["read", "edit"],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    const initial = store.fileTree();
    expect(initial.some((entry) => entry.includes("existing.ts"))).toBe(true);
    expect(initial.some((entry) => entry.includes("new-file.ts"))).toBe(false);

    // Create a new file (simulating what write tool does)
    writeFileSync(join(cwd, "new-file.ts"), "new");

    // Trigger the refresh via tool_call_end
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "write", durationMs: 10 }));

    // Wait for the deferred refresh
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = store.fileTree();
    expect(updated.some((entry) => entry.includes("new-file.ts"))).toBe(true);
    store.dispose();
  });

  test("changes обновляется через refreshChangesDeferred после tool_call_end (untracked)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    Bun.spawnSync(["git", "init"], { cwd });
    Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd });

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd,
      tokenBudget: 10_000,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["write"],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    expect(store.changes()).toEqual([]);

    // Create an untracked file
    writeFileSync(join(cwd, "new-file.ts"), "new");

    // Trigger the refresh
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "write", durationMs: 10 }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.changes()).toEqual([{ path: "new-file.ts", added: 0, removed: 0 }]);
    store.dispose();
  });

  test("changes обновляется через refreshChangesDeferred после tool_call_end (modified)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-tui-"));
    Bun.spawnSync(["git", "init"], { cwd });
    Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd });
    writeFileSync(join(cwd, "file.txt"), "first\n");
    Bun.spawnSync(["git", "add", "file.txt"], { cwd });
    Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd });

    const agentLoop = {
      getModel: () => "test-model",
      runTurn: async () => {},
    } as unknown as AgentLoop;
    const store = new TuiStore({
      cwd,
      tokenBudget: 10_000,
      contextWindow: 128_000,
      theme: "graphite",
      agentLoop,
      toolNames: ["write", "edit"],
      executeCommand: async () => ({ handled: true }),
      debug: false,
      maxOutputTokens: 0,
      maxCompletionTokens: 0,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      autoCompact: true,
    });

    // Initial state: clean
    expect(store.changes()).toEqual([]);

    // Modify the file (simulating edit tool)
    writeFileSync(join(cwd, "file.txt"), "first\nsecond\n");

    // Trigger the refresh
    store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "edit", durationMs: 10 }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.changes()).toEqual([{ path: "file.txt", added: 1, removed: 0 }]);
    store.dispose();
  });
});
