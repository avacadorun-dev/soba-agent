import type { FunctionCallField } from "../../kernel/model/openresponses-types";
import { createToolErrorResult } from "../../kernel/tools/errors";
import type { ToolSemantics } from "../../kernel/tools/semantics";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolContext, ToolResult } from "../../kernel/tools/types";
import {
  isCommandAllowedInPlanMode,
  isRestrictedWorkMode,
  isToolAllowedInPlanMode,
  type WorkMode,
} from "../../kernel/work-mode/public";
import type { PermissionBroker, PermissionDecisionReceipt } from "../permissions/permission-broker";
import type { AgentEvent } from "../turn/types";

export interface ToolCallExecutorOptions {
  registry: ToolRegistry;
  permissionBroker: PermissionBroker;
  toolContext: () => ToolContext;
  emit: (event: AgentEvent) => void;
  createId?: () => string;
  getWorkMode?: () => WorkMode;
}

export interface ToolExecutionResult {
  toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">;
  parsedArgs: Record<string, unknown>;
  result: ToolResult;
  startTime: number;
  durationMs: number;
  cwd: string;
  permission: PermissionDecisionReceipt;
  semantics: ToolSemantics;
  denied?: {
    description: string;
    reason: string;
  };
}

export class ToolCallExecutor {
  private readonly registry: ToolRegistry;
  private readonly permissionBroker: PermissionBroker;
  private readonly toolContext: () => ToolContext;
  private readonly emit: (event: AgentEvent) => void;
  private readonly createId: () => string;
  private readonly getWorkMode: () => WorkMode;
  private readonly activeToolAbortControllers = new Set<AbortController>();
  private directShellAbortController: AbortController | null = null;

  constructor(options: ToolCallExecutorOptions) {
    this.registry = options.registry;
    this.permissionBroker = options.permissionBroker;
    this.toolContext = options.toolContext;
    this.emit = options.emit;
    this.createId = options.createId ?? createRuntimeId;
    this.getWorkMode = options.getWorkMode ?? (() => "agent");
  }

  abortActiveTool(): boolean {
    if (this.directShellAbortController && !this.directShellAbortController.signal.aborted) {
      this.directShellAbortController.abort();
      return true;
    }
    const activeControllers = [...this.activeToolAbortControllers].filter((controller) => !controller.signal.aborted);
    if (activeControllers.length === 0) {
      return false;
    }
    for (const controller of activeControllers) {
      controller.abort();
    }
    return true;
  }

  hasActiveTool(): boolean {
    return (
      (this.directShellAbortController !== null && !this.directShellAbortController.signal.aborted) ||
      [...this.activeToolAbortControllers].some((controller) => !controller.signal.aborted)
    );
  }

  clearActiveTool(): void {
    this.activeToolAbortControllers.clear();
  }

  getToolSemantics(toolName: string): ToolSemantics {
    return this.registry.getSemantics(toolName);
  }

  async executeToolCall(toolCall: FunctionCallField, turnSignal?: AbortSignal): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const parsedArgs = safeParseArgs(toolCall.arguments);
    const context = this.toolContext();
    const semantics = this.registry.getSemantics(toolCall.name);

    this.emit({
      type: "tool_call_start",
      timestamp: startTime,
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      args: parsedArgs,
    });

    const planModeDenial = this.evaluatePlanModeDenial(toolCall, parsedArgs);
    if (planModeDenial) {
      const result = createToolErrorResult({
        code: "plan_mode_blocked",
        category: "validation",
        message: planModeDenial.reason,
        nextAction: "Stay in plan mode with read-only tools, or ask the user to run /plan off before implementing.",
        fingerprint: `validation:plan_mode_blocked:${toolCall.name}`,
      });
      this.emitToolResultAndEnd(toolCall, result, startTime);
      return {
        toolCall,
        parsedArgs,
        result,
        startTime,
        durationMs: Date.now() - startTime,
        cwd: context.cwd,
        permission: planModeDenial.receipt,
        semantics,
        denied: {
          description: planModeDenial.description,
          reason: planModeDenial.reason,
        },
      };
    }

    const permissionDecision = await this.permissionBroker.authorizeToolCall(toolCall, parsedArgs);
    if (!permissionDecision.approved) {
      const result = createToolErrorResult({
        code: "trust_confirmation_denied",
        category: "trust",
        message: `Denied: ${permissionDecision.reason}. The operation was cancelled by the user. Do NOT attempt alternative approaches — the user has decided this operation should not be performed.`,
        nextAction: "Stop or ask the user for explicit confirmation if this exact operation is still required.",
        fingerprint: `trust:confirmation_denied:${toolCall.name}`,
      });
      this.emitToolResultAndEnd(toolCall, result, startTime);
      return {
        toolCall,
        parsedArgs,
        result,
        startTime,
        durationMs: Date.now() - startTime,
        cwd: context.cwd,
        permission: permissionDecision.receipt,
        semantics,
        denied: {
          description: permissionDecision.description,
          reason: permissionDecision.reason,
        },
      };
    }

    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      const result = createToolErrorResult({
        code: "tool_not_registered",
        category: "validation",
        message: `Tool "${toolCall.name}" is not registered. Available tools: ${this.registry.getNames().join(", ")}`,
        nextAction: "Call one of the registered tools or inspect the available tool list before retrying.",
        fingerprint: `validation:tool_not_registered:${toolCall.name}`,
      });
      this.emitToolResultAndEnd(toolCall, result, startTime);
      return {
        toolCall,
        parsedArgs,
        result,
        startTime,
        durationMs: Date.now() - startTime,
        cwd: context.cwd,
        permission: permissionDecision.receipt,
        semantics,
      };
    }

    let preparedArgs: Record<string, unknown>;
    try {
      preparedArgs = tool.prepareArgs ? tool.prepareArgs(parsedArgs) : parsedArgs;
    } catch (error) {
      const result = createToolErrorResult({
        code: "tool_invalid_arguments",
        category: "validation",
        message: `Error preparing arguments for "${toolCall.name}": ${error instanceof Error ? error.message : String(error)}`,
        nextAction: "Fix the tool arguments to match the schema before retrying.",
        fingerprint: `validation:tool_invalid_arguments:${toolCall.name}`,
      });
      this.emitToolResultAndEnd(toolCall, result, startTime);
      return {
        toolCall,
        parsedArgs,
        result,
        startTime,
        durationMs: Date.now() - startTime,
        cwd: context.cwd,
        permission: permissionDecision.receipt,
        semantics,
      };
    }

    let result: ToolResult;
    try {
      result = await this.executeRegisteredTool(tool, preparedArgs, context, turnSignal);
    } catch (error) {
      result = createToolErrorResult({
        code: "tool_execution_failed",
        category: "unknown",
        message: `Error executing "${toolCall.name}": ${error instanceof Error ? error.message : String(error)}`,
        nextAction: "Inspect the error, change the approach, and avoid retrying the same call unchanged.",
        fingerprint: `unknown:tool_execution_failed:${toolCall.name}`,
      });
    }

    this.emitToolResultAndEnd(toolCall, result, startTime);
    return {
      toolCall,
      parsedArgs,
      result,
      startTime,
      durationMs: Date.now() - startTime,
      cwd: context.cwd,
      permission: permissionDecision.receipt,
      semantics,
    };
  }

  async runDirectShellCommand(command: string, silent = false): Promise<ToolResult> {
    if (this.directShellAbortController) {
      throw new Error("A direct shell command is already running");
    }
    const tool = this.registry.get("bash");
    if (!tool) {
      throw new Error('Tool "bash" is not registered');
    }

    const toolCall = { call_id: `user_shell_${this.createId()}`, name: "bash" };
    const startTime = Date.now();
    const controller = new AbortController();
    this.directShellAbortController = controller;
    this.emit({
      type: "tool_call_start",
      timestamp: startTime,
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      args: { command },
    });

    let result: ToolResult;
    try {
      result = await tool.execute({ command }, this.toolContext(), controller.signal);
    } catch (error) {
      result = {
        content: [{ type: "text", text: `Error executing "bash": ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    } finally {
      if (this.directShellAbortController === controller) {
        this.directShellAbortController = null;
      }
    }

    if (!silent) {
      this.emit({
        type: "tool_call_result",
        timestamp: Date.now(),
        toolCallId: toolCall.call_id,
        toolName: toolCall.name,
        result,
      });
    }
    this.emit({
      type: "tool_call_end",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      durationMs: Date.now() - startTime,
    });
    return result;
  }

  private async executeRegisteredTool(
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    args: Record<string, unknown>,
    context: ToolContext,
    turnSignal?: AbortSignal,
  ): Promise<ToolResult> {
    const toolAbortController = new AbortController();
    this.activeToolAbortControllers.add(toolAbortController);
    const abortToolWithTurn = () => toolAbortController.abort();
    if (turnSignal?.aborted) {
      toolAbortController.abort();
    } else {
      turnSignal?.addEventListener("abort", abortToolWithTurn, { once: true });
    }
    try {
      return await tool.execute(args, context, toolAbortController.signal);
    } finally {
      turnSignal?.removeEventListener("abort", abortToolWithTurn);
      this.activeToolAbortControllers.delete(toolAbortController);
    }
  }

  private emitToolResultAndEnd(
    toolCall: Pick<FunctionCallField, "call_id" | "name">,
    result: ToolResult,
    startTime: number,
  ): void {
    this.emit({
      type: "tool_call_result",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      result,
    });

    this.emit({
      type: "tool_call_end",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      durationMs: Date.now() - startTime,
    });
  }

  private evaluatePlanModeDenial(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
  ): { reason: string; description: string; receipt: PermissionDecisionReceipt } | null {
    if (!isRestrictedWorkMode(this.getWorkMode())) return null;

    const toolDecision = isToolAllowedInPlanMode(toolCall.name, this.registry.getSemantics(toolCall.name));
    if (!toolDecision.allowed) {
      return this.planModeDenialReceipt(toolCall, parsedArgs, toolDecision.reason);
    }

    if (toolCall.name === "bash" && typeof parsedArgs.command === "string") {
      const commandDecision = isCommandAllowedInPlanMode(parsedArgs.command);
      if (!commandDecision.allowed) {
        return this.planModeDenialReceipt(toolCall, parsedArgs, commandDecision.reason);
      }
    }

    return null;
  }

  private planModeDenialReceipt(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
    reason: string,
  ): { reason: string; description: string; receipt: PermissionDecisionReceipt } {
    const command = typeof parsedArgs.command === "string" ? parsedArgs.command : undefined;
    const description =
      toolCall.name === "bash" && command !== undefined ? `bash: ${command}` : toolCall.name;
    return {
      reason,
      description,
      receipt: {
        toolCallId: toolCall.call_id,
        toolName: toolCall.name,
        decision: "deny",
        approved: false,
        trustLevel: "normal",
        approvalKind: toolCall.name === "bash" && command !== undefined ? "command" : "tool",
        approvalValue: command ?? toolCall.name,
        description,
        reason,
      },
    };
  }
}

function safeParseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function createRuntimeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
