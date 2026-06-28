import { createHash } from "node:crypto";
import { detectPotentialSecret } from "../../application/capsules/sanitizer";
import type { DiagnosticReport } from "../recovery";
import type { ProjectMemorySource } from "./memory-injector";
import type { MemoryCapsule, MemoryCapsuleInput } from "./types";

const ENV_PLACEHOLDER_PATTERN = /\$\{ENV:([A-Z_][A-Z0-9_]*)\}/g;
const MAX_FIELD_LENGTH = 240;

export interface ReflectionMemoryStore extends ProjectMemorySource {
  addCapsule(input: MemoryCapsuleInput): MemoryCapsule;
}

export interface RecoveryReflectionDraft {
  problem: string;
  cause: string;
  fixes: string[];
  tags: string[];
  fingerprintTag: string;
}

export interface RecoveryReflectionInput {
  task: string;
  sessionId: string;
  draft: RecoveryReflectionDraft;
  verification: string;
  observableSuccess: boolean;
  timestamp?: string;
}

export type ReflectionMemoryWriteResult =
  | { status: "written"; capsule: MemoryCapsule }
  | {
      status: "skipped";
      reason: "no_memory" | "no_observable_success" | "incomplete_lesson" | "secret_detected" | "duplicate";
      existingId?: string;
    };

export function isReflectionMemoryStore(memory: ProjectMemorySource | undefined): memory is ReflectionMemoryStore {
  return typeof (memory as Partial<ReflectionMemoryStore> | undefined)?.addCapsule === "function";
}

export function createRecoveryReflectionDraft(diagnostic: DiagnosticReport): RecoveryReflectionDraft {
  const problem = truncateText(diagnostic.summary);
  const firstDiagnostic = diagnostic.diagnostics[0];
  const location = firstDiagnostic?.file ? ` in ${firstDiagnostic.file}` : "";
  const code = firstDiagnostic?.code ? ` (${firstDiagnostic.code})` : "";
  const cause = truncateText(`${diagnostic.tool}${code}${location}: ${firstDiagnostic?.message ?? diagnostic.summary}`);
  const fingerprintTag = `lesson-${hashLesson([diagnostic.tool, diagnostic.fingerprint, problem].join("\n"))}`;

  return {
    problem,
    cause,
    fixes: [],
    tags: ["reflection", "recovery", "fix-until-green", diagnostic.tool, fingerprintTag],
    fingerprintTag,
  };
}

export function addRecoveryReflectionFix(draft: RecoveryReflectionDraft, fix: string): RecoveryReflectionDraft {
  const normalizedFix = truncateText(fix);
  if (!normalizedFix || draft.fixes.includes(normalizedFix)) return draft;
  return {
    ...draft,
    fixes: [...draft.fixes, normalizedFix].slice(-3),
  };
}

export function writeRecoveryReflectionLesson(
  memory: ProjectMemorySource | undefined,
  input: RecoveryReflectionInput,
): ReflectionMemoryWriteResult {
  if (!isReflectionMemoryStore(memory)) {
    return { status: "skipped", reason: "no_memory" };
  }
  if (!input.observableSuccess) {
    return { status: "skipped", reason: "no_observable_success" };
  }

  const fix = input.draft.fixes.join("; ");
  if (!input.draft.problem || !input.draft.cause || !fix || !input.verification) {
    return { status: "skipped", reason: "incomplete_lesson" };
  }

  const summary = truncateText(`Recovered: ${input.draft.problem}`, 160);
  const detail = [
    `Problem: ${input.draft.problem}`,
    `Cause: ${input.draft.cause}`,
    `Fix: ${fix}`,
    `Verification: ${truncateText(input.verification)}`,
  ].join("\n");
  const capsuleInput: MemoryCapsuleInput = {
    type: "error_fix",
    summary,
    detail,
    context: {
      task: truncateText(input.task, 180),
      sessionId: input.sessionId,
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    },
    priority: "medium",
    tags: input.draft.tags,
    related: [],
    source: {
      error: input.draft.problem,
      fix,
    },
  };

  if (containsSecret(capsuleInput)) {
    return { status: "skipped", reason: "secret_detected" };
  }

  const duplicate = memory.getRelevantCapsules({
    tags: [input.draft.fingerprintTag],
    limit: 1,
  })[0]?.capsule;
  if (duplicate) {
    return {
      status: "skipped",
      reason: "duplicate",
      existingId: duplicate.id,
    };
  }

  return {
    status: "written",
    capsule: memory.addCapsule(capsuleInput),
  };
}

function containsSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return detectPotentialSecret(serialized) || ENV_PLACEHOLDER_PATTERN.test(serialized);
}

function truncateText(text: string, maxLength = MAX_FIELD_LENGTH): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function hashLesson(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
