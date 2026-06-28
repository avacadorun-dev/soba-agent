import type { EvidenceLedger, EvidenceLedgerSummary } from "../../core/loop/evidence-ledger";
import type { TaskKind, VerificationKind } from "../../core/loop/verification-policy";
import { verificationKindFromCommand } from "../../core/loop/verification-policy";
import type { ToolDefinition, ToolResult } from "../../core/tools/types";
import type { TrustManager } from "../../core/trust/trust-manager";
import { detectProjectCommands } from "./project-command-detector";
import type { ProjectCommand, ProjectCommandKind, SkippedProjectCommand } from "./types";

export interface AutoVerifierToolCall {
  callId: string;
  toolName: "bash";
  args: { command: string; timeout?: number };
  arguments: string;
  command: ProjectCommand;
}

export interface AutoVerifierExecution {
  call: AutoVerifierToolCall;
  result: ToolResult;
  durationMs: number;
}

export interface AutoVerifierResult {
  selected: ProjectCommand[];
  skipped: SkippedProjectCommand[];
  executions: AutoVerifierExecution[];
}

export interface AutoVerifierOptions {
  cwd: string;
  taskKind: TaskKind;
  evidenceSummary: EvidenceLedgerSummary;
  ledger: EvidenceLedger;
  bashTool?: ToolDefinition<Record<string, unknown>>;
  toolContext: Parameters<ToolDefinition<Record<string, unknown>>["execute"]>[1];
  trustManager: TrustManager;
  projectInstructions?: string[];
  includeFullGate?: boolean;
  includeReleaseGate?: boolean;
  timeoutSeconds?: number;
  iteration?: number;
  attemptedFingerprints?: Set<string>;
  signal?: AbortSignal;
  onToolCallStart?: (call: AutoVerifierToolCall) => void;
  onToolCallResult?: (call: AutoVerifierToolCall, result: ToolResult, durationMs: number) => void;
}

const FULL_GATE_KINDS: ProjectCommandKind[] = ["test", "lint", "typecheck", "build", "deadCode"];
const TARGETED_KINDS_BY_TASK: Record<TaskKind, ProjectCommandKind[]> = {
  read_only_question: [],
  docs_change: [],
  review: [],
  test_failure: ["test"],
  lint_failure: ["lint"],
  bug_fix: ["test", "lint", "typecheck"],
  code_change: ["test", "lint", "typecheck"],
  feature: ["test", "lint", "typecheck", "build"],
  refactor: ["test", "lint", "typecheck", "build"],
  release_task: FULL_GATE_KINDS,
  unknown: ["test", "lint", "typecheck"],
};

export async function runAutoVerifier(options: AutoVerifierOptions): Promise<AutoVerifierResult> {
  const skipped: SkippedProjectCommand[] = [];
  const selected: ProjectCommand[] = [];
  const executions: AutoVerifierExecution[] = [];
  const requiredKinds = requiredCommandKinds(options);

  if (requiredKinds.length === 0) {
    const reason = skipReasonForNoRequiredCommands(options);
    const skippedCommand = skip("test", "soba-default", reason);
    skipped.push(skippedCommand);
    options.ledger.recordVerificationCommandSkipped({
      reason,
    });
    return { selected, skipped, executions };
  }

  const detected = await detectProjectCommands({
    cwd: options.cwd,
    projectInstructions: options.projectInstructions,
    includeFullGate: options.includeFullGate || options.taskKind === "release_task",
    includeReleaseGate: options.includeReleaseGate,
  });

  for (const kind of requiredKinds) {
    const command = detected[kind][0];
    if (!command) {
      const detectedSkip = detected.skipped.find((candidate) => candidate.kind === kind);
      const reason = detectedSkip?.reason ?? `No ${kind} command discovered.`;
      const skippedCommand = skip(kind, detectedSkip?.source ?? "package-json", reason, detectedSkip?.command);
      skipped.push(skippedCommand);
      options.ledger.recordVerificationCommandSkipped({
        command: skippedCommand.command,
        reason: skippedCommand.reason,
        verificationKind: verificationKindForCommandKind(kind),
      });
      continue;
    }

    const fingerprint = verificationFingerprint(options.evidenceSummary, command.command);
    if (options.attemptedFingerprints?.has(fingerprint)) {
      const reason = "Identical verification command was already attempted for the current unverified mutation set.";
      const skippedCommand = skip(kind, command.source, reason, command.command);
      skipped.push(skippedCommand);
      options.ledger.recordVerificationCommandSkipped({
        command: command.command,
        reason,
        verificationKind: verificationKindForCommand(command.command),
      });
      continue;
    }

    if (!options.bashTool) {
      const reason = "Bash tool is not registered, so auto-verification cannot execute commands.";
      const skippedCommand = skip(kind, command.source, reason, command.command);
      skipped.push(skippedCommand);
      options.ledger.recordVerificationCommandSkipped({
        command: command.command,
        reason,
        verificationKind: verificationKindForCommand(command.command),
      });
      continue;
    }

    const trustCheck = options.trustManager.checkCommand(command.command);
    if (trustCheck.needsConfirmation) {
      const reason = `Command requires confirmation by trust policy: ${trustCheck.reason}`;
      const skippedCommand = skip(kind, command.source, reason, command.command);
      skipped.push(skippedCommand);
      options.ledger.recordVerificationCommandSkipped({
        command: command.command,
        reason,
        verificationKind: verificationKindForCommand(command.command),
      });
      continue;
    }

    options.attemptedFingerprints?.add(fingerprint);
    selected.push(command);
    options.ledger.recordVerificationCommandSelected({
      command: command.command,
      reason: command.reason,
      verificationKind: verificationKindForCommand(command.command),
    });

    const execution = await executeVerificationCommand(options, command, kind);
    executions.push(execution);
  }

  return { selected, skipped, executions };
}

function requiredCommandKinds(options: AutoVerifierOptions): ProjectCommandKind[] {
  if (!options.evidenceSummary.needsVerification) return [];
  if (options.includeFullGate || options.includeReleaseGate || options.taskKind === "release_task") return FULL_GATE_KINDS;
  if (options.evidenceSummary.hasDocsMutations && !options.evidenceSummary.hasCodeMutations) return [];
  return TARGETED_KINDS_BY_TASK[options.taskKind];
}

function skipReasonForNoRequiredCommands(options: AutoVerifierOptions): string {
  if (!options.evidenceSummary.needsVerification) return "No unverified mutations require auto-verification.";
  if (options.evidenceSummary.hasDocsMutations && !options.evidenceSummary.hasCodeMutations) {
    return "Docs-only mutation does not require the full command gate by default.";
  }
  return "Task kind does not require command auto-verification.";
}

async function executeVerificationCommand(
  options: AutoVerifierOptions,
  command: ProjectCommand,
  kind: ProjectCommandKind,
): Promise<AutoVerifierExecution> {
  const bashTool = options.bashTool;
  if (!bashTool) {
    throw new Error("Bash tool is required to execute auto-verification commands.");
  }

  const args = autoVerifierArgs(command.command, options.timeoutSeconds);
  const call: AutoVerifierToolCall = {
    callId: `auto_verify_${kind}_${crypto.randomUUID().slice(0, 8)}`,
    toolName: "bash",
    args,
    arguments: JSON.stringify(args),
    command,
  };
  const startTime = Date.now();

  options.onToolCallStart?.(call);
  const result = await bashTool.execute(args, options.toolContext, options.signal);
  const durationMs = Date.now() - startTime;
  options.onToolCallResult?.(call, result, durationMs);
  options.ledger.recordToolOutcome({
    toolCallId: call.callId,
    toolName: call.toolName,
    arguments: call.arguments,
    isError: result.isError,
    output: result.content.map((content) => content.text).join("\n"),
    iteration: options.iteration ?? 0,
  });

  return { call, result, durationMs };
}

function autoVerifierArgs(command: string, timeoutSeconds: number | undefined): { command: string; timeout?: number } {
  if (timeoutSeconds === undefined) return { command };
  return { command, timeout: timeoutSeconds };
}

function verificationFingerprint(summary: EvidenceLedgerSummary, command: string): string {
  return `${summary.unverifiedMutationIds.join(",") || "none"}::${command}`;
}

function verificationKindForCommand(command: string): VerificationKind {
  return verificationKindFromCommand(command) ?? "run";
}

function verificationKindForCommandKind(kind: ProjectCommandKind): VerificationKind {
  switch (kind) {
    case "test":
      return "test";
    case "lint":
      return "lint";
    case "typecheck":
      return "typecheck";
    case "build":
      return "build";
    case "deadCode":
      return "run";
  }
}

function skip(
  kind: ProjectCommandKind,
  source: SkippedProjectCommand["source"],
  reason: string,
  command?: string,
): SkippedProjectCommand {
  return { kind, source, reason, command };
}
