import { describe, expect, test } from "bun:test";
import { TrustManager } from "../../../src/application/trust/trust-manager";
import { PermissionBroker } from "../../../src/engine/permissions/permission-broker";
import { ToolCallExecutor } from "../../../src/engine/tool-calls/tool-call-executor";
import type { AgentEvent, ApprovalDecision } from "../../../src/engine/turn/types";
import type { FunctionCallField } from "../../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";
import type { ToolDefinition } from "../../../src/kernel/tools/types";

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
  getWorkMode?: () => "agent" | "plan" | "goal";
  evaluateToolPolicy?: (toolName: string) => { allowed: boolean; reason?: string };
}): ToolCallExecutor {
  const trustManager = input.trustManager ?? new TrustManager({ repoRoot: "/repo" });
  return new ToolCallExecutor({
    registry: input.registry,
    permissionBroker: new PermissionBroker({
      trustManager,
      requestPermission: async () => input.confirmation?.() ?? "deny",
    }),
    toolContext: () => ({ cwd: "/repo" }),
    emit: (event) => input.events?.push(event),
    getWorkMode: input.getWorkMode,
    evaluateToolPolicy: input.evaluateToolPolicy,
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
    expect(result.permission).toMatchObject({
      toolCallId: "call_strict",
      toolName: "strict",
      decision: "auto",
      approved: true,
      trustLevel: "normal",
      approvalKind: "tool",
      approvalValue: "strict",
      description: 'strict({"input":"bad"})',
    });
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);
  });

  test("blocks mutation tools in plan mode before trust checks", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("write", async () => {
      executed = true;
      return { content: [{ type: "text", text: "should not run" }], isError: false };
    }));
    const events: AgentEvent[] = [];
    const executor = makeExecutor({
      registry,
      events,
      getWorkMode: () => "plan",
      confirmation: () => "full",
    });

    const result = await executor.executeToolCall(
      toolCall("write", '{"path":"a.ts","content":"x"}'),
    );

    expect(executed).toBe(false);
    expect(result.result.isError).toBe(true);
    expect(result.result.error?.code).toBe("plan_mode_blocked");
    expect(result.denied?.reason).toContain("Plan mode blocks mutation tool");
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);
  });

  test("enforces active skill tool policy before trust checks", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("write_project_memory", async () => {
      executed = true;
      return { content: [{ type: "text", text: "should not run" }], isError: false };
    }));
    const executor = makeExecutor({
      registry,
      confirmation: () => "full",
      evaluateToolPolicy: () => ({
        allowed: false,
        reason: "Active skill memory policy does not allow writing project memory.",
      }),
    });

    const result = await executor.executeToolCall(toolCall("write_project_memory", '{"target":"capsule"}'));

    expect(executed).toBe(false);
    expect(result.result.error?.code).toBe("skill_policy_blocked");
    expect(result.permission.approved).toBe(false);
    expect(result.denied?.reason).toContain("does not allow writing");
  });

  test("blocks mutation tools in goal mode before trust checks", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("edit", async () => {
      executed = true;
      return { content: [{ type: "text", text: "should not run" }], isError: false };
    }));
    const executor = makeExecutor({
      registry,
      getWorkMode: () => "goal",
      confirmation: () => "full",
    });

    const result = await executor.executeToolCall(
      toolCall("edit", '{"path":"a.ts","oldText":"a","newText":"b"}'),
    );

    expect(executed).toBe(false);
    expect(result.result.isError).toBe(true);
    expect(result.result.error?.code).toBe("plan_mode_blocked");
  });

  test("blocks mutating bash commands in plan mode", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("bash", async () => {
      executed = true;
      return { content: [{ type: "text", text: "should not run" }], isError: false };
    }));
    const executor = makeExecutor({
      registry,
      getWorkMode: () => "plan",
      confirmation: () => "full",
    });

    const result = await executor.executeToolCall(toolCall("bash", '{"command":"rm -rf dist"}'));

    expect(executed).toBe(false);
    expect(result.result.error?.code).toBe("plan_mode_blocked");
    expect(result.denied?.description).toBe("bash: rm -rf dist");
  });

  test("blocks every bash command in plan mode", async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(makeTool("bash", async () => {
      executed = true;
      return { content: [{ type: "text", text: "ok" }], isError: false };
    }));
    const executor = makeExecutor({
      registry,
      getWorkMode: () => "plan",
      confirmation: () => "full",
    });

    const result = await executor.executeToolCall(toolCall("bash", '{"command":"git status --short"}'));

    expect(executed).toBe(false);
    expect(result.result.error?.code).toBe("plan_mode_blocked");
    expect(result.denied?.description).toBe("bash: git status --short");
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
    expect(result.permission).toMatchObject({
      toolCallId: "call_bash",
      toolName: "bash",
      decision: "deny",
      approved: false,
      trustLevel: "dangerous",
      approvalKind: "command",
      approvalValue: "rm -rf node_modules",
      description: "bash: rm -rf node_modules",
    });
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

  test("aborts all concurrently active registered tools", async () => {
    const registry = new ToolRegistry();
    let startedCount = 0;
    let resolveStarted = () => {};
    const bothStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const markStarted = () => {
      startedCount += 1;
      if (startedCount === 2) resolveStarted();
    };
    registry.register(makeTool("read", async (_args, _context, signal) => {
      markStarted();
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        content: [{ type: "text", text: signal?.aborted ? "read stopped" : "read done" }],
        isError: Boolean(signal?.aborted),
      };
    }));
    registry.register(makeTool("inspect_file", async (_args, _context, signal) => {
      markStarted();
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        content: [{ type: "text", text: signal?.aborted ? "inspect stopped" : "inspect done" }],
        isError: Boolean(signal?.aborted),
      };
    }));
    const executor = makeExecutor({ registry });

    const read = executor.executeToolCall(toolCall("read", '{"path":"a.ts"}'));
    const inspect = executor.executeToolCall(toolCall("inspect_file", '{"path":"b.ts"}'));
    await bothStarted;

    expect(executor.hasActiveTool()).toBe(true);
    expect(executor.abortActiveTool()).toBe(true);
    const results = await Promise.all([read, inspect]);

    expect(results.every((result) => result.result.isError)).toBe(true);
    expect(executor.hasActiveTool()).toBe(false);
  });
});
