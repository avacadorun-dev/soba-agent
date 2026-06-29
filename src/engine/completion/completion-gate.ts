import type { FunctionCallField } from "../../kernel/model/openresponses-types";
import type { AgentTurnError } from "../turn/types";
import {
  decideVerificationPolicy,
  type TaskKind,
  type VerificationKind,
} from "../verification/verification-policy";

export interface FinishRequest {
  summary: string;
  status: "completed" | "blocked" | "completed_with_unverified_changes";
  criteria: FinishCriterion[];
  acknowledgedErrorIds: string[];
}

export interface FinishCriterion {
  criterion: string;
  evidenceIds?: string[];
}

export interface CompletionState {
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  inspectionEvidenceCallIds?: Set<string>;
  verificationKinds?: Set<VerificationKind>;
  needsVerification: boolean;
  hasUsedTools: boolean;
  hasMutatedFiles: boolean;
  hasCodeMutations?: boolean;
  hasDocsMutations?: boolean;
  unverifiedMutationIds?: string[];
  unverifiedCodeMutationIds?: string[];
  unverifiedDocsMutationIds?: string[];
  unresolvedVerificationFailureIds?: string[];
  taskKind?: TaskKind;
  evidenceIds?: Set<string>;
  allowUnverifiedCompletion?: boolean;
}

export type CompletionDecision = { accepted: true; request: FinishRequest } | { accepted: false; reasons: string[] };

/**
 * Diagnose what's wrong with finish tool arguments.
 * Returns a list of specific issues so the model can fix them.
 */
export function diagnoseFinishArguments(toolCall: FunctionCallField): string[] {
  const issues: string[] = [];
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  } catch {
    return ["Arguments are not valid JSON. Provide a JSON object with summary, status, and criteria fields."];
  }

  if (typeof args.summary !== "string" || args.summary.trim().length === 0) {
    issues.push("summary is missing or empty. Provide a non-empty string with your final user-facing response.");
  }
  if (
    args.status !== "completed" &&
    args.status !== "blocked" &&
    args.status !== "completed_with_unverified_changes"
  ) {
    issues.push(
      `status must be "completed", "blocked", or "completed_with_unverified_changes", got: ${JSON.stringify(args.status)}.`,
    );
  }
  // criteria is required for successful statuses, optional for "blocked"
  if (args.status === "completed" || args.status === "completed_with_unverified_changes") {
    const criteriaDiagnosis = diagnoseCriteria(args.criteria);
    if (criteriaDiagnosis) issues.push(criteriaDiagnosis);
  }

  return issues;
}

function diagnoseCriteria(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "criteria is missing. Provide an array of objects like [{ criterion: 'description' }].";
  }
  if (!Array.isArray(value)) {
    return `criteria must be an array, got: ${typeof value}.`;
  }
  if (value.length === 0) {
    return "criteria array is empty. For completed tasks, provide at least one concrete completion criterion.";
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "object" || item === null) {
      return `criteria[${i}] must be an object with a 'criterion' string field.`;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.criterion !== "string" || record.criterion.trim().length === 0) {
      return `criteria[${i}].criterion must be a non-empty string.`;
    }
    if (record.evidenceIds !== undefined && !isStringArray(record.evidenceIds)) {
      return `criteria[${i}].evidenceIds must be an array of strings when provided.`;
    }
  }
  return null;
}

export function parseFinishRequest(toolCall: FunctionCallField): FinishRequest | null {
  try {
    const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    if (typeof args.summary !== "string" || args.summary.trim().length === 0) return null;
    if (
      args.status !== "completed" &&
      args.status !== "blocked" &&
      args.status !== "completed_with_unverified_changes"
    ) {
      return null;
    }

    if (args.status === "completed" || args.status === "completed_with_unverified_changes") {
      const criteria = readSuccessfulCriteria(args.criteria, args.summary);
      if (!criteria) return null;
      return {
        summary: args.summary,
        status: args.status,
        criteria,
        acknowledgedErrorIds: readStringArray(args.acknowledged_error_ids),
      };
    }

    return {
      summary: args.summary,
      status: args.status,
      criteria: readCriteria(args.criteria) ?? [],
      acknowledgedErrorIds: readStringArray(args.acknowledged_error_ids),
    };
  } catch {
    return null;
  }
}

export function evaluateCompletion(request: FinishRequest, state: CompletionState): CompletionDecision {
  const reasons: string[] = [];
  const policy = decideVerificationPolicy(state.taskKind ?? "unknown");
  const activeErrors = state.errors.filter((error) => error.status === "active");
  const activeErrorIds = new Set(activeErrors.map((error) => error.id));
  const unknownAcknowledgements = request.acknowledgedErrorIds.filter((id) => !activeErrorIds.has(id));
  const unknownEvidenceIds = unknownCriterionEvidenceIds(request, state.evidenceIds);
  const unacknowledgedErrors = activeErrors.filter((error) => !request.acknowledgedErrorIds.includes(error.id));
  const verificationKinds = state.verificationKinds ?? new Set<VerificationKind>();
  const acceptedCommandKinds = policy.acceptedKinds.filter(
    (kind) => kind !== "diff_inspection" && kind !== "manual_inspection",
  );
  const acceptedInspectionKinds = policy.acceptedKinds.filter(
    (kind) => kind === "diff_inspection" || kind === "manual_inspection",
  );
  const hasAcceptedCommandEvidence = acceptedCommandKinds.some((kind) => verificationKinds.has(kind));
  const hasAcceptedInspectionEvidence = acceptedInspectionKinds.some((kind) => verificationKinds.has(kind)) ||
    (state.inspectionEvidenceCallIds?.size ?? 0) > 0;
  const unverifiedCodeMutationIds = state.unverifiedCodeMutationIds ?? (state.needsVerification ? [] : []);
  const unverifiedDocsMutationIds = state.unverifiedDocsMutationIds ?? [];
  const hasCodeMutations = state.hasCodeMutations ?? state.hasMutatedFiles;

  if (request.status === "completed") {
    appendVerificationReasons({
      reasons,
      policy,
      state,
      hasAcceptedCommandEvidence,
      hasAcceptedInspectionEvidence,
      hasCodeMutations,
      unverifiedCodeMutationIds,
      unverifiedDocsMutationIds,
    });
  }
  if (request.status === "completed_with_unverified_changes" && !state.allowUnverifiedCompletion) {
    reasons.push(
      "status completed_with_unverified_changes is allowed only when the user explicitly permits unverified completion or verification is impossible.",
    );
  }
  if (
    state.hasUsedTools &&
    request.status !== "blocked" &&
    state.successfulToolCallIds.size === 0
  ) {
    reasons.push("A completed outcome requires at least one successful tool call.");
  }
  if (request.status !== "blocked" && request.criteria.length === 0) {
    reasons.push("A completed outcome requires at least one concrete completion criterion.");
  }
  if (unknownAcknowledgements.length > 0) {
    reasons.push("Finish contains internal error acknowledgements that do not match active tool errors.");
  }
  if (unknownEvidenceIds.length > 0) {
    reasons.push(
      `criteria[].evidenceIds contains IDs that do not match recorded evidence: ${unknownEvidenceIds.join(", ")}. Omit evidenceIds unless you have exact public evidence IDs.`,
    );
  }
  if (unacknowledgedErrors.length > 0 && request.status !== "blocked") {
    const formatted = unacknowledgedErrors.map(formatError).join("; ");
    reasons.push(
      `Fix active tool errors with additional tool calls before finishing, or use status blocked with a concrete blocker if they are unfixable: ${formatted}`,
    );
  }
  if (request.status === "completed" && (state.unresolvedVerificationFailureIds?.length ?? 0) > 0) {
    reasons.push(
      "A completed outcome cannot include unresolved failed verification checks. Re-run the failing check successfully or use blocked only for a concrete external blocker.",
    );
  }

  return reasons.length === 0 ? { accepted: true, request } : { accepted: false, reasons };
}

function unknownCriterionEvidenceIds(request: FinishRequest, knownIds: Set<string> | undefined): string[] {
  if (!knownIds) return [];
  return [
    ...new Set(
      request.criteria.flatMap((criterion) =>
        (criterion.evidenceIds ?? []).filter((evidenceId) => !knownIds.has(evidenceId)),
      ),
    ),
  ];
}

function appendVerificationReasons(input: {
  reasons: string[];
  policy: ReturnType<typeof decideVerificationPolicy>;
  state: CompletionState;
  hasAcceptedCommandEvidence: boolean;
  hasAcceptedInspectionEvidence: boolean;
  hasCodeMutations: boolean;
  unverifiedCodeMutationIds: string[];
  unverifiedDocsMutationIds: string[];
}): void {
  const {
    reasons,
    policy,
    state,
    hasAcceptedCommandEvidence,
    hasAcceptedInspectionEvidence,
    hasCodeMutations,
    unverifiedCodeMutationIds,
    unverifiedDocsMutationIds,
  } = input;
  if (!state.hasMutatedFiles) return;

  if (hasCodeMutations && (unverifiedCodeMutationIds.length > 0 || state.verificationEvidenceCallIds.size === 0)) {
    if (state.needsVerification) {
      reasons.push("Project files changed after the latest successful verification.");
    }
    if (state.verificationEvidenceCallIds.size === 0) {
      reasons.push(
        "A completed outcome after file changes requires evidence from a verification call after the latest change.",
      );
    }
    reasons.push(
      `Code files changed without accepted command verification. Next allowed action: run one of ${formatCommands(policy.commands)}.`,
    );
    return;
  }

  if (policy.requirement === "none") return;

  if (policy.requirement === "inspection") {
    if (!hasAcceptedInspectionEvidence && unverifiedDocsMutationIds.length > 0) {
      reasons.push(
        `Docs-only changes need inspection evidence before completed finish. Next allowed action: read the edited docs or inspect git diff.`,
      );
    }
    return;
  }

  if (!hasAcceptedCommandEvidence || state.verificationEvidenceCallIds.size === 0 || state.needsVerification) {
    reasons.push(
      `Completed ${policy.requirement} task requires passing command evidence after the latest mutation. Next allowed action: run one of ${formatCommands(policy.commands)}.`,
    );
  }
}

function formatCommands(commands: string[]): string {
  if (commands.length === 0) return "the project verification commands";
  return commands.map((command) => `"${command}"`).join(", ");
}

export function recordToolOutcome(
  errors: AgentTurnError[],
  successfulToolCallIds: Set<string>,
  toolCall: { call_id: string; name: string; arguments: string },
  isError: boolean,
  message: string,
  iteration: number,
  errorType?: AgentTurnError["type"],
): void {
  const operationKey = createOperationKey(toolCall.name, toolCall.arguments);

  if (isError) {
    errors.push({
      id: toolCall.call_id,
      type: errorType ?? "tool_error",
      status: errorType === "security_denial" ? "acknowledged" : "active",
      message,
      toolName: toolCall.name,
      toolCallId: toolCall.call_id,
      operationKey,
      iteration,
    });
    return;
  }

  successfulToolCallIds.add(toolCall.call_id);

  // 1. Exact retry: same operationKey → resolved.
  for (const error of errors) {
    if (error.status === "active" && error.operationKey === operationKey) {
      error.status = "resolved";
      error.resolvedByToolCallId = toolCall.call_id;
    }
  }

  // 2. Forward progress: any successful tool call after a tool_error indicates
  //    the error was not blocking. Auto-resolve all previous active tool_errors
  //    that occurred before this iteration.
  for (const error of errors) {
    if (
      error.status === "active" &&
      error.type === "tool_error" &&
      error.iteration !== undefined &&
      error.iteration < iteration
    ) {
      error.status = "resolved";
      error.resolvedByToolCallId = toolCall.call_id;
    }
  }
}

export function acknowledgeErrors(errors: AgentTurnError[], errorIds: string[]): void {
  const ids = new Set(errorIds);
  for (const error of errors) {
    if (error.status === "active" && ids.has(error.id)) {
      error.status = "acknowledged";
    }
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readCriteria(value: unknown): FinishCriterion[] | null {
  if (!Array.isArray(value)) return null;
  const criteria: FinishCriterion[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.criterion !== "string" || record.criterion.trim().length === 0) return null;
    if (record.evidenceIds !== undefined && !isStringArray(record.evidenceIds)) return null;
    criteria.push({ criterion: record.criterion, evidenceIds: readStringArray(record.evidenceIds) });
  }
  return criteria;
}

function readSuccessfulCriteria(value: unknown, summary: string): FinishCriterion[] | null {
  const criteria = readCriteria(value);
  if (criteria) return criteria;
  if (value !== undefined && value !== null) return null;
  return [{ criterion: criterionFromSummary(summary) }];
}

function criterionFromSummary(summary: string): string {
  const firstUsefulLine = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const text = firstUsefulLine ?? summary.trim();
  if (text.length <= 220) return text;
  return `${text.slice(0, 217).trimEnd()}...`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function createOperationKey(toolName: string, args: string): string {
  return `${toolName}:${normalize(args)}`;
}

function normalize(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replaceAll(/\s+/g, " ").trim();
  }
}

function formatError(error: AgentTurnError): string {
  return `${error.id} (${error.toolName ?? error.type}: ${error.message.slice(0, 160)})`;
}
