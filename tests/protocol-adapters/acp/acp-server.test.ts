import { describe, expect, test } from "bun:test";
import type { RuntimeSessionInfo, SobaRuntime } from "../../../src/application/types";
import { runAcpServer } from "../../../src/apps/acp-server/server";

function makeRuntime(): SobaRuntime {
  const sessions: RuntimeSessionInfo[] = [];
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
    async openSession() {
      throw new Error("not implemented in foundation test runtime");
    },
    async loadSession() {
      throw new Error("not implemented in foundation test runtime");
    },
    async resumeSession() {
      throw new Error("not implemented in foundation test runtime");
    },
    async listSessions() {
      return sessions;
    },
    listCommands() {
      return [];
    },
    async closeSession() {},
    async deleteSession() {},
    async setSessionConfig() {
      throw new Error("not implemented in foundation test runtime");
    },
    async setSessionMode() {
      throw new Error("not implemented in foundation test runtime");
    },
    async runTurn() {
      throw new Error("not implemented in foundation test runtime");
    },
    cancelTurn() {},
    onEvent() {
      return () => {};
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

  test("initializes with foundation capabilities", async () => {
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
          loadSession: false,
          promptCapabilities: {
            embeddedContext: false,
            image: false,
            audio: false,
          },
          sessionConfig: false,
          sessionModes: false,
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
        params: { cwd: "/repo/subproject" },
      })}\n`,
    ]);

    expect(result.messages[0]).toEqual({
      jsonrpc: "2.0",
      id: "new",
      result: {
        session: {
          id: "session_1",
          cwd: "/repo/subproject",
          title: "ACP test session",
          updatedAt: "2026-06-27T00:00:00.000Z",
        },
      },
    });
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
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/prompt",
        params: { sessionId: "session_1" },
      })}\n`,
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.stderr.join("")).toContain("Method not found: session/prompt");
  });

  test("returns method-not-found for unimplemented ACP methods", async () => {
    const result = await runLines([
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "session/prompt",
        params: { sessionId: "session_1" },
      })}\n`,
    ]);

    expect(result.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 10,
      error: { code: -32601, message: "Method not found: session/prompt" },
    });
  });
});
