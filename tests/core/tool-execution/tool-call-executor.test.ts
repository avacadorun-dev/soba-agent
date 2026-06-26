import { describe, expect, test } from "bun:test";
import type { FunctionCallField } from "../../../src/core/client/types";
import type { AgentEvent, ApprovalDecision } from "../../../src/core/loop/types";
import { ToolCallExecutor } from "../../../src/core/tool-execution/tool-call-executor";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";
import type { ToolDefinition } from "../../../src/core/tools/types";
import { TrustManager } from "../../../src/core/trust/trust-manager";

function toolCall(name: string, args: string): FunctionCallField {
  return {
    type: "function_call",
    id: `fc_${name}`,
    call_id: `call_${name}`,
    name,
    arguments: args,
    status: "completed",
  };
}

function makeTool(
  name: string,
  execute: ToolDefinition["execute"] = async () => ({
    content: [{ type: "text", text: "ok" }],
    isError: false,
  }),
): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    toolType: "function",
    execute,
  };
}

function makeExecutor(input: {
  registry: ToolRegistry;
  trustManager?: TrustManager;
  events?: AgentEvent[];
  confirmation?: () => ApprovalDecision | Promise<ApprovalDecision>;
}): ToolCallExecutor {
  return new ToolCallExecutor({
    registry: input.registry,
    trustManager: input.trustManager ?? new TrustManager({ repoRoot: "/repo" }),
    toolContext: () => ({ cwd: "/repo" }),
    emit: (event) => input.events?.push(event),
    requestConfirmation: async () => input.confirmation?.() ?? "deny",
  });
}

describe("ToolCallExecutor", () => {
  test("returns a validation error when prepareArgs fails", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register({
      ...makeTool("strict", async () => {
        executed = true;
        return { content: [{ type: "text", text: "should not run" }], isError: false };
      }),
      prepareArgs() {
        throw new Error("Invalid arguments");
      },
    });
    const events: AgentEvent[] = [];
    const executor = makeExecutor({ registry, events });

    const result = await executor.executeToolCall(toolCall("strict", '{"input":"bad"}'));

    expect(executed).toBe(false);
    expect(result.result.isError).toBe(true);
    expect(result.result.error?.code).toBe("tool_invalid_arguments");
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);
  });

  test("denies dangerous commands before execution", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("bash", async () => {
      executed = true;
      return { content: [{ type: "text", text: "should not run" }], isError: false };
    }));
    const events: AgentEvent[] = [];
    const executor = makeExecutor({
      registry,
      events,
      confirmation: () => "deny",
    });

    const result = await executor.executeToolCall(toolCall("bash", '{"command":"rm -rf node_modules"}'));

    expect(executed).toBe(false);
    expect(result.denied?.description).toBe("bash: rm -rf node_modules");
    expect(result.result.error?.code).toBe("trust_confirmation_denied");
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);
  });

  test("direct shell exposes active tool state and can be aborted", async () => {
    const registry = new ToolRegistry();
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    registry.register(makeTool("bash", async (_args, _context, signal) => {
      await Promise.race([
        waiting,
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
      ]);
      return {
        content: [{ type: "text", text: signal?.aborted ? "stopped" : "done" }],
        isError: Boolean(signal?.aborted),
      };
    }));
    const events: AgentEvent[] = [];
    const executor = makeExecutor({ registry, events });

    const running = executor.runDirectShellCommand("sleep 10");
    expect(executor.hasActiveTool()).toBe(true);
    expect(executor.abortActiveTool()).toBe(true);
    const result = await running;

    expect(result.isError).toBe(true);
    expect(executor.hasActiveTool()).toBe(false);
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);

    release();
  });
});
