/**
 * Native+portable capsule strategy.
 *
 * Uses native compaction API for provider-specific continuation AND
 * generates portable state separately (never extracted from opaque encrypted_content).
 *
 * Spec: internal-design-notes § Compaction Strategies — native_portable
 */

import type { ItemParam } from "../../../kernel/transcript/types";
import type { NativeContinuation, ProviderCapabilities } from "../../../kernel/transcript/types-v2";
import { type ModelInvoker, PortableOnlyStrategy } from "./portable-only";
import type { CapsuleGenerationInput, CapsuleStrategy, ContextCapsuleDraft } from "./types";

export class NativePortableStrategy implements CapsuleStrategy {
  readonly name = "native_portable" as const;
  private _nativeCompactor: NativeCompactor;
  private _modelInvoker: ModelInvoker;

  constructor(nativeCompactor: NativeCompactor, modelInvoker: ModelInvoker) {
    this._nativeCompactor = nativeCompactor;
    this._modelInvoker = modelInvoker;
  }

  supports(capabilities: ProviderCapabilities): boolean {
    // Only available when native compaction is supported
    return capabilities.nativeCompaction;
  }

  async generate(input: CapsuleGenerationInput, signal: AbortSignal): Promise<ContextCapsuleDraft> {
    const startTime = Date.now();

    // 1. Generate native continuation
    const nativeContinuation = await this._nativeCompactor.compact(
      {
        model: input.provider.model,
        input: input.sourceItems,
        instructions: input.customInstructions,
      },
      signal,
    );

    // 2. Generate portable state separately (never from encrypted_content)
    const portableStrategy = new PortableOnlyStrategy(this._modelInvoker);
    const portableDraft = await portableStrategy.generate(input, signal);

    const duration = Date.now() - startTime;

    return {
      strategy: "native_portable",
      quality: "native",
      portableState: portableDraft.portableState,
      artifacts: portableDraft.artifacts,
      activatedSkills: input.activatedSkills,
      nativeContinuation,
      provenance: {
        firstCompactedEntryId: input.firstCompactedEntryId,
        firstKeptEntryId: input.firstKeptEntryId,
        sourceEntryIds: input.sourceEntryIds,
      },
      metrics: {
        effectiveTokensBefore: input.snapshotBefore.effectiveTokens,
        estimatedTokensAfter: 0,
        reclaimedTokens: 0,
        savingsRatio: 0,
        generationDurationMs: duration,
      },
    };
  }
}

// ─── Native Compactor Interface ───

export interface NativeCompactor {
  compact(
    input: {
      model: string;
      input: ItemParam[];
      instructions?: string;
      previousResponseId?: string;
    },
    signal: AbortSignal,
  ): Promise<NativeContinuation>;
}
