import { describe, expect, test } from "bun:test";
import type { UserTurnInput } from "../../src/application/types";
import { AgentLoopRuntimeAdapter } from "../../src/composition/runtime/agent-loop-runtime-adapter";

describe("AgentLoopRuntimeAdapter rich content", () => {
  test("preserves image runtime blocks when calling AgentLoop", async () => {
    let receivedInput: unknown;
    const loop = {
      runTurn: async (input: unknown) => {
        receivedInput = input;
        return {};
      },
      setSessionManager: () => {},
      abort: () => {},
      onEvent: () => () => {},
    };
    const session = {
      getSessionId: () => "session_1",
      getCwd: () => "/repo",
    };
    const adapter = new AgentLoopRuntimeAdapter(
      loop as never,
      session as never,
      {} as never,
      {
        getActiveProvider: () => ({ id: "openai" }),
      } as never,
    );
    const input: UserTurnInput = {
      sessionId: "session_1",
      source: "tui",
      content: [
        { type: "text", text: "describe" },
        { type: "image", mimeType: "image/png", data: "AQID" },
      ],
    };

    await adapter.runTurn(input);

    expect(receivedInput).toEqual([
      { type: "input_text", text: "describe" },
      { type: "input_image", image_url: "data:image/png;base64,AQID", detail: "auto" },
    ]);
  });

  test("applies supported ACP session modes to the trust manager", async () => {
    let permissionMode = "ask";
    let workMode = "agent";
    const loop = {
      runTurn: async () => ({}),
      setSessionManager: () => {},
      abort: () => {},
      onEvent: () => () => {},
      getTrustManager: () => ({
        setPermissionMode: (mode: string) => {
          permissionMode = mode;
        },
      }),
      setWorkMode: (mode: string) => {
        workMode = mode;
      },
    };
    const session = {
      getSessionId: () => "session_1",
      getCwd: () => "/repo",
    };
    const adapter = new AgentLoopRuntimeAdapter(
      loop as never,
      session as never,
      {} as never,
      {
        getActiveProvider: () => ({ id: "openai" }),
      } as never,
    );

    await adapter.setSessionMode({ sessionId: "session_1", mode: "repo", enabled: true });
    expect(permissionMode).toBe("repo");
    await adapter.setSessionMode({ sessionId: "session_1", mode: "plan", enabled: true });
    expect(workMode).toBe("plan");
    await adapter.setSessionMode({ sessionId: "session_1", mode: "planning", enabled: true });
    expect(workMode).toBe("plan");
    await adapter.setSessionMode({ sessionId: "session_1", mode: "goal", enabled: true });
    expect(workMode).toBe("goal");
    await adapter.setSessionMode({ sessionId: "session_1", mode: "agent", enabled: true });
    expect(workMode).toBe("agent");
    await expect(adapter.setSessionMode({ sessionId: "session_1", mode: "architect", enabled: true }))
      .rejects.toThrow('Unsupported session mode "architect".');
  });
});
