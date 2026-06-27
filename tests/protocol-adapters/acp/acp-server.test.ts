import { describe, expect, test } from "bun:test";
import type { RuntimeEvent, RuntimeSessionInfo, SobaRuntime, UserTurnInput } from "../../../src/application/types";
import { runAcpServer } from "../../../src/apps/acp-server/server";

function makeRuntime(): SobaRuntime {
  const sessions: RuntimeSessionInfo[] = [];
  const listeners: Array<(event: RuntimeEvent) => void> = [];
  return {
    async createSession(input) {
      const session = {
        id: `session_${sessions.length + 1}`,
        cwd: input.cwd,
        title: "ACP test session",
        updatedAt: "2026-06-27T00:00:00.000Z",
      };
      sessions.push(session);
      return session;
    },
    async openSession(input) {
      return { id: input.sessionId, cwd: input.cwd };
    },
    async loadSession(input) {
      return {
        info: { id: input.sessionId, cwd: "/repo", title: "Loaded session" },
        entries: [
          {
            type: "item",
            item: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "loaded answer" }],
            },
          },
        ],
      };
    },
    async resumeSession(input) {
      return { id: input.sessionId, cwd: "/repo", title: "Resumed session" };
    },
    async listSessions(input) {
      return sessions.length > 0 ? sessions : [{ id: "session_existing", cwd: input.cwd, title: "Existing session" }];
    },
    listCommands() {
      return [];
    },
    async closeSession() {},
    async deleteSession() {},
    async setSessionConfig(input) {
      return { id: input.sessionId, cwd: "/repo", title: `${input.key}:${String(input.value)}` };
    },
    async setSessionMode(input) {
      return { id: input.sessionId, cwd: "/repo", title: `${input.mode}:${String(input.enabled)}` };
    },
    async runTurn(input: UserTurnInput) {
      listeners.forEach((listener) =>
        listener({
          type: "assistant_text_delta",
          timestamp: Date.now(),
          messageId: "msg_1",
          delta: `echo:${input.content[0]?.type === "text" ? input.content[0].text : "content"}`,
        } as RuntimeEvent),
      );
      return {
        items: [],
        response: {} as Awaited<ReturnType<SobaRuntime["runTurn"]>>["response"],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
        errors: [],
        activeErrors: [],
      };
    },
    cancelTurn() {},
    onEvent() {
      const listener = arguments[0] as (event: RuntimeEvent) => void;
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
}

async function runLines(lines: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  await runAcpServer({
    runtime: makeRuntime(),
    cwd: "/repo",
    input: toAsyncIterable(lines),
    writeStdout: (chunk) => {
      stdout.push(chunk);
    },
    writeStderr: (chunk) => {
      stderr.push(chunk);
    },
    agentInfo: { name: "soba-agent", version: "0.5.0" },
  });

  return {
    stdout,
    stderr,
    messages: stdout.flatMap((chunk) =>
      chunk
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    ),
  };
}

async function* toAsyncIterable(lines: string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

describe("ACP stdio server foundation", () => {
  test("handles malformed JSON without writing non-JSON stdout", async () => {
    const result = await runLines(["{not json}\n"]);

    expect(result.stdout).toHaveLength(1);
    expect(() => JSON.parse(result.stdout[0])).not.toThrow();
    expect(result.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    expect(result.stderr.join("")).toContain("[soba acp] -32700 Parse error");
  });

  test("initializes with lifecycle capabilities", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientInfo: { name: "zed", version: "1.0.0" } },
      })}\n`,
    ]);

    expect(result.messages[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        agentInfo: { name: "soba-agent", version: "0.5.0" },
        agentCapabilities: {
          promptCapabilities: {
            embeddedContext: true,
            image: true,
            audio: false,
          },
          sessionCapabilities: {
            cancel: true,
            close: true,
            delete: true,
            list: true,
            load: true,
            update: true,
          },
          sessionConfig: true,
          sessionModes: true,
        },
      },
    });
  });

  test("creates a session through the runtime", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        method: "session/new",
        params: { cwd: "/repo/subproject", mcpServers: [] },
      })}\n`,
    ]);

    expect(result.messages[0]).toEqual({
      jsonrpc: "2.0",
      id: "new",
      result: { sessionId: "session_1" },
    });
  });

  test("lists, loads and resumes sessions", async () => {
    const result = await runLines([
      `${JSON.stringify({ jsonrpc: "2.0", id: "list", method: "session/list", params: { cwd: "/repo" } })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: "load", method: "session/load", params: { sessionId: "session_loaded" } })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: "resume", method: "session/resume", params: { sessionId: "session_loaded" } })}\n`,
    ]);

    expect(result.messages[0]).toMatchObject({
      id: "list",
      result: { sessions: [{ sessionId: "session_existing", cwd: "/repo", title: "Existing session" }] },
    });
    expect(result.messages[1]).toMatchObject({
      method: "session/update",
      params: {
        sessionId: "session_loaded",
        update: {
          type: "agent_message",
          content: [{ type: "text", text: "loaded answer" }],
        },
      },
    });
    expect(result.messages[2]).toMatchObject({ id: "load", result: { sessionId: "session_loaded" } });
    expect(result.messages[3]).toMatchObject({ id: "resume", result: { sessionId: "session_loaded" } });
  });

  test("runs prompts and emits session updates", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "prompt",
        method: "session/prompt",
        params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
      })}\n`,
    ]);

    expect(result.messages[0]).toMatchObject({
      method: "session/update",
      params: {
        sessionId: "session_1",
        update: {
          type: "agent_message_chunk",
          messageId: "msg_1",
          content: { type: "text", text: "echo:hello" },
        },
      },
    });
    expect(result.messages[1]).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "end_turn" },
    });
  });

  test("handles lifecycle mutation methods", async () => {
    const result = await runLines([
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/cancel", params: { sessionId: "session_1" } })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/close", params: { sessionId: "session_1" } })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/delete", params: { sessionId: "session_1" } })}\n`,
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "session/set_config_option",
        params: { sessionId: "session_1", key: "model", value: "test-model" },
      })}\n`,
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "session/set_mode",
        params: { sessionId: "session_1", mode: "planning", enabled: true },
      })}\n`,
    ]);

    expect(result.messages.map((message) => message.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.messages[0]).toMatchObject({ result: { cancelled: true } });
    expect(result.messages[1]).toMatchObject({ result: {} });
    expect(result.messages[2]).toMatchObject({ result: {} });
    expect(result.messages[3]).toMatchObject({ result: { session: { title: "model:test-model" } } });
    expect(result.messages[4]).toMatchObject({ result: { session: { title: "planning:true" } } });
  });

  test("does not respond to valid notifications", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: 1 },
      })}\n`,
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([]);
  });

  test("does not respond to notification handler errors", async () => {
    const result = await runLines([
      `${JSON.stringify({ jsonrpc: "2.0", method: "unknown/method", params: {} })}\n`,
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.stderr.join("")).toContain("Method not found: unknown/method");
  });

  test("returns method-not-found for unknown ACP methods", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "unknown/method",
        params: {},
      })}\n`,
    ]);

    expect(result.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 10,
      error: { code: -32601, message: "Method not found: unknown/method" },
    });
  });
});
