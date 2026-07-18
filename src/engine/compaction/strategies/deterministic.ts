/**
 * Deterministic capsule strategy.
 *
 * Extracts data from session entries without calling the model:
 * - goal: last user request
 * - completed/next steps: accepted finish criteria and checkpoint args
 * - modified/read files: tool calls
 * - verification status: completion gate evidence and tool results
 * - blockers: active errors
 * - pending: checkpoint args or empty list
 *
 * This is the fallback strategy when model generation fails.
 *
 * Spec: internal-design-notes § Compaction Strategies — deterministic
 */

import type { ItemParam } from "../../../kernel/transcript/types";
import type { ArtifactLedger, PortableContextState, ProviderCapabilities } from "../../../kernel/transcript/types-v2";
import { toolFailureOutput } from "../tool-output-failure";
import type { CapsuleGenerationInput, CapsuleStrategy, ContextCapsuleDraft } from "./types";

interface CheckpointFacts {
  kind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed: string[];
  pending: string[];
}

export class DeterministicStrategy implements CapsuleStrategy {
  readonly name = "deterministic" as const;

  supports(_capabilities: ProviderCapabilities): boolean {
    // Deterministic strategy always available
    return true;
  }

  async generate(input: CapsuleGenerationInput, _signal: AbortSignal): Promise<ContextCapsuleDraft> {
    const startTime = Date.now();

    const portableState = this._extractPortableState(
      input.sourceItems,
      input.customInstructions,
      input.previousPortableState,
    );
    const artifacts = this._extractArtifactLedger(input.sourceItems);

    const duration = Date.now() - startTime;

    return {
      strategy: "deterministic",
      quality: "degraded",
      portableState,
      artifacts,
      activatedSkills: input.activatedSkills,
      provenance: {
        firstCompactedEntryId: input.firstCompactedEntryId,
        firstKeptEntryId: input.firstKeptEntryId,
        sourceEntryIds: input.sourceEntryIds,
      },
      metrics: {
        effectiveTokensBefore: input.snapshotBefore.effectiveTokens,
        estimatedTokensAfter: 0, // Will be calculated by generator
        reclaimedTokens: 0, // Will be calculated by generator
        savingsRatio: 0, // Will be calculated by generator
        generationDurationMs: duration,
      },
    };
  }

  private _extractPortableState(
    items: ItemParam[],
    customInstructions?: string,
    previous?: PortableContextState,
  ): PortableContextState {
    const checkpoints = this._extractCheckpoints(items);
    const completed = unique([...(previous?.completed ?? []), ...this._extractCompleted(items, checkpoints)]);
    const pending = unique([...(previous?.pending ?? []), ...this._extractPending(checkpoints)])
      .filter((item) => !completed.includes(item));
    const nextSteps = unique([...this._extractNextSteps(items, checkpoints), ...(previous?.nextSteps ?? [])]);
    const blockers = unique([...(previous?.blockers ?? []), ...this._extractBlockers(items)]);
    const decisions = uniqueDecisions([...(previous?.decisions ?? []), ...this._extractDecisions(items, checkpoints)]);

    return {
      goal: customInstructions ?? this._extractGoal(items) ?? previous?.goal ?? "Continue working on the current task",
      constraints: unique(previous?.constraints ?? []),
      completed,
      inProgress: unique(previous?.inProgress ?? []).filter((item) => !completed.includes(item)),
      pending,
      decisions,
      blockers,
      nextSteps,
    };
  }

  private _extractGoal(items: ItemParam[]): string | null {
    // Find the last user message
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === "message" && item.role === "user") {
        if (Array.isArray(item.content)) {
          const text = item.content
            .filter((b) => "text" in b)
            .map((b) => ("text" in b ? b.text : ""))
            .join("\n");
          if (text.trim()) return text.slice(0, 500);
        }
      }
    }
    return null;
  }

  private _extractCompleted(items: ItemParam[], checkpoints: CheckpointFacts[]): string[] {
    const completed: string[] = [];

    for (const checkpoint of checkpoints) {
      for (const item of checkpoint.completed) {
        if (!completed.includes(item)) {
          completed.push(item);
        }
      }
    }

    // Look for assistant messages indicating completion
    for (const item of items) {
      if (item.type === "message" && item.role === "assistant") {
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if ("text" in block && block.text) {
              // A final answer is the strongest deterministic record of what
              // the previous turn actually delivered.
              if (item.phase === "final_answer") {
                const summary = summarizeText(block.text, 400);
                if (summary && !completed.includes(summary)) completed.push(summary);
              } else if (
                block.text.toLowerCase().includes("completed") ||
                block.text.toLowerCase().includes("done") ||
                block.text.toLowerCase().includes("finished")
              ) {
                const summary = block.text.slice(0, 200);
                if (!completed.includes(summary)) {
                  completed.push(summary);
                }
              }
            }
          }
        }
      }
    }

    return completed.slice(0, 10); // Limit to 10 items
  }

  private _extractPending(checkpoints: CheckpointFacts[]): string[] {
    const pending: string[] = [];
    for (const checkpoint of checkpoints) {
      for (const item of checkpoint.pending) {
        if (!pending.includes(item)) {
          pending.push(item);
        }
      }
    }
    return pending.slice(0, 10);
  }

  private _extractNextSteps(items: ItemParam[], checkpoints: CheckpointFacts[]): string[] {
    const nextSteps: string[] = [];

    for (const checkpoint of checkpoints) {
      if (checkpoint.nextDirection && !nextSteps.includes(checkpoint.nextDirection)) {
        nextSteps.push(checkpoint.nextDirection);
      }
      for (const item of checkpoint.pending) {
        if (!nextSteps.includes(item)) {
          nextSteps.push(item);
        }
      }
    }

    // Look for pending or TODO markers in recent assistant messages
    for (let i = items.length - 1; i >= 0 && nextSteps.length < 5; i--) {
      const item = items[i];
      if (item.type === "message" && item.role === "assistant") {
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if ("text" in block && block.text) {
              if (
                block.text.toLowerCase().includes("next") ||
                block.text.toLowerCase().includes("todo") ||
                block.text.toLowerCase().includes("pending")
              ) {
                const summary = block.text.slice(0, 200);
                if (!nextSteps.includes(summary)) {
                  nextSteps.push(summary);
                }
              }
            }
          }
        }
      }
    }

    return nextSteps;
  }

  private _extractBlockers(items: ItemParam[]): string[] {
    const blockers: string[] = [];

    // Look for error indicators in recent tool outputs
    for (let i = items.length - 1; i >= 0 && blockers.length < 5; i--) {
      const item = items[i];
      if (item.type === "function_call_output" || item.type === "local_shell_call_output") {
        const output = toolFailureOutput(item);
        if (output) {
          const summary = output.slice(0, 200);
          if (!blockers.includes(summary)) {
            blockers.push(summary);
          }
        }
      }
    }

    return blockers;
  }

  private _extractDecisions(
    items: ItemParam[],
    checkpoints: CheckpointFacts[],
  ): Array<{ decision: string; rationale?: string }> {
    const decisions: Array<{ decision: string; rationale?: string }> = [];

    for (const checkpoint of checkpoints) {
      if (checkpoint.kind !== "plan_pivot") continue;
      const decision = checkpoint.nextDirection
        ? `Plan pivot: ${checkpoint.nextDirection}`
        : `Plan pivot: ${checkpoint.reason}`;
      if (!decisions.some((entry) => entry.decision === decision)) {
        decisions.push({ decision, rationale: checkpoint.reason });
      }
    }

    // Look for decision markers in assistant messages
    for (const item of items) {
      if (item.type === "message" && item.role === "assistant") {
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if ("text" in block && block.text) {
              if (
                block.text.toLowerCase().includes("decided") ||
                block.text.toLowerCase().includes("decision") ||
                block.text.toLowerCase().includes("chose")
              ) {
                const summary = block.text.slice(0, 200);
                if (!decisions.some((d) => d.decision === summary)) {
                  decisions.push({ decision: summary });
                }
              }
            }
          }
        }
      }
    }

    return decisions.slice(0, 10);
  }

  private _extractArtifactLedger(items: ItemParam[]): ArtifactLedger {
    const readFiles = new Set<string>();
    const modifiedFiles = new Set<string>();
    const verificationCommands = new Set<string>();
    const checkpointSummaries = new Set<string>();
    let verificationStatus: "passed" | "failed" | "unknown" = "unknown";

    for (const item of items) {
      if (item.type === "function_call") {
        // Extract file operations from tool calls
        try {
          const args = JSON.parse(item.arguments);

          // Read operations
          if (item.name === "read" && args.path) {
            readFiles.add(args.path);
          }

          // Write/edit operations
          if ((item.name === "write" || item.name === "edit") && args.path) {
            modifiedFiles.add(args.path);
          }

          // Bash commands (potential verification)
          if (item.name === "bash" && args.command) {
            const cmd = args.command as string;
            if (
              cmd.includes("test") ||
              cmd.includes("lint") ||
              cmd.includes("build") ||
              cmd.includes("check")
            ) {
              verificationCommands.add(cmd);
            }
          }

          if (item.name === "checkpoint") {
            const checkpoint = this._parseCheckpointFacts(args);
            if (checkpoint) {
              const parts = [`${checkpoint.kind}: ${checkpoint.reason}`];
              if (checkpoint.nextDirection) parts.push(`next: ${checkpoint.nextDirection}`);
              if (checkpoint.completed.length > 0) parts.push(`completed: ${checkpoint.completed.join(", ")}`);
              if (checkpoint.pending.length > 0) parts.push(`pending: ${checkpoint.pending.join(", ")}`);
              checkpointSummaries.add(parts.join("; "));
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (item.type === "local_shell_call") {
        const cmd = item.command;
        if (
          cmd.includes("test") ||
          cmd.includes("lint") ||
          cmd.includes("build") ||
          cmd.includes("check")
        ) {
          verificationCommands.add(cmd);
        }
      }

      if (item.type === "local_shell_call_output") {
        // Check exit code for verification status
        if (item.exit_code === 0) {
          verificationStatus = "passed";
        } else if (item.exit_code !== undefined && item.exit_code !== 0) {
          verificationStatus = "failed";
        }
      }
    }

    return {
      readFiles: Array.from(readFiles),
      modifiedFiles: Array.from(modifiedFiles),
      verificationCommands: Array.from(verificationCommands),
      verificationStatus,
      checkpointSummaries: Array.from(checkpointSummaries),
    };
  }

  private _extractCheckpoints(items: ItemParam[]): CheckpointFacts[] {
    const checkpoints: CheckpointFacts[] = [];
    for (const item of items) {
      if (item.type !== "function_call" || item.name !== "checkpoint") continue;
      try {
        const args = JSON.parse(item.arguments);
        const checkpoint = this._parseCheckpointFacts(args);
        if (checkpoint) checkpoints.push(checkpoint);
      } catch {
        // Ignore malformed checkpoint arguments.
      }
    }
    return checkpoints;
  }

  private _parseCheckpointFacts(args: unknown): CheckpointFacts | null {
    if (!args || typeof args !== "object") return null;
    const record = args as Record<string, unknown>;
    const kind = record.kind;
    const reason = record.reason;
    if ((kind !== "milestone" && kind !== "plan_pivot") || typeof reason !== "string") return null;
    return {
      kind,
      reason,
      nextDirection: typeof record.nextDirection === "string" ? record.nextDirection : undefined,
      completed: toStringArray(record.completed),
      pending: toStringArray(record.pending),
    };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].slice(0, 10);
}

function uniqueDecisions(
  values: Array<{ decision: string; rationale?: string }>,
): Array<{ decision: string; rationale?: string }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value.decision.trim() || seen.has(value.decision)) return false;
    seen.add(value.decision);
    return true;
  }).slice(0, 10);
}

function summarizeText(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
