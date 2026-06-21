export type ModelProfile = "weak" | "normal";

export type TaskKind =
  | "bug_fix"
  | "lint_fix"
  | "test_recovery"
  | "cli_fix"
  | "docs_roadmap"
  | "docs_change"
  | "unsafe_action";

export type NarrationEventType =
  | "acknowledgement"
  | "context_scan"
  | "observation"
  | "plan"
  | "edit_intent"
  | "verification"
  | "recovery"
  | "blocked"
  | "completion";

export type EvidenceKind =
  | "instructions_read"
  | "memory_hypothesis"
  | "context_read"
  | "mutation"
  | "diagnostic"
  | "verification"
  | "docs_inspection"
  | "recovery_attempt";

export type ToolStatus = "success" | "failure";

export type FinishStatus = "completed" | "blocked";

export type VerificationPolicy = "command_required" | "docs_or_command";

export interface ClassificationTraceEvent {
  type: "classification";
  taskKind: TaskKind;
}

export interface NarrationTraceEvent {
  type: "narration";
  eventType: NarrationEventType;
  message: string;
  evidenceIds?: string[];
}

export interface ToolTraceEvent {
  type: "tool";
  evidenceId: string;
  toolName: string;
  status: ToolStatus;
  evidenceKind: EvidenceKind;
  command?: string;
  mutatesFiles?: boolean;
  batchId?: string;
}

export interface FinishTraceEvent {
  type: "finish";
  status: FinishStatus;
  message: string;
  evidenceIds: string[];
}

export type AgentLoopTraceEvent =
  | ClassificationTraceEvent
  | NarrationTraceEvent
  | ToolTraceEvent
  | FinishTraceEvent;

export interface AgentLoopEvalCase {
  id: string;
  useCaseId: string;
  prompt: string;
  modelProfile: ModelProfile;
  expectedTaskKind: TaskKind;
  verificationPolicy: VerificationPolicy;
  requiredEvidence: EvidenceKind[];
  requiredNarration: NarrationEventType[];
  forbiddenCommands: string[];
  trace: AgentLoopTraceEvent[];
}

export interface EvalFailure {
  caseId: string;
  reason: string;
}

export interface AgentLoopEvalResult {
  caseId: string;
  passed: boolean;
  failures: EvalFailure[];
}
