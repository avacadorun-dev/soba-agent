/**
 * Portable-only capsule strategy.
 *
 * Uses the model to generate a portable context state without native compaction.
 * Falls back to deterministic strategy if model generation fails.
 *
 * Spec: internal-design-notes § Compaction Strategies — portable_only
 */

import type { ItemParam } from "../../session/types";
import type { ProviderCapabilities } from "../../session/types-v2";
import { serializeItemsForCompaction } from "../serializer";
import { DeterministicStrategy } from "./deterministic";
import type { CapsuleGenerationInput, CapsuleStrategy, ContextCapsuleDraft } from "./types";

export class PortableOnlyStrategy implements CapsuleStrategy {
  readonly name = "portable_only" as const;
  private _modelInvoker: ModelInvoker;

  constructor(modelInvoker: ModelInvoker) {
    this._modelInvoker = modelInvoker;
  }

  supports(capabilities: ProviderCapabilities): boolean {
    // Portable-only works with any provider (doesn't need native compaction)
    return !capabilities.nativeCompaction;
  }

  async generate(input: CapsuleGenerationInput, signal: AbortSignal): Promise<ContextCapsuleDraft> {
    const startTime = Date.now();

    try {
      const portableState = await this._generatePortableState(input, signal);
      const artifacts = this._extractArtifacts(input.sourceItems);
      const duration = Date.now() - startTime;

      return {
        strategy: "portable_only",
        quality: "portable",
        portableState,
        artifacts,
        activatedSkills: input.activatedSkills,
        provenance: {
          firstCompactedEntryId: input.firstCompactedEntryId,
          firstKeptEntryId: input.firstKeptEntryId,
          sourceEntryIds: input.branchEntryIds,
        },
        metrics: {
          effectiveTokensBefore: input.snapshotBefore.effectiveTokens,
          estimatedTokensAfter: 0,
          reclaimedTokens: 0,
          savingsRatio: 0,
          generationDurationMs: duration,
        },
      };
    } catch (error) {
      // Fall back to deterministic strategy
      const deterministic = new DeterministicStrategy();
      return deterministic.generate(input, signal);
    }
  }

  private async _generatePortableState(
    input: CapsuleGenerationInput,
    signal: AbortSignal,
  ): Promise<import("../../session/types-v2").PortableContextState> {
    const serialized = serializeItemsForCompaction(input.sourceItems);

    const prompt = `Analyze the following conversation and extract a portable context state.

Return a JSON object with this structure:
{
  "goal": "string - the main objective",
  "constraints": ["string[] - any constraints or requirements"],
  "completed": ["string[] - what has been completed"],
  "inProgress": ["string[] - what is currently being worked on"],
  "pending": ["string[] - what remains to be done"],
  "decisions": [{"decision": "string", "rationale": "string (optional)"}],
  "blockers": ["string[] - any blocking issues"],
  "nextSteps": ["string[] - immediate next actions"]
}

Focus on preserving:
- Key decisions and their rationale
- Files modified and what changes were made
- Active tasks and their current status
- Important context for continuing work

Conversation:
${serialized}

${input.customInstructions ? `Additional instructions: ${input.customInstructions}` : ""}

Return only the JSON object, no markdown formatting.`;

    const response = await this._modelInvoker.invoke(prompt, signal);

    try {
      const parsed = JSON.parse(response);
      return this._validatePortableState(parsed);
    } catch {
      throw new Error("Failed to parse portable state JSON");
    }
  }

  private _validatePortableState(data: unknown): import("../../session/types-v2").PortableContextState {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid portable state: not an object");
    }

    const obj = data as Record<string, unknown>;

    return {
      goal: typeof obj.goal === "string" ? obj.goal : "Continue working",
      constraints: Array.isArray(obj.constraints) ? obj.constraints.filter((x): x is string => typeof x === "string") : [],
      completed: Array.isArray(obj.completed) ? obj.completed.filter((x): x is string => typeof x === "string") : [],
      inProgress: Array.isArray(obj.inProgress) ? obj.inProgress.filter((x): x is string => typeof x === "string") : [],
      pending: Array.isArray(obj.pending) ? obj.pending.filter((x): x is string => typeof x === "string") : [],
      decisions: Array.isArray(obj.decisions)
        ? obj.decisions
            .filter((x): x is { decision: string; rationale?: string } => {
              return x && typeof x === "object" && "decision" in x && typeof x.decision === "string";
            })
            .map((x) => ({ decision: x.decision, rationale: x.rationale }))
        : [],
      blockers: Array.isArray(obj.blockers) ? obj.blockers.filter((x): x is string => typeof x === "string") : [],
      nextSteps: Array.isArray(obj.nextSteps) ? obj.nextSteps.filter((x): x is string => typeof x === "string") : [],
    };
  }

  private _extractArtifacts(items: ItemParam[]): import("../../session/types-v2").ArtifactLedger {
    const readFiles = new Set<string>();
    const modifiedFiles = new Set<string>();
    const verificationCommands = new Set<string>();
    let verificationStatus: "passed" | "failed" | "unknown" = "unknown";

    for (const item of items) {
      if (item.type === "function_call") {
        try {
          const args = JSON.parse(item.arguments);
          if (item.name === "read" && args.path) readFiles.add(args.path);
          if ((item.name === "write" || item.name === "edit") && args.path) modifiedFiles.add(args.path);
          if (item.name === "bash" && args.command) {
            const cmd = args.command as string;
            if (cmd.includes("test") || cmd.includes("lint") || cmd.includes("build")) {
              verificationCommands.add(cmd);
            }
          }
        } catch {
          // Ignore
        }
      }

      if (item.type === "local_shell_call_output") {
        if (item.exit_code === 0) verificationStatus = "passed";
        else if (item.exit_code !== undefined && item.exit_code !== 0) verificationStatus = "failed";
      }
    }

    return {
      readFiles: Array.from(readFiles),
      modifiedFiles: Array.from(modifiedFiles),
      verificationCommands: Array.from(verificationCommands),
      verificationStatus,
    };
  }
}

// ─── Model Invoker Interface ───

export interface ModelInvoker {
  invoke(prompt: string, signal: AbortSignal): Promise<string>;
}
