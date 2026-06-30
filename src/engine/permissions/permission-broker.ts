import type { FunctionCallField } from "../../kernel/model/openresponses-types";
import type { PermissionAlternative } from "../../kernel/permissions/trust";
import { redactSecrets } from "../../kernel/tools/errors";
import type { ApprovalDecision, DangerousConfirmationEvent } from "../turn/types";
import type { TrustCheckResult, TrustController } from "./trust-controller";

const SECRET_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)/i;

export interface PermissionRequest {
  toolName: string;
  toolCallId: string;
  description: string;
  reason: string;
  level: "safe" | "normal" | "dangerous";
  trustLevel: "safe" | "normal" | "dangerous";
  approvalKind: "command" | "tool";
  approvalValue: string;
  alternatives?: PermissionAlternative[];
}

export type PermissionRequestAdapter = (request: PermissionRequest) => Promise<ApprovalDecision>;

export interface PermissionBrokerOptions {
  trustManager: TrustController;
  requestPermission?: PermissionRequestAdapter;
}

export type PermissionDecision =
  | { approved: true; decision: "auto" | Exclude<ApprovalDecision, "deny">; receipt: PermissionDecisionReceipt }
  | { approved: false; decision: "deny"; description: string; reason: string; receipt: PermissionDecisionReceipt };

export interface PermissionDecisionReceipt {
  toolCallId: string;
  toolName: string;
  decision: "auto" | ApprovalDecision;
  approved: boolean;
  trustLevel: "safe" | "normal" | "dangerous";
  approvalKind: "command" | "tool";
  approvalValue: string;
  description: string;
  reason: string;
  alternatives?: PermissionAlternative[];
}

export interface DangerousConfirmationAdapterOptions {
  hasListeners: () => boolean;
  dispatch: (event: DangerousConfirmationEvent) => void;
}

export class PermissionBroker {
  private readonly trustManager: TrustController;
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

    const request = this.buildRequest(toolCall, parsedArgs, trustCheck);
    if (!trustCheck.needsConfirmation) {
      return {
        approved: true,
        decision: "auto",
        receipt: this.receipt(request, "auto", true),
      };
    }

    const decision = this.requestPermission ? await this.requestPermission(request) : "deny";
    this.applyDecision(decision, request);

    if (decision === "deny") {
      return {
        approved: false,
        decision,
        description: request.description,
        reason: request.reason,
        receipt: this.receipt(request, decision, false),
      };
    }

    return { approved: true, decision, receipt: this.receipt(request, decision, true) };
  }

  private buildRequest(
    toolCall: Pick<FunctionCallField, "call_id" | "name" | "arguments">,
    parsedArgs: Record<string, unknown>,
    trustCheck: TrustCheckResult,
  ): PermissionRequest {
    const command = typeof parsedArgs.command === "string" ? parsedArgs.command : undefined;
    const isBashCommand = toolCall.name === "bash" && command !== undefined;
    const description = isBashCommand
      ? `bash: ${command}`
      : `${toolCall.name}(${formatPermissionArguments(parsedArgs)})`;

    return {
      toolName: toolCall.name,
      toolCallId: toolCall.call_id,
      description,
      reason: trustCheck.reason,
      level: trustCheck.level,
      approvalKind: isBashCommand ? "command" : "tool",
      approvalValue: isBashCommand ? command : toolCall.name,
      trustLevel: trustCheck.level,
      alternatives: isBashCommand && trustCheck.level === "dangerous" ? permissionAlternativesForCommand(command) : undefined,
    };
  }

  private receipt(
    request: PermissionRequest,
    decision: PermissionDecisionReceipt["decision"],
    approved: boolean,
  ): PermissionDecisionReceipt {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      decision,
      approved,
      trustLevel: request.trustLevel,
      approvalKind: request.approvalKind,
      approvalValue: request.approvalValue,
      description: request.description,
      reason: request.reason,
      alternatives: request.alternatives,
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

function formatPermissionArguments(args: Record<string, unknown>): string {
  return truncate(redactSecrets(JSON.stringify(redactPermissionValue(args, 0))), 200);
}

function redactPermissionValue(value: unknown, depth: number): unknown {
  if (depth > 8) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactPermissionValue(item, depth + 1));
  if (typeof value === "string") return redactSecrets(value);
  if (!isRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactPermissionValue(field, depth + 1);
  }
  return redacted;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
        level: "dangerous",
        reason: request.reason,
        alternatives: request.alternatives,
        resolve,
      });
    });
  };
}

function permissionAlternativesForCommand(command: string): PermissionAlternative[] {
  const alternatives: PermissionAlternative[] = [];
  alternatives.push(...destructiveSplitAlternatives(command));
  alternatives.push(...gitPushAlternatives(command));

  if (alternatives.length === 0) {
    alternatives.push({
      id: "manual_user_run",
      title: "Show command for manual execution",
      reason: "Avoid granting runtime permission; let the user run the command outside SOBA.",
      command,
    });
  }

  return dedupeAlternatives(alternatives).slice(0, 4);
}

function destructiveSplitAlternatives(command: string): PermissionAlternative[] {
  const split = splitFirstShellAnd(command);
  if (!split) return [];

  const deleteTarget = relativeRmRfTarget(split.first);
  if (!deleteTarget) return [];

  return [
    {
      id: "scoped_repo_cleanup",
      title: "Split into scoped repo cleanup",
      reason: "Approve deleting only the repo-local target separately before running the remaining command.",
      command: `rm -rf -- ${deleteTarget}`,
    },
    {
      id: "run_without_delete",
      title: "Run the non-destructive part only",
      reason: "Try the requested follow-up command without deleting files first.",
      command: split.rest,
    },
  ];
}

function gitPushAlternatives(command: string): PermissionAlternative[] {
  const trimmed = command.trim();
  if (!/^git\s+push(?:\s|$)/.test(trimmed)) return [];

  return [
    {
      id: "local_commit_only",
      title: "Create local commit only",
      reason: "Keep all changes local and leave the remote mutation to the user.",
      command: "git status && git log --oneline -1",
    },
    {
      id: "show_push_command",
      title: "Show push command for manual execution",
      reason: "Avoid granting SOBA permission to mutate the remote repository.",
      command: trimmed,
    },
  ];
}

function splitFirstShellAnd(command: string): { first: string; rest: string } | null {
  const index = command.indexOf("&&");
  if (index === -1) return null;
  const first = command.slice(0, index).trim();
  const rest = command.slice(index + 2).trim();
  return first && rest ? { first, rest } : null;
}

function relativeRmRfTarget(command: string): string | null {
  const match = command.match(/^rm\s+(?<flags>(?:-[A-Za-z]+\s+)+)(?:--\s+)?(?<target>[^\s;&|]+)$/);
  const flags = match?.groups?.flags?.replace(/-/g, "") ?? "";
  const target = match?.groups?.target;
  if (!flags.includes("r") || !flags.includes("f")) return null;
  if (!target || !isSafeRelativeDeleteTarget(target)) return null;
  return target.startsWith("./") ? target : `./${target}`;
}

function isSafeRelativeDeleteTarget(target: string): boolean {
  if (target.startsWith("/") || target.startsWith("~") || target.startsWith("$")) return false;
  if (target.includes("..")) return false;
  if (target === "." || target === "*" || target.includes("*")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(target);
}

function dedupeAlternatives(alternatives: PermissionAlternative[]): PermissionAlternative[] {
  const seen = new Set<string>();
  const deduped: PermissionAlternative[] = [];
  for (const alternative of alternatives) {
    const key = `${alternative.id}\0${alternative.command ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(alternative);
  }
  return deduped;
}
