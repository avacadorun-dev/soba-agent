import { randomUUID } from "node:crypto";
import type { FunctionCallField } from "../client/types";
import type { AgentEvent, ApprovalDecision } from "../loop/types";
import { createToolErrorResult } from "../tools/errors";
import type { ToolRegistry } from "../tools/tool-registry";
import type { ToolContext, ToolResult } from "../tools/types";
import type { TrustManager } from "../trust/trust-manager";

export interface ToolCallExecutorOptions {
  registry: ToolRegistry;
  trustManager: TrustManager;
  toolContext: () => ToolContext;
  emit: (event: AgentEvent) => void;
  requestConfirmation: (
    toolName: string,
    toolCallId: string,
    description: string,
    reason: string,
  ) => Promise<ApprovalDecision>;
}

export interface ToolExecutionResult {
  toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">;
  parsedArgs: Record<string, unknown>;
  result: ToolResult;
  startTime: number;
  denied?: {
    description: string;
    reason: string;
  };
}

export class ToolCallExecutor {
  private readonly registry: ToolRegistry;
  private readonly trustManager: TrustManager;
  private readonly toolContext: () => ToolContext;
  private readonly emit: (event: AgentEvent) => void;
  private readonly requestConfirmation: ToolCallExecutorOptions["requestConfirmation"];
  private activeToolAbortController: AbortController | null = null;
  private directShellAbortController: AbortController | null = null;

  constructor(options: ToolCallExecutorOptions) {
    this.registry = options.registry;
    this.trustManager = options.trustManager;
    this.toolContext = options.toolContext;
    this.emit = options.emit;
    this.requestConfirmation = options.requestConfirmation;
  }

  abortActiveTool(): boolean {
    if (this.directShellAbortController && !this.directShellAbortController.signal.aborted) {
      this.directShellAbortController.abort();
      return true;
    }
    if (!this.activeToolAbortController || this.activeToolAbortController.signal.aborted) {
      return false;
    }
    this.activeToolAbortController.abort();
    return true;
  }

  hasActiveTool(): boolean {
    return (
      (this.directShellAbortController !== null && !this.directShellAbortController.signal.aborted) ||
      (this.activeToolAbortController !== null && !this.activeToolAbortController.signal.aborted)
    );
  }

  clearActiveTool(): void {
    this.activeToolAbortController = null;
  }

  async executeToolCall(toolCall: FunctionCallField, turnSignal?: AbortSignal): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const parsedArgs = safeParseArgs(toolCall.arguments);

    this.emit({
      type: "tool_call_start",
      timestamp: startTime,
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      args: parsedArgs,
    });

    const trustResult = await this.evaluateTrust(toolCall, parsedArgs);
    if (trustResult.denied) {
      const result = createToolErrorResult({
        code: "trust_confirmation_denied",
        category: "trust",
        message: `Denied: ${trustResult.reason}. The operation was cancelled by the user. Do NOT attempt alternative approaches — the user has decided this operation should not be performed.`,
        nextAction: "Stop or ask the user for explicit confirmation if this exact operation is still required.",
        fingerprint: `trust:confirmation_denied:${toolCall.name}`,
      });
      this.emitToolResultAndEnd(toolCall, result, startTime);
      return {
        toolCall,
        parsedArgs,
        result,
        startTime,
        denied: {
          description: trustResult.description,
          reason: trustResult.reason,
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
      return { toolCall, parsedArgs, result, startTime };
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
      return { toolCall, parsedArgs, result, startTime };
    }

    let result: ToolResult;
    try {
      result = await this.executeRegisteredTool(tool, preparedArgs, turnSignal);
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
    return { toolCall, parsedArgs, result, startTime };
  }

  async runDirectShellCommand(command: string, silent = false): Promise<ToolResult> {
    if (this.directShellAbortController) {
      throw new Error("A direct shell command is already running");
    }
    const tool = this.registry.get("bash");
    if (!tool) {
      throw new Error('Tool "bash" is not registered');
    }

    const toolCall = { call_id: `user_shell_${randomUUID()}`, name: "bash" };
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

  private async evaluateTrust(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
  ): Promise<{ denied: false } | { denied: true; description: string; reason: string }> {
    const trustCheck =
      toolCall.name === "bash" && typeof parsedArgs.command === "string"
        ? this.trustManager.checkCommand(parsedArgs.command)
        : this.trustManager.checkTool(toolCall.name);

    if (!trustCheck.needsConfirmation) {
      return { denied: false };
    }

    const description =
      toolCall.name === "bash" && typeof parsedArgs.command === "string"
        ? `bash: ${parsedArgs.command}`
        : `${toolCall.name}(${toolCall.arguments.slice(0, 200)})`;

    const decision = await this.requestConfirmation(
      toolCall.name,
      toolCall.call_id,
      description,
      trustCheck.reason,
    );

    if (decision === "session") {
      const approvalKind = toolCall.name === "bash" ? "command" : "tool";
      const approvalValue =
        toolCall.name === "bash" && typeof parsedArgs.command === "string"
          ? parsedArgs.command
          : toolCall.name;
      this.trustManager.approveForSession(approvalKind, approvalValue);
    } else if (decision === "repo" || decision === "full") {
      this.trustManager.setPermissionMode(decision);
    }

    if (decision === "deny") {
      return {
        denied: true,
        description,
        reason: trustCheck.reason,
      };
    }

    return { denied: false };
  }

  private async executeRegisteredTool(
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    args: Record<string, unknown>,
    turnSignal?: AbortSignal,
  ): Promise<ToolResult> {
    const toolAbortController = new AbortController();
    this.activeToolAbortController = toolAbortController;
    const abortToolWithTurn = () => toolAbortController.abort();
    if (turnSignal?.aborted) {
      toolAbortController.abort();
    } else {
      turnSignal?.addEventListener("abort", abortToolWithTurn, { once: true });
    }
    try {
      return await tool.execute(args, this.toolContext(), toolAbortController.signal);
    } finally {
      turnSignal?.removeEventListener("abort", abortToolWithTurn);
      if (this.activeToolAbortController === toolAbortController) {
        this.activeToolAbortController = null;
      }
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
}

function safeParseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
