/**
 * ContextManager — orchestrates context compaction lifecycle.
 *
 * Responsibilities:
 * 1. Pre-inference hard limit check (blocking compaction)
 * 2. Context overflow recovery (emergency compact + retry)
 * 3. Manual /compact command (/compact [instructions])
 * 4. Background compaction trigger (turn_complete, milestone)
 *
 * The manager coordinates:
 * - ContextMeter (snapshot)
 * - TriggerPolicy (when to compact)
 * - CapsuleGenerator (how to compact)
 * - CapsuleValidator (validate draft)
 * - SessionManager (append capsule)
 *
 * Spec: internal-design-notes
 */

import type { SessionManager } from "../session/session-manager";
import type { ItemParam } from "../session/types";
import type {
  ContextCapsuleEntry,
  ProviderCapabilities,
  ProviderIdentity,
} from "../session/types-v2";
import { isContextCapsuleEntry } from "../session/types-v2";
import { CapsuleGenerator, type CapsuleGeneratorConfig } from "./capsule-generator";
import type { CapsuleValidationResult } from "./capsule-validator";
import { findCutPoint } from "./compaction";
import { ContextMeter, type ContextSnapshot } from "./context-meter";
import type { CapsuleGenerationInput } from "./strategies/types";
import type { CapsuleTrigger, CompactionConfig } from "./trigger-policy";
import { TriggerPolicy } from "./trigger-policy";

// ─── Types ───

export interface ContextManagerConfig {
  compaction: CompactionConfig;
  contextWindow: number;
  maxOutputTokens: number;
  provider: ProviderIdentity;
  capabilities: ProviderCapabilities;
  generatorConfig: CapsuleGeneratorConfig;
}

export interface CompactionOutcome {
  /** Whether compaction was performed */
  compacted: boolean;
  /** The trigger that caused compaction */
  trigger: CapsuleTrigger | null;
  /** The strategy used */
  strategy: ContextCapsuleEntry["strategy"] | null;
  /** The quality of the resulting capsule */
  quality: ContextCapsuleEntry["quality"] | null;
  /** Checkpoint ID if capsule was created */
  checkpointId: string | null;
  /** Metrics if compaction was performed */
  metrics: ContextCapsuleEntry["metrics"] | null;
  /** Validation result */
  validation: CapsuleValidationResult | null;
  /** Reason for no-op or error */
  reason: string;
}

export interface PreInferenceCheckResult {
  /** Whether the request can proceed */
  canProceed: boolean;
  /** If blocking compaction was needed and performed */
  compactionPerformed: boolean;
  /** Error message if request cannot proceed */
  error?: string;
  /** Compaction outcome if performed */
  outcome?: CompactionOutcome;
}

export interface OverflowRecoveryResult {
  /** Whether recovery was successful */
  recovered: boolean;
  /** Whether the request should be retried */
  shouldRetry: boolean;
  /** Compaction outcome */
  outcome?: CompactionOutcome;
  /** Error if recovery failed */
  error?: string;
}

// ─── ContextManager ───

export class ContextManager {
  private _session: SessionManager;
  private _meter: ContextMeter;
  private _policy: TriggerPolicy;
  private _generator: CapsuleGenerator;
  private _provider: ProviderIdentity;
  private _capabilities: ProviderCapabilities;
  private _config: ContextManagerConfig;
  /** Cached last snapshot for reactive sidebar access (set via getSnapshot). */
  private _lastSnapshot: ContextSnapshot | null = null;

  constructor(session: SessionManager, config: ContextManagerConfig) {
    this._session = session;
    this._config = config;
    this._meter = new ContextMeter(
      config.contextWindow,
      config.maxOutputTokens,
      config.compaction.safetyReserveTokens,
    );
    this._policy = new TriggerPolicy(config.compaction);
    this._generator = new CapsuleGenerator(config.generatorConfig);
    this._provider = config.provider;
    this._capabilities = config.capabilities;
  }

  // ─── Pre-inference check ───

  /**
   * Check if the next inference can proceed.
   *
   * If effectiveTokens > hardLimit, perform blocking compaction first.
   * The request can only proceed if post-compaction effectiveTokens <= hardLimit.
   *
   * @param systemPromptTokens Estimated system prompt tokens
   * @param toolSchemaTokens Estimated tool schema tokens
   * @param requestFingerprint Hash of non-session request parts
   */
  async preInferenceCheck(
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): Promise<PreInferenceCheckResult> {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    // Check hard limit
    const hardLimitDecision = this._policy.evaluateHardLimit(snapshot);

    if (!hardLimitDecision.shouldCompact) {
      return { canProceed: true, compactionPerformed: false };
    }

    // Perform blocking compaction
    const outcome = await this._performCompaction(
      snapshot,
      "hard_limit",
      true, // isBlocking
    );

    if (!outcome.compacted) {
      // Compaction failed or insufficient — cannot proceed
      return {
        canProceed: false,
        compactionPerformed: false,
        error: outcome.reason,
        outcome,
      };
    }

    // Re-measure after compaction
    const postSnapshot = this._meter.snapshot(
      this._session.getBranch(),
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    if (postSnapshot.effectiveTokens > postSnapshot.hardLimit) {
      // Post-compaction still exceeds hard limit
      return {
        canProceed: false,
        compactionPerformed: true,
        error: `Post-compaction effective tokens (${postSnapshot.effectiveTokens}) still exceed hard limit (${postSnapshot.hardLimit}). Compaction freed insufficient context.`,
        outcome,
      };
    }

    return {
      canProceed: true,
      compactionPerformed: true,
      outcome,
    };
  }

  // ─── Context overflow recovery ───

  /**
   * Handle a context_overflow error from the provider.
   *
   * Performs one emergency compact + retry. Only called when
   * the provider adapter classifies the error as "context_overflow".
   *
   * @param systemPromptTokens Estimated system prompt tokens
   * @param toolSchemaTokens Estimated tool schema tokens
   * @param requestFingerprint Hash of non-session request parts
   */
  async handleContextOverflow(
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): Promise<OverflowRecoveryResult> {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    const outcome = await this._performCompaction(
      snapshot,
      "context_overflow",
      true, // isBlocking — emergency
    );

    if (!outcome.compacted) {
      return {
        recovered: false,
        shouldRetry: false,
        outcome,
        error: outcome.reason,
      };
    }

    // Re-measure
    const postSnapshot = this._meter.snapshot(
      this._session.getBranch(),
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    if (postSnapshot.effectiveTokens > postSnapshot.hardLimit) {
      return {
        recovered: false,
        shouldRetry: false,
        outcome,
        error: `Emergency compaction freed insufficient context. Post-compaction: ${postSnapshot.effectiveTokens}, hard limit: ${postSnapshot.hardLimit}`,
      };
    }

    return {
      recovered: true,
      shouldRetry: true,
      outcome,
    };
  }

  // ─── Manual compaction (/compact) ───

  /**
   * Execute manual compaction triggered by /compact command.
   *
   * @param customInstructions Optional user-provided instructions
   * @param systemPromptTokens Estimated system prompt tokens
   * @param toolSchemaTokens Estimated tool schema tokens
   * @param requestFingerprint Hash of non-session request parts
   */
  async manualCompact(
    customInstructions: string | undefined,
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): Promise<CompactionOutcome> {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    // Evaluate user request trigger
    const decision = this._policy.evaluateUserRequest(snapshot);

    if (!decision.shouldCompact) {
      return {
        compacted: false,
        trigger: null,
        strategy: null,
        quality: null,
        checkpointId: null,
        metrics: null,
        validation: null,
        reason: decision.reason,
      };
    }

    return this._performCompaction(
      snapshot,
      "user_request",
      false, // not blocking
      customInstructions,
    );
  }

  // ─── Turn complete trigger ───

  /**
   * Evaluate whether background compaction should run after turn completion.
   * Returns the trigger decision (caller is responsible for scheduling).
   */
  evaluateTurnComplete(
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): { shouldCompact: boolean; snapshot: ContextSnapshot } {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    const decision = this._policy.evaluateTurnComplete(snapshot);
    return { shouldCompact: decision.shouldCompact, snapshot };
  }

  // ─── Milestone trigger ───

  /**
   * Evaluate whether compaction should run on milestone checkpoint.
   */
  evaluateMilestone(
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): { shouldCompact: boolean; snapshot: ContextSnapshot } {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );

    const decision = this._policy.evaluateMilestone(snapshot);
    return { shouldCompact: decision.shouldCompact, snapshot };
  }

  /**
   * Execute scheduled background compaction using a pre-evaluated snapshot.
   * The scheduler owns trigger policy evaluation and leaf-staleness checks.
   */
  async compactScheduled(
    trigger: CapsuleTrigger,
    snapshot: ContextSnapshot,
  ): Promise<CompactionOutcome> {
    return this._performCompaction(
      snapshot,
      trigger,
      false,
    );
  }

  // ─── Record provider usage ───

  /**
   * Record provider usage from a completed inference.
   */
  recordProviderUsage(
    inputTokens: number,
    measuredThroughEntryId: string | null,
    requestFingerprint: string,
  ): void {
    this._meter.recordProviderUsage(inputTokens, measuredThroughEntryId, requestFingerprint);
  }

  // ─── Get current snapshot ───

  /**
   * Get the current context snapshot.
   */
  getSnapshot(
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): ContextSnapshot {
    const branch = this._session.getBranch();
    const snapshot = this._meter.snapshot(
      branch,
      requestFingerprint,
      systemPromptTokens,
      toolSchemaTokens,
    );
    this._lastSnapshot = snapshot;
    return snapshot;
  }

  // ─── Config access ───

  getPolicy(): TriggerPolicy {
    return this._policy;
  }

  getMeter(): ContextMeter {
    return this._meter;
  }

  /**
   * Returns debug information for the sidebar.
   * Does not require systemPromptTokens/toolSchemaTokens — uses cached state only.
   */
  getDebugInfo(): {
    source: "provider_usage" | "estimated";
    safetyReserveTokens: number;
    maxOutputTokens: number;
    contextWindow: number;
    hardLimit: number;
    effectiveTokens: number;
  } {
    return {
      source: this._meter.watermark ? "provider_usage" : "estimated",
      safetyReserveTokens: this._meter.safetyReserveTokens,
      maxOutputTokens: this._meter.maxOutputTokens,
      contextWindow: this._meter.contextWindow,
      hardLimit: this._meter.hardLimit,
      effectiveTokens: this._lastSnapshot?.effectiveTokens ?? 0,
    };
  }

  // ─── Private: perform compaction ───

  /**
   * Perform compaction using the configured strategy chain.
   */
  private async _performCompaction(
    snapshot: ContextSnapshot,
    trigger: CapsuleTrigger,
    isBlocking: boolean,
    customInstructions?: string,
  ): Promise<CompactionOutcome> {
    const branch = this._session.getBranch();
    const branchEntryIds = branch.map((e) => e.id);

    if (branch.length === 0) {
      return {
        compacted: false,
        trigger,
        strategy: null,
        quality: null,
        checkpointId: null,
        metrics: null,
        validation: null,
        reason: "Empty session — nothing to compact",
      };
    }

    // Build effective items respecting existing capsule boundaries.
    // Only items AFTER the last capsule should be considered for compaction.
    // Items before the last capsule were already compacted.
    let lastCapsule: ContextCapsuleEntry | null = null;
    let lastCapsuleIdx = -1;
    for (let i = branch.length - 1; i >= 0; i--) {
      if (isContextCapsuleEntry(branch[i] as { type: string })) {
        lastCapsule = branch[i] as unknown as ContextCapsuleEntry;
        lastCapsuleIdx = i;
        break;
      }
    }

    // Determine the starting point for effective items
    let effectiveStartIdx = 0;
    if (lastCapsule) {
      const firstKeptEntryId = lastCapsule.provenance?.firstKeptEntryId;
      if (firstKeptEntryId && firstKeptEntryId !== "root") {
        const firstKeptIdx = branch.findIndex((e) => e.id === firstKeptEntryId);
        if (firstKeptIdx >= 0) {
          effectiveStartIdx = firstKeptIdx;
        } else {
          effectiveStartIdx = lastCapsuleIdx + 1;
        }
      } else {
        effectiveStartIdx = lastCapsuleIdx + 1;
      }
    }

    // Build effective items from effectiveStartIdx onwards
    const effectiveBranch = branch.slice(effectiveStartIdx);
    const effectiveItems: ItemParam[] = [];
    for (const entry of effectiveBranch) {
      if (entry.type === "item") {
        effectiveItems.push((entry as unknown as { item: ItemParam }).item);
      }
    }

    if (effectiveItems.length === 0) {
      return {
        compacted: false,
        trigger,
        strategy: null,
        quality: null,
        checkpointId: null,
        metrics: null,
        validation: null,
        reason: "No items to compact",
      };
    }

    // Find cut point within effective branch
    const cutIdx = findCutPoint(effectiveBranch, this._config.compaction.keepRecentTokens);

    // Items before cut = compacted, items after = kept
    const compactedEntries = effectiveBranch.slice(0, cutIdx);
    const keptEntries = effectiveBranch.slice(cutIdx);

    const compactedItems: ItemParam[] = [];
    for (const entry of compactedEntries) {
      if (entry.type === "item") {
        compactedItems.push((entry as unknown as { item: ItemParam }).item);
      }
    }

    const keptItems: ItemParam[] = [];
    for (const entry of keptEntries) {
      if (entry.type === "item") {
        keptItems.push((entry as unknown as { item: ItemParam }).item);
      }
    }

    if (compactedItems.length === 0) {
      return {
        compacted: false,
        trigger,
        strategy: null,
        quality: null,
        checkpointId: null,
        metrics: null,
        validation: null,
        reason: "No items to compact (all items are in the keep window)",
      };
    }

    // Determine first compacted and first kept entry IDs
    const firstCompactedEntryId = compactedEntries.length > 0 ? compactedEntries[0].id : "root";
    const firstKeptEntryId = keptEntries.length > 0 ? keptEntries[0].id : "root";

    // Build generation input
    const generationInput: CapsuleGenerationInput = {
      sessionId: this._session.getSessionId(),
      branchEntryIds,
      sourceItems: compactedItems,
      firstCompactedEntryId,
      firstKeptEntryId,
      trigger,
      customInstructions,
      snapshotBefore: snapshot,
      provider: this._provider,
      capabilities: this._capabilities,
      activatedSkills: this._session.getActiveSkillRefs(),
    };

    // Generate capsule
    const signal = new AbortController().signal;
    const result = await this._generator.generate(
      generationInput,
      compactedItems,
      keptItems,
      isBlocking,
      signal,
    );

    // If validation failed for blocking compaction, return error
    if (isBlocking && !result.validation.valid) {
      return {
        compacted: false,
        trigger,
        strategy: result.strategyUsed,
        quality: null,
        checkpointId: null,
        metrics: result.draft.metrics,
        validation: result.validation,
        reason: `Validation failed: ${result.validation.errors.map((e) => e.message).join("; ")}`,
      };
    }

    // Append capsule to session
    const checkpointId = this._session.generateCheckpointId();
    const capsuleEntry = {
      checkpointId,
      trigger,
      strategy: result.strategyUsed,
      quality: result.draft.quality,
      portableState: result.draft.portableState,
      artifacts: result.draft.artifacts,
      activatedSkills: result.draft.activatedSkills,
      nativeContinuation: result.draft.nativeContinuation,
      provenance: result.draft.provenance,
      metrics: result.draft.metrics,
    };

    this._session.appendContextCapsule(capsuleEntry);

    return {
      compacted: true,
      trigger,
      strategy: result.strategyUsed,
      quality: result.draft.quality,
      checkpointId,
      metrics: result.draft.metrics,
      validation: result.validation,
      reason: result.validation.valid
        ? `Compaction completed using ${result.strategyUsed} strategy`
        : `Compaction completed with warnings: ${result.validation.warnings.map((w) => w.message).join("; ")}`,
    };
  }
}
