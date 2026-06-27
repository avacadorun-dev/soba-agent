import { describe, expect, test } from "bun:test";
import { ACP_LIFECYCLE_FEATURES, type AcpFeatureSet } from "../../../src/adapters/acp/capabilities";
import type { JsonValue } from "../../../src/adapters/acp/json-rpc";
import { listRuntimeCommands } from "../../../src/application/command-service";
import type { RuntimeEvent, RuntimeSessionInfo, SobaRuntime, UserTurnInput } from "../../../src/application/types";
import { runAcpServer } from "../../../src/apps/acp/server";
import { APP_VERSION } from "../../../src/core/version";

interface MockRuntimeState {
  lastTurnInput?: UserTurnInput;
  emitToolEvents?: boolean;
  emitEditEvents?: boolean;
  emitBashEvents?: boolean;
  emitPermission?: boolean;
  waitForCancel?: boolean;
  permissionDecision?: string;
  turnErrorType?: "api_error" | "cancelled" | "security_denial";
  configOptions?: Awaited<ReturnType<NonNullable<SobaRuntime["listSessionConfigOptions"]>>>;
  missingSessionIds?: Set<string>;
  assistantDeltas?: string[];
  assistantMessage?: string;
}

function makeRuntime(state: MockRuntimeState = {}): SobaRuntime {
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
      if (state.missingSessionIds?.has(input.sessionId)) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
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
      if (state.missingSessionIds?.has(input.sessionId)) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
      return { id: input.sessionId, cwd: "/repo", title: "Resumed session" };
    },
    async listSessions(input) {
      return sessions.length > 0 ? sessions : [{ id: "session_existing", cwd: input.cwd, title: "Existing session" }];
    },
    listCommands(input) {
      return listRuntimeCommands(input);
    },
    async listSessionConfigOptions() {
      return state.configOptions ?? [];
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
      state.lastTurnInput = input;
      if (state.waitForCancel) {
        await new Promise<void>((resolve) => {
          const started = Date.now();
          const interval = setInterval(() => {
            if (state.turnErrorType === "cancelled" || Date.now() - started > 1000) {
              clearInterval(interval);
              resolve();
            }
          }, 1);
        });
      }
      if (state.emitToolEvents) {
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_start",
            timestamp: Date.now(),
            toolCallId: "tool_1",
            toolName: "read",
            args: { path: "src/app.ts" },
          } as RuntimeEvent),
        );
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_result",
            timestamp: Date.now(),
            toolCallId: "tool_1",
            toolName: "read",
            result: {
              content: [{ type: "text", text: "file text" }],
              isError: false,
              details: { path: "src/app.ts", line: 3 },
            },
          } as RuntimeEvent),
        );
        listeners.forEach((listener) =>
          listener({
            type: "budget_update",
            timestamp: Date.now(),
            usedTokens: 10,
            effectiveContextTokens: 20,
            totalBudget: 100,
            contextWindow: 128000,
            percentage: 20,
          } as RuntimeEvent),
        );
      }
      if (state.emitEditEvents) {
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_start",
            timestamp: Date.now(),
            toolCallId: "tool_edit",
            toolName: "edit",
            args: { path: "/repo/src/app.ts" },
          } as RuntimeEvent),
        );
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_result",
            timestamp: Date.now(),
            toolCallId: "tool_edit",
            toolName: "edit",
            result: {
              content: [{ type: "text", text: "edited" }],
              isError: false,
              details: {
                path: "/repo/src/app.ts",
                oldText: "const value = 1;\n",
                newText: "const value = 2;\n",
              },
            },
          } as RuntimeEvent),
        );
      }
      if (state.emitBashEvents) {
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_start",
            timestamp: Date.now(),
            toolCallId: "tool_bash",
            toolName: "bash",
            args: { command: "bun test tests/adapters/acp/acp-server.test.ts", timeout: 10 },
          } as RuntimeEvent),
        );
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_result",
            timestamp: Date.now(),
            toolCallId: "tool_bash",
            toolName: "bash",
            result: {
              content: [{ type: "text", text: "failing output\n[Exit code: 1]" }],
              isError: true,
              details: {
                command: "bun test tests/adapters/acp/acp-server.test.ts",
                exitCode: 1,
                timedOut: false,
                truncated: false,
              },
            },
          } as RuntimeEvent),
        );
        listeners.forEach((listener) =>
          listener({
            type: "tool_call_end",
            timestamp: Date.now(),
            toolCallId: "tool_bash",
            toolName: "bash",
            durationMs: 123,
          } as RuntimeEvent),
        );
      }
      if (state.emitPermission) {
        await new Promise<void>((resolve) => {
          listeners.forEach((listener) =>
            listener({
              type: "dangerous_confirmation",
              timestamp: Date.now(),
              toolCallId: "tool_danger",
              toolName: "bash",
              description: "rm -rf dist",
              level: "dangerous",
              reason: "Deletes files",
              resolve: (decision) => {
                state.permissionDecision = decision;
                resolve();
              },
            } as RuntimeEvent),
          );
        });
      }
      const assistantDeltas = state.assistantMessage === undefined
        ? state.assistantDeltas ?? [`echo:${input.content[0]?.type === "text" ? input.content[0].text : "content"}`]
        : [];
      if (state.assistantMessage !== undefined) {
        listeners.forEach((listener) => listener({
          type: "assistant_message",
          timestamp: Date.now(),
          messageId: "msg_1",
          text: state.assistantMessage ?? "",
        } as RuntimeEvent));
      }
      assistantDeltas.forEach((delta) => {
        listeners.forEach((listener) => listener({
          type: "assistant_text_delta",
          timestamp: Date.now(),
          messageId: "msg_1",
          delta,
        } as RuntimeEvent));
      });
      const turnError = state.turnErrorType
        ? {
          id: "err_1",
          type: state.turnErrorType,
          status: "active" as const,
          message: "mock turn error",
        }
        : undefined;
      if (turnError && turnError.type !== "cancelled") {
        listeners.forEach((listener) =>
          listener({
            type: "turn_error",
            timestamp: Date.now(),
            error: turnError.message,
            status: turnError.type,
          } as RuntimeEvent),
        );
      }
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
        errors: turnError ? [turnError] : [],
        activeErrors: turnError && turnError.type !== "cancelled" ? [turnError] : [],
      };
    },
    cancelTurn() {
      state.turnErrorType = "cancelled";
    },
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

async function runLines(
  lines: string[],
  options: {
    state?: MockRuntimeState;
    requestClient?: (method: string, params: JsonValue) => JsonValue | Promise<JsonValue>;
    features?: AcpFeatureSet;
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  await runAcpServer({
    runtime: makeRuntime(options.state),
    cwd: "/repo",
    input: toAsyncIterable(lines),
    writeStdout: (chunk) => {
      stdout.push(chunk);
    },
    writeStderr: (chunk) => {
      stderr.push(chunk);
    },
    agentInfo: { name: "soba-agent", version: APP_VERSION },
    requestClient: options.requestClient,
    features: options.features,
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
        agentInfo: { name: "soba-agent", version: APP_VERSION },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            embeddedContext: true,
            image: true,
            audio: false,
          },
          sessionCapabilities: {
            close: {},
            delete: {},
            list: {},
            resume: {},
          },
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
    expect(result.messages[1]).toMatchObject({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session_1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: expect.arrayContaining([
            expect.objectContaining({ name: "mcp", description: "Manage MCP servers.", input: { hint: expect.stringContaining("status") } }),
            expect.objectContaining({ name: "session", description: "Show session statistics." }),
            expect.objectContaining({ name: "budget", description: "Show token budget usage." }),
            expect.objectContaining({ name: "help", description: "Show available commands." }),
          ]),
        },
      },
    });
  });

  test("returns session config options for model and provider selectors", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "new",
          method: "session/new",
          params: { cwd: "/repo/subproject", mcpServers: [] },
        })}\n`,
      ],
      {
        state: {
          configOptions: [
            {
              id: "provider",
              name: "Provider",
              type: "select",
              currentValue: "openrouter",
              options: [{ value: "openrouter", name: "OpenRouter" }],
            },
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: "openai/gpt-4.1",
              options: [{ value: "openai/gpt-4.1", name: "GPT-4.1" }],
            },
          ],
        },
      },
    );

    expect(result.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "new",
      result: {
        sessionId: "session_1",
        configOptions: [
          { id: "provider", type: "select", currentValue: "openrouter" },
          { id: "model", type: "select", currentValue: "openai/gpt-4.1" },
        ],
      },
    });
  });

  test("returns refreshed config options after setting a config option", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "set-config",
          method: "session/set_config_option",
          params: { sessionId: "session_1", configId: "provider", value: "openrouter" },
        })}\n`,
      ],
      {
        state: {
          configOptions: [
            {
              id: "provider",
              name: "Provider",
              type: "select",
              currentValue: "openrouter",
              options: [{ value: "openrouter", name: "OpenRouter" }],
            },
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: "openai/gpt-4.1",
              options: [{ value: "openai/gpt-4.1", name: "GPT-4.1" }],
            },
          ],
        },
      },
    );

    expect(result.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "set-config",
      result: {
        configOptions: [
          { id: "provider", type: "select", currentValue: "openrouter" },
          { id: "model", type: "select", currentValue: "openai/gpt-4.1" },
        ],
      },
    });
  });

  test("lists, loads and resumes sessions", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({ jsonrpc: "2.0", id: "list", method: "session/list", params: { cwd: "/repo" } })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: "load", method: "session/load", params: { sessionId: "session_loaded", cwd: "/repo", mcpServers: [] } })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: "resume", method: "session/resume", params: { sessionId: "session_loaded", cwd: "/repo" } })}\n`,
      ],
    );

    expect(result.messages[0]).toMatchObject({
      id: "list",
      result: { sessions: [{ sessionId: "session_existing", cwd: "/repo", title: "Existing session" }] },
    });
    expect(result.messages[1]).toMatchObject({
      method: "session/update",
      params: {
        sessionId: "session_loaded",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "loaded answer" },
        },
      },
    });
    expect(result.messages).toContainEqual(expect.objectContaining({ id: "load", result: {} }));
    expect(result.messages).toContainEqual(expect.objectContaining({ id: "resume", result: {} }));
    expect(result.messages).toContainEqual(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        sessionId: "session_loaded",
        update: expect.objectContaining({
          sessionUpdate: "available_commands_update",
          availableCommands: expect.arrayContaining([expect.objectContaining({ name: "mcp" })]),
        }),
      }),
    }));
  });

  test("aliases stale ACP session ids to a live runtime session", async () => {
    const state: MockRuntimeState = {
      missingSessionIds: new Set(["zed_stale_session"]),
    };
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "load",
          method: "session/load",
          params: { sessionId: "zed_stale_session", cwd: "/repo", mcpServers: [] },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "zed_stale_session", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      { state },
    );

    expect(result.messages[0]).toMatchObject({ id: "load", result: {} });
    expect(state.lastTurnInput).toMatchObject({ sessionId: "session_1" });
    expect(result.messages).toContainEqual(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        sessionId: "zed_stale_session",
        update: expect.objectContaining({
          sessionUpdate: "available_commands_update",
          availableCommands: expect.arrayContaining([expect.objectContaining({ name: "mcp" })]),
        }),
      }),
    }));
    expect(result.messages).toContainEqual(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        sessionId: "zed_stale_session",
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "echo:hello" },
        }),
      }),
    }));
  });

  test("rejects load and resume when session loading is not advertised", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({ jsonrpc: "2.0", id: "load", method: "session/load", params: { sessionId: "missing" } })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: "resume", method: "session/resume", params: { sessionId: "missing" } })}\n`,
      ],
      { features: { ...ACP_LIFECYCLE_FEATURES, loadSession: false } },
    );

    expect(result.messages[0]).toMatchObject({
      id: "load",
      error: { code: -32601, message: "Method not found: session/load" },
    });
    expect(result.messages[1]).toMatchObject({
      id: "resume",
      error: { code: -32601, message: "Method not found: session/resume" },
    });
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
          sessionUpdate: "agent_message_chunk",
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

  test("streams assistant deltas as separate ACP session updates before the prompt result", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      { state: { assistantDeltas: ["hel", "lo"] } },
    );

    expect(result.messages.slice(0, 2)).toEqual([
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session_1",
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "msg_1",
            content: { type: "text", text: "hel" },
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session_1",
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "msg_1",
            content: { type: "text", text: "lo" },
          },
        },
      },
    ]);
    expect(result.messages[2]).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "end_turn" },
    });
  });

  test("maps runtime failures to ACP-valid stop reasons", async () => {
    const activeError = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      { state: { turnErrorType: "api_error" } },
    );
    const cancelled = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      { state: { turnErrorType: "cancelled" } },
    );

    expect(activeError.messages.at(-2)).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "SOBA runtime error: mock turn error" },
          _meta: { status: "api_error" },
        },
      },
    });
    expect(activeError.messages.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "end_turn" },
    });
    expect(cancelled.messages.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "cancelled" },
    });
  });

  test("maps ACP prompt content blocks and command input to runtime turns", async () => {
    const state: MockRuntimeState = {};
    await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: {
            sessionId: "session_1",
            prompt: [
              { type: "text", text: "hello" },
              { type: "resource", resource: { uri: "file:///repo/a.ts", text: "const a = 1;", mimeType: "text/typescript" } },
              { type: "resource_link", uri: "file:///repo/b.ts", name: "b.ts", mimeType: "text/typescript" },
              { type: "image", mimeType: "image/png", data: "base64-image" },
            ],
            command: { name: "/compact", args: ["now"] },
          },
        })}\n`,
      ],
      { state },
    );

    expect(state.lastTurnInput).toMatchObject({
      sessionId: "session_1",
      source: "acp",
      command: { name: "/compact", args: ["now"] },
      content: [
        { type: "text", text: "hello" },
        { type: "resource", uri: "file:///repo/a.ts", text: "const a = 1;", mimeType: "text/typescript" },
        { type: "resource_link", uri: "file:///repo/b.ts", name: "b.ts", mimeType: "text/typescript" },
        { type: "image", mimeType: "image/png", data: "base64-image" },
      ],
    });
  });

  test("emits structured ACP tool and usage updates", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      { state: { emitToolEvents: true } },
    );

    expect(result.messages[0]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool_1",
          title: "Read src/app.ts",
          kind: "read",
          status: "pending",
          rawInput: { path: "src/app.ts" },
          locations: [{ path: "src/app.ts" }],
          _meta: {
            tool_name: "read",
            soba: {
              toolName: "read",
              kind: "read",
              path: "src/app.ts",
              evidence: {
                source: "tool_lifecycle",
                phase: "start",
                status: "pending",
                path: "src/app.ts",
              },
            },
          },
        },
      },
    });
    expect(result.messages[1]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_1",
          title: "Read src/app.ts",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "file text" } }],
          locations: [{ path: "src/app.ts", line: 3 }],
          _meta: {
            tool_name: "read",
            soba: {
              toolName: "read",
              kind: "read",
              path: "src/app.ts",
              evidence: {
                source: "tool_lifecycle",
                phase: "result",
                status: "completed",
                path: "src/app.ts",
                outputPreview: "file text",
              },
            },
          },
        },
      },
    });
    expect(result.messages[2]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "usage_update",
          used: 20,
          size: 128000,
          _meta: {
            usedTokens: 10,
            effectiveContextTokens: 20,
            percentage: 20,
          },
        },
      },
    });
  });

  test("emits rich ACP bash metadata without overwriting failed results on tool end", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "run tests" }] },
        })}\n`,
      ],
      { state: { emitBashEvents: true } },
    );

    expect(result.messages[0]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool_bash",
          title: "Run: bun test tests/adapters/acp/acp-server.test.ts",
          kind: "execute",
          status: "pending",
          rawInput: { command: "bun test tests/adapters/acp/acp-server.test.ts", timeout: 10 },
          _meta: {
            tool_name: "bash",
            soba: {
              toolName: "bash",
              kind: "execute",
              command: "bun test tests/adapters/acp/acp-server.test.ts",
              evidence: {
                source: "tool_lifecycle",
                phase: "start",
                status: "pending",
                command: "bun test tests/adapters/acp/acp-server.test.ts",
              },
            },
          },
        },
      },
    });
    expect(result.messages[1]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_bash",
          title: "Run: bun test tests/adapters/acp/acp-server.test.ts (exit 1)",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "failing output\n[Exit code: 1]" } }],
          _meta: {
            tool_name: "bash",
            soba: {
              toolName: "bash",
              kind: "execute",
              command: "bun test tests/adapters/acp/acp-server.test.ts",
              exitCode: 1,
              timedOut: false,
              truncated: false,
              evidence: {
                source: "tool_lifecycle",
                phase: "result",
                status: "failed",
                command: "bun test tests/adapters/acp/acp-server.test.ts",
                exitCode: 1,
                outputPreview: "failing output [Exit code: 1]",
              },
            },
          },
        },
      },
    });
    expect(result.messages[2]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_bash",
          _meta: {
            tool_name: "bash",
            soba: {
              durationMs: 123,
            },
          },
        },
      },
    });
    expect((result.messages[2] as { params: { update: Record<string, unknown> } }).params.update.status).toBeUndefined();
  });

  test("emits ACP diff content for edit tool results", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "edit it" }] },
        })}\n`,
      ],
      { state: { emitEditEvents: true } },
    );

    expect(result.messages[1]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_edit",
          content: [
            {
              type: "diff",
              path: "/repo/src/app.ts",
              oldText: "const value = 1;\n",
              newText: "const value = 2;\n",
            },
            { type: "content", content: { type: "text", text: "edited" } },
          ],
        },
      },
    });
  });

  test("emits ACP evidence metadata for final assistant handoff", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "finish" }] },
        })}\n`,
      ],
      {
        state: {
          assistantMessage: [
            "Done.",
            "",
            "**Evidence**",
            "- Status: partially verified",
            "- Changed files: modified src/app.ts (+3/-1)",
            "- Diff: 1 file, +3/-1",
            "- Checks: Tests passed (bun test)",
            "- Risks: Some file mutations are not covered by passing verification evidence.",
            "- Review: Rejected file change: src/generated.ts",
          ].join("\n"),
        },
      },
    );

    expect(result.messages[0]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_1",
          content: {
            type: "text",
            text: expect.stringContaining("**Evidence**"),
          },
          _meta: {
            soba: {
              evidence: {
                source: "assistant_handoff",
                status: "partially verified",
                changedFiles: ["modified src/app.ts (+3/-1)"],
                diff: "1 file, +3/-1",
                checks: ["Tests passed (bun test)"],
                risks: ["Some file mutations are not covered by passing verification evidence."],
                reviewActions: ["Rejected file change: src/generated.ts"],
              },
            },
          },
        },
      },
    });
  });

  test("maps dangerous confirmations to ACP permission requests", async () => {
    const state: MockRuntimeState = { emitPermission: true };
    const requests: Array<{ method: string; params: JsonValue }> = [];

    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
      ],
      {
        state,
        requestClient: (method, params) => {
          requests.push({ method, params });
          return { decision: "repo" };
        },
      },
    );

    expect(state.permissionDecision).toBe("repo");
    expect(requests[0]).toMatchObject({
      method: "session/request_permission",
      params: {
        sessionId: "session_1",
        toolCall: {
          toolCallId: "tool_danger",
          title: "Run: rm -rf dist",
          kind: "execute",
          status: "pending",
          rawInput: {
            command: "rm -rf dist",
            description: "rm -rf dist",
            reason: "Deletes files",
            level: "dangerous",
          },
          _meta: {
            tool_name: "bash",
            soba: {
              toolName: "bash",
              kind: "execute",
              command: "rm -rf dist",
            },
          },
        },
      },
    });
    expect((requests[0].params as { options: Array<{ optionId: string }> }).options.map((option) => option.optionId)).toEqual([
      "deny",
      "once",
      "session",
      "repo",
      "full",
    ]);
    expect(result.messages.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "end_turn" },
    });
  });

  test("correlates stdio client responses for outbound permission requests", async () => {
    const state: MockRuntimeState = { emitPermission: true };
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: "client_1", result: { decision: "once" } })}\n`,
      ],
      { state },
    );

    expect(state.permissionDecision).toBe("once");
    expect(result.messages[1]).toMatchObject({
      jsonrpc: "2.0",
      id: "client_1",
      method: "session/request_permission",
    });
    expect(result.messages.at(-1)).toEqual({
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
        params: { sessionId: "session_1", configId: "model", value: "test-model" },
      })}\n`,
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "session/set_mode",
        params: { sessionId: "session_1", modeId: "planning" },
      })}\n`,
    ]);

    expect(result.messages.map((message) => message.id).filter((id) => id !== undefined)).toEqual([1, 2, 3, 4, 5]);
    expect(result.messages[0]).toMatchObject({ result: { cancelled: true } });
    expect(result.messages[1]).toMatchObject({ result: {} });
    expect(result.messages[2]).toMatchObject({ result: {} });
    expect(result.messages[3]).toMatchObject({ result: { configOptions: [] } });
    expect(result.messages[4]).toMatchObject({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: "planning",
        },
      },
    });
    expect(result.messages[5]).toMatchObject({ id: 5, result: {} });
  });

  test("handles session/cancel notifications while a prompt request is pending", async () => {
    const result = await runLines(
      [
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "prompt",
          method: "session/prompt",
          params: { sessionId: "session_1", prompt: [{ type: "text", text: "hello" }] },
        })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "session_1" } })}\n`,
      ],
      { state: { waitForCancel: true } },
    );

    expect(result.messages.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "prompt",
      result: { stopReason: "cancelled" },
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
