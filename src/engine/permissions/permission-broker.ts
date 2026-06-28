import type { FunctionCallField } from "../../core/client/types";
import type { ApprovalDecision, DangerousConfirmationEvent } from "../../core/loop/types";
import type { TrustManager } from "../../core/trust/trust-manager";

export interface PermissionRequest {
  toolName: string;
  toolCallId: string;
  description: string;
  reason: string;
  level: "dangerous";
  approvalKind: "command" | "tool";
  approvalValue: string;
}

export type PermissionRequestAdapter = (request: PermissionRequest) => Promise<ApprovalDecision>;

export interface PermissionBrokerOptions {
  trustManager: TrustManager;
  requestPermission?: PermissionRequestAdapter;
}

export type PermissionDecision =
  | { approved: true; decision: Exclude<ApprovalDecision, "deny"> }
  | { approved: false; decision: "deny"; description: string; reason: string };

export interface DangerousConfirmationAdapterOptions {
  hasListeners: () => boolean;
  dispatch: (event: DangerousConfirmationEvent) => void;
}

export class PermissionBroker {
  private readonly trustManager: TrustManager;
  private readonly requestPermission?: PermissionRequestAdapter;

  constructor(options: PermissionBrokerOptions) {
    this.trustManager = options.trustManager;
    this.requestPermission = options.requestPermission;
  }

  async authorizeToolCall(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
  ): Promise<PermissionDecision> {
    const trustCheck =
      toolCall.name === "bash" && typeof parsedArgs.command === "string"
        ? this.trustManager.checkCommand(parsedArgs.command)
        : this.trustManager.checkTool(toolCall.name);

    if (!trustCheck.needsConfirmation) {
      return { approved: true, decision: "once" };
    }

    const request = this.buildRequest(toolCall, parsedArgs, trustCheck.reason);
    const decision = this.requestPermission ? await this.requestPermission(request) : "deny";
    this.applyDecision(decision, request);

    if (decision === "deny") {
      return {
        approved: false,
        decision,
        description: request.description,
        reason: request.reason,
      };
    }

    return { approved: true, decision };
  }

  private buildRequest(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
    reason: string,
  ): PermissionRequest {
    const command = typeof parsedArgs.command === "string" ? parsedArgs.command : undefined;
    const isBashCommand = toolCall.name === "bash" && command !== undefined;
    const description = isBashCommand
      ? `bash: ${command}`
      : `${toolCall.name}(${toolCall.arguments.slice(0, 200)})`;

    return {
      toolName: toolCall.name,
      toolCallId: toolCall.call_id,
      description,
      reason,
      level: "dangerous",
      approvalKind: isBashCommand ? "command" : "tool",
      approvalValue: isBashCommand ? command : toolCall.name,
    };
  }

  private applyDecision(decision: ApprovalDecision, request: PermissionRequest): void {
    if (decision === "session") {
      this.trustManager.approveForSession(request.approvalKind, request.approvalValue);
    } else if (decision === "repo" || decision === "full") {
      this.trustManager.setPermissionMode(decision);
    }
  }
}

export function createDangerousConfirmationAdapter(
  options: DangerousConfirmationAdapterOptions,
): PermissionRequestAdapter {
  return async (request) => {
    if (!options.hasListeners()) {
      return "deny";
    }

    return new Promise<ApprovalDecision>((resolve) => {
      options.dispatch({
        type: "dangerous_confirmation",
        timestamp: Date.now(),
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        description: request.description,
        level: request.level,
        reason: request.reason,
        resolve,
      });
    });
  };
}
