/**
 * CapsuleGenerator — orchestrates capsule generation with strategy selection,
 * validation, and fallback chain.
 *
 * Strategy selection priority:
 * 1. native_portable (if provider supports native compaction)
 * 2. portable_only (model-generated portable state)
 * 3. deterministic (fallback, always available)
 *
 * The generator:
 * - Selects the best available strategy
 * - Generates the capsule draft
 * - Validates the draft
 * - Falls back to next strategy on validation failure
 * - Calculates final metrics
 *
 * Spec: internal-design-notes § Compaction Strategies
 */

import { serializeCapsuleContext } from "../../kernel/session/context-capsule-input";
import { estimateTokens } from "../../kernel/session/estimation";
import type { ItemParam } from "../../kernel/transcript/types";
import type { ContextCapsuleEntry, ProviderCapabilities } from "../../kernel/transcript/types-v2";
import { type CapsuleValidationResult, CapsuleValidator } from "./capsule-validator";
import type { ContextSnapshot } from "./context-meter";
import { DeterministicStrategy } from "./strategies/deterministic";
import { type NativeCompactor, NativePortableStrategy } from "./strategies/native-portable";
import { type ModelInvoker, PortableOnlyStrategy } from "./strategies/portable-only";
import type { CapsuleGenerationInput, CapsuleStrategy, ContextCapsuleDraft } from "./strategies/types";

// ─── Types ───

export interface CapsuleGeneratorConfig {
  modelInvoker: ModelInvoker;
  nativeCompactor?: NativeCompactor;
}

export interface CapsuleGenerationResult {
  draft: ContextCapsuleDraft;
  validation: CapsuleValidationResult;
  strategyUsed: ContextCapsuleEntry["strategy"];
  fallbackChain: ContextCapsuleEntry["strategy"][];
}

// ─── Generator ───

export class CapsuleGenerator {
  private _validator: CapsuleValidator;
  private _modelInvoker: ModelInvoker;
  private _nativeCompactor?: NativeCompactor;

  constructor(config: CapsuleGeneratorConfig) {
    this._validator = new CapsuleValidator();
    this._modelInvoker = config.modelInvoker;
    this._nativeCompactor = config.nativeCompactor;
  }

  /**
   * Generate a capsule with automatic strategy selection and fallback.
   *
   * @param input Generation input parameters
   * @param sourceItems Items being compacted (before cut point)
   * @param keptItems Items being kept (after cut point)
   * @param isBlocking Whether this is a blocking compaction (hard_limit / context_overflow)
   * @param signal Abort signal for cancellation
   */
  async generate(
    input: CapsuleGenerationInput,
    sourceItems: ItemParam[],
    keptItems: ItemParam[],
    isBlocking: boolean,
    signal: AbortSignal,
  ): Promise<CapsuleGenerationResult> {
    const fallbackChain: ContextCapsuleEntry["strategy"][] = [];

    // Build strategy chain based on capabilities
    const strategies = this._buildStrategyChain(input.capabilities);

    let lastDraft: ContextCapsuleDraft | null = null;
    let lastValidation: CapsuleValidationResult | null = null;

    // Try each strategy in order
    for (const strategy of strategies) {
      if (signal.aborted) {
        throw new Error("Capsule generation aborted");
      }

      fallbackChain.push(strategy.name);

      try {
        const draft = await strategy.generate(input, signal);

        // Calculate metrics
        this._calculateMetrics(
          draft,
          keptItems,
          input.snapshotBefore,
          input.capabilities.continuationCompatibilityKey,
        );

        // Validate
        const validation = this._validator.validate(
          draft,
          input.branchEntryIds,
          sourceItems,
          keptItems,
          input.snapshotBefore,
          isBlocking,
          input.sessionId,
          input.activatedSkills,
        );

        lastDraft = draft;
        lastValidation = validation;

        // If valid, return success
        if (validation.valid) {
          return {
            draft,
            validation,
            strategyUsed: strategy.name,
            fallbackChain,
          };
        }

        // If blocking compaction and validation failed, try next strategy
        // For non-blocking, we can still use a draft with warnings
        if (!isBlocking && validation.errors.length === 0) {
          return {
            draft,
            validation,
            strategyUsed: strategy.name,
            fallbackChain,
          };
        }
      } catch (error) {
        // Strategy failed, try next one
        console.warn(`Strategy ${strategy.name} failed:`, error);
      }
    }

    // All strategies exhausted
    if (lastDraft && lastValidation) {
      // Return the last attempt even if invalid (caller can decide what to do)
      return {
        draft: lastDraft,
        validation: lastValidation,
        strategyUsed: fallbackChain[fallbackChain.length - 1],
        fallbackChain,
      };
    }

    // No strategies available at all (should never happen since deterministic is always available)
    throw new Error("No capsule generation strategies available");
  }

  /**
   * Generate the local fallback directly after a model-strategy deadline.
   *
   * This is deliberately separate from `generate`: the caller owns the
   * deadline and must be able to stop waiting for a provider that ignores
   * cancellation without re-entering the model strategy chain.
   */
  async generateDeterministic(
    input: CapsuleGenerationInput,
    sourceItems: ItemParam[],
    keptItems: ItemParam[],
    isBlocking: boolean,
    signal: AbortSignal,
  ): Promise<CapsuleGenerationResult> {
    if (signal.aborted) throw new Error("Capsule generation aborted");

    const strategy = new DeterministicStrategy();
    const draft = await strategy.generate(input, signal);
    this._calculateMetrics(
      draft,
      keptItems,
      input.snapshotBefore,
      input.capabilities.continuationCompatibilityKey,
    );
    const validation = this._validator.validate(
      draft,
      input.branchEntryIds,
      sourceItems,
      keptItems,
      input.snapshotBefore,
      isBlocking,
      input.sessionId,
      input.activatedSkills,
    );

    return {
      draft,
      validation,
      strategyUsed: strategy.name,
      fallbackChain: [strategy.name],
    };
  }

  /**
   * Build the strategy chain based on provider capabilities.
   */
  private _buildStrategyChain(capabilities: ProviderCapabilities): CapsuleStrategy[] {
    const strategies: CapsuleStrategy[] = [];

    // 1. Native+portable (if available)
    if (capabilities.nativeCompaction && this._nativeCompactor) {
      strategies.push(new NativePortableStrategy(this._nativeCompactor, this._modelInvoker));
    }

    // 2. Portable-only (if provider doesn't have native compaction)
    if (!capabilities.nativeCompaction) {
      strategies.push(new PortableOnlyStrategy(this._modelInvoker));
    }

    // 3. Deterministic (always available as fallback)
    strategies.push(new DeterministicStrategy());

    return strategies;
  }

  /**
   * Calculate final metrics for the draft.
   */
  private _calculateMetrics(
    draft: ContextCapsuleDraft,
    keptItems: ItemParam[],
    snapshotBefore: ContextSnapshot,
    providerCompatibilityKey?: string,
  ): void {
    // Estimate the exact continuation prefix that buildInput will send, plus
    // retained items and stable non-session request parts.
    const native = draft.nativeContinuation;
    const useNative = native !== undefined &&
      providerCompatibilityKey !== undefined &&
      providerCompatibilityKey !== "" &&
      native.compatibilityKey === providerCompatibilityKey;
    const capsuleItems: ItemParam[] = useNative && native
      ? native.items as ItemParam[]
      : [{
          type: "message",
          role: "system",
          content: [{
            type: "input_text",
            text: `SOBA Context Capsule\n\n${serializeCapsuleContext(
              draft.portableState,
              draft.artifacts,
              draft.activatedSkills,
            )}`,
          }],
        }];
    const capsuleTokens = estimateTokens(capsuleItems);
    const keptItemsTokens = estimateTokens(keptItems);

    const estimatedTokensAfter =
      snapshotBefore.systemPromptTokens +
      snapshotBefore.toolSchemaTokens +
      capsuleTokens +
      keptItemsTokens;
    const reclaimedTokens = Math.max(0, snapshotBefore.effectiveTokens - estimatedTokensAfter);
    const savingsRatio =
      snapshotBefore.effectiveTokens > 0
        ? reclaimedTokens / snapshotBefore.effectiveTokens
        : 0;

    draft.metrics.estimatedTokensAfter = estimatedTokensAfter;
    draft.metrics.reclaimedTokens = reclaimedTokens;
    draft.metrics.savingsRatio = savingsRatio;
  }

}
