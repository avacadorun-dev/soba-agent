/**
 * Phase 2.5 B2 — Collapsible Tool Results Tests.
 *
 * Tests for:
 *  - ToolResultBlock rendering (collapsed and expanded)
 *  - Error results auto-expand
 *  - Enter toggles expand/collapse
 *  - Diff highlighting for edit tool results
 *  - TuiStore emits tool-result for all tools (not just errors)
 *  - DurationMs patching on tool-end
 */

import { beforeEach, describe, expect, test, vi } from "bun:test";
import type { AgentEvent } from "../../../src/core/loop/types";
import { TuiStore } from "../../../src/widgets/tui/model/tui-store";
import { createToolResultMouseToggle } from "../../../src/widgets/tui/ui/tool-result-block";

function event(value: Record<string, unknown>): AgentEvent {
  return { ...value, timestamp: Date.now(), turnIndex: 1 } as unknown as AgentEvent;
}

function createStore(): TuiStore {
  return new TuiStore({
    cwd: process.cwd(),
    tokenBudget: 200000,
    contextWindow: 200000,
    theme: "graphite",
    toolNames: ["read", "write", "edit", "bash", "ls"],
    executeCommand: vi.fn() as any,
    agentLoop: {
      getModel: () => "test-model",
      getTrustManager: () => ({
        getTrust: (_tool: string) => "safe",
        isProjectTrusted: () => false,
        getPermissionMode: () => "ask" as const,
        setPermissionMode: (_mode: string) => {},
        clearSessionApprovals: () => {},
      }),
    } as any,
    i18n: { t: (k: string, _args?: Record<string, unknown>) => k, locale: "en" } as any,
    debug: false,
    maxOutputTokens: 0,
    maxCompletionTokens: 0,
    maxAgentIterations: 0,
    maxStalledIterations: 4,
    maxRunMinutes: 0,
    autoCompact: true,
  });
}


describe("B2 — Collapsible Tool Results", () => {
  let store: TuiStore;

  beforeEach(() => {
    store = createStore();
  });

  describe("Mouse interaction", () => {
    test("plain mouse click toggles collapsed tool result", () => {
      let toggles = 0;
      const mouse = createToolResultMouseToggle(() => {
        toggles += 1;
      });

      mouse.onMouseDown({ x: 4, y: 8 } as any);
      mouse.onMouseUp({ x: 4, y: 8 } as any);

      expect(toggles).toBe(1);
    });

    test("drag selection inside expanded tool result does not toggle", () => {
      let toggles = 0;
      const mouse = createToolResultMouseToggle(() => {
        toggles += 1;
      });

      mouse.onMouseDown({ x: 4, y: 8 } as any);
      mouse.onMouseDrag();
      mouse.onMouseDragEnd();
      mouse.onMouseUp({ x: 18, y: 8 } as any);

      expect(toggles).toBe(0);
    });

    test("mouse release in another terminal cell is treated as selection", () => {
      let toggles = 0;
      const mouse = createToolResultMouseToggle(() => {
        toggles += 1;
      });

      mouse.onMouseDown({ x: 4, y: 8 } as any);
      mouse.onMouseUp({ x: 5, y: 8 } as any);

      expect(toggles).toBe(0);
    });
  });

  describe("Tool-result is now always emitted", () => {
    test("successful read emits tool-start, tool-result, tool-end", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "read",
          result: { content: [{ type: "text", text: "const x = 1;\nconst y = 2;" }] },
        }),
      );
      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "read", durationMs: 12 }));

      const types = store.messages().map((m) => m.type);
      expect(types).toEqual(["tool-start", "tool-result", "tool-end"]);
    });

    test("successful write emits tool-result with toolName", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "write", args: { path: "out.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "write",
          result: { content: [{ type: "text", text: "Wrote 100 bytes" }], isError: false },
        }),
      );
      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "write", durationMs: 5 }));

      const resultMsg = store.messages().find((m) => m.type === "tool-result");
      expect(resultMsg).toBeDefined();
      if (resultMsg) {
        expect(resultMsg).toMatchObject({ type: "tool-result", toolName: "write", isError: false });
      }
    });

    test("error result still emitted with isError: true", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "bash", args: { command: "rm" } }),
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

      const resultMsg = store.messages().find((m) => m.type === "tool-result");
      expect(resultMsg).toBeDefined();
      if (resultMsg) {
        expect(resultMsg).toMatchObject({ type: "tool-result", toolName: "bash", isError: true, content: "Permission denied" });
      }
    });

    test("bash result keeps full command details for expanded panel", () => {
      const command =
        "cd /tmp/soba-test-repo && printf 'q' | script -q /tmp/atop_final.txt ./atop --very-long-flag --another-long-flag";
      store.onAgentEvent(event({ type: "tool_call_start", toolCallId: "t1", toolName: "bash", args: { command } }));
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "bash",
          result: { content: [{ type: "text", text: "ok" }], isError: false },
        }),
      );

      const resultMsg = store.messages().find((m) => m.type === "tool-result");
      expect(resultMsg).toBeDefined();
      if (resultMsg?.type === "tool-result") {
        expect(resultMsg.summary.length).toBeLessThan(command.length);
        expect(resultMsg.details).toEqual([`command: ${command}`]);
      }
    });

    test("parallel same-name tools keep summary and details by toolCallId", () => {
      store.onAgentEvent(event({ type: "tool_call_start", toolCallId: "t1", toolName: "bash", args: { command: "echo first" } }));
      store.onAgentEvent(event({ type: "tool_call_start", toolCallId: "t2", toolName: "bash", args: { command: "echo second" } }));
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "bash",
          result: { content: [{ type: "text", text: "first" }], isError: false },
        }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t2",
          toolName: "bash",
          result: { content: [{ type: "text", text: "second" }], isError: false },
        }),
      );

      const results = store.messages().filter((m) => m.type === "tool-result");
      expect(results.map((m) => m.summary)).toEqual(["Bash echo first", "Bash echo second"]);
      expect(results.map((m) => m.details?.[0])).toEqual(["command: echo first", "command: echo second"]);
    });

    test("edit tool result has isDiff: true", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "edit", args: { path: "file.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "edit",
          result: { content: [{ type: "text", text: "+added\n-removed\n@@ -1,1 +1,1 @@" }] },
        }),
      );
      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "edit", durationMs: 8 }));

      const resultMsg = store.messages().find((m) => m.type === "tool-result");
      expect(resultMsg).toBeDefined();
      if (resultMsg) {
        expect(resultMsg).toMatchObject({ type: "tool-result", toolName: "edit", isDiff: true });
      }
    });
  });

  describe("Duration patching on tool-end", () => {
    test("tool-end patches the previous tool-result with durationMs", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "read",
          result: { content: [{ type: "text", text: "content" }] },
        }),
      );

      // Before tool-end, durationMs should be undefined
      const beforeEnd = store.messages().find((m) => m.type === "tool-result");
      expect(beforeEnd).toBeDefined();
      if (beforeEnd) {
        expect(beforeEnd.durationMs).toBeUndefined();
      }

      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "read", durationMs: 42 }));

      // After tool-end, durationMs should be patched
      const afterEnd = store.messages().find((m) => m.type === "tool-result");
      expect(afterEnd).toBeDefined();
      if (afterEnd) {
        expect(afterEnd.durationMs).toBe(42);
      }
    });

    test("durationMs patches only the matching tool-result", () => {
      // First tool: read
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "a.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t1",
          toolName: "read",
          result: { content: [{ type: "text", text: "aaa" }] },
        }),
      );
      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t1", toolName: "read", durationMs: 10 }));

      // Second tool: write
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t2", toolName: "write", args: { path: "b.ts" } }),
      );
      store.onAgentEvent(
        event({
          type: "tool_call_result",
          toolCallId: "t2",
          toolName: "write",
          result: { content: [{ type: "text", text: "bbb" }] },
        }),
      );
      store.onAgentEvent(event({ type: "tool_call_end", toolCallId: "t2", toolName: "write", durationMs: 20 }));

      const results = store.messages().filter((m) => m.type === "tool-result");
      expect(results.length).toBe(2);

      // First should have 10, second 20
      expect(results[0].toolName).toBe("read");
      expect(results[0].durationMs).toBe(10);
      expect(results[1].toolName).toBe("write");
      expect(results[1].durationMs).toBe(20);
    });
  });

  describe("MessageList tool-result focus state", () => {
    test("messages array correctly identifies tool-result types with toolName", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
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

      const msgs = store.messages();
      const toolResults = msgs.filter((m) => m.type === "tool-result");
      expect(toolResults.length).toBe(1);
      expect(toolResults[0].toolName).toBe("read");
    });

    test("multiple tool calls produce distinct tool-result messages", () => {
      for (const callId of ["t1", "t2", "t3"]) {
        store.onAgentEvent(
          event({ type: "tool_call_start", toolCallId: callId, toolName: "ls", args: { path: "." } }),
        );
        store.onAgentEvent(
          event({
            type: "tool_call_result",
            toolCallId: callId,
            toolName: "ls",
            result: { content: [{ type: "text", text: callId }] },
          }),
        );
        store.onAgentEvent(event({ type: "tool_call_end", toolCallId: callId, toolName: "ls", durationMs: 1 }));
      }

      const toolResults = store.messages().filter((m) => m.type === "tool-result");
      expect(toolResults.length).toBe(3);
      // Each should have a unique ID
      const ids = toolResults.map((m) => m.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe("Transcript compatibility", () => {
    test("transcript still includes tool-start summaries", () => {
      store.onAgentEvent(event({ type: "turn_start", turnIndex: 1, userInput: "read the file" }));
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
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
      store.onAgentEvent(event({ type: "assistant_message", messageId: "m1", text: "Done" }));

      const transcript = store.getTranscriptText();
      expect(transcript).toContain("tui.label.you");
      expect(transcript).toContain("read the file");
      expect(transcript).toContain("→");
      expect(transcript).toContain("Read file.ts");
      expect(transcript).toContain("tui.label.assistant");
      expect(transcript).toContain("Done");
    });

    test("non-error tool-result produces empty transcript line (backward compat)", () => {
      store.onAgentEvent(
        event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
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

      const transcript = store.getTranscriptText();
      // Non-error tool-result should produce empty string in transcript (filtered out)
      // The transcript should only have tool-start "→ Read file.ts" and tool-end ""
      const lines = transcript.split("\n\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("→ Read file.ts");
    });
  });
});
