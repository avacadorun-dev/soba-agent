/**
 * ContextManager — orchestrates context compaction lifecycle.
 *
 * Responsibilities:
 * 1. Pre-inference hard limit check (blocking compaction)
 * 2. Context overflow recovery (emergency compact + retry)
 * 3. Manual /compact command (/compact [instructions])
 * 4. Deferred preflight compaction trigger (turn_complete, milestone)
 *
 * The manager coordinates:
 * - ContextMeter (snapshot)
 * - TriggerPolicy (when to compact)
 * - CapsuleGenerator (how to compact)
 * - CapsuleValidator (validate draft)
 * - SessionPort (append capsule)
 *
 * Spec: internal-design-notes
 */

import { type ContextCapsuleMemorySink, contextCapsuleToMemoryInput } from "../../kernel/memory/context-capsule";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ItemParam } from "../../kernel/transcript/types";
import type {
  ContextCapsuleEntry,
  ProviderCapabilities,
  ProviderIdentity,
} from "../../kernel/transcript/types-v2";
import { isContextCapsuleEntry } from "../../kernel/transcript/types-v2";
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
  memory?: ContextCapsuleMemorySink;
}

export type CompactionOutcomeStatus = "completed" | "skipped" | "cancelled" | "stale" | "failed";

export interface CompactionOutcome {
  status: CompactionOutcomeStatus;
  /** The trigger that caused compaction */
  trigger: CapsuleTrigger;
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
  /** Stable identifier shared by lifecycle events. */
  operationId: string;
  /** Wall-clock duration of this attempt. */
  durationMs: number;
  /** Whether failure must prevent the model call. */
  required: boolean;
  /** Error text without any generated summary contents. */
  error?: string;
}

export interface CompactionPlan {
  readonly operationId: string;
  readonly trigger: CapsuleTrigger;
  readonly snapshot: Readonly<ContextSnapshot>;
  readonly expectedLeafId: string | null;
  readonly required: boolean;
  readonly estimatedReclaimableTokens: number;
  readonly estimatedSavingsRatio: number;
  readonly customInstructions?: string;
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
  private _session: SessionPort;
  private _meter: ContextMeter;
  private _policy: TriggerPolicy;
  private _generator: CapsuleGenerator;
  private _provider: ProviderIdentity;
  private _capabilities: ProviderCapabilities;
  private _config: ContextManagerConfig;
  private _memory?: ContextCapsuleMemorySink;
  /** Cached last snapshot for reactive sidebar access (set via getSnapshot). */
  private _lastSnapshot: ContextSnapshot | null = null;
  private _lastOutcome: CompactionOutcome | null = null;
  private _operationSequence = 0;
  private _operationTail: Promise<void> = Promise.resolve();

  constructor(session: SessionPort, config: ContextManagerConfig) {
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
    this._memory = config.memory;
  }

  createPlan(input: {
    trigger: CapsuleTrigger;
    snapshot: ContextSnapshot;
    required: boolean;
    estimatedReclaimableTokens?: number;
    estimatedSavingsRatio?: number;
    customInstructions?: string;
  }): CompactionPlan {
    const snapshot = Object.freeze({
      ...input.snapshot,
      ...(input.snapshot.watermark
        ? { watermark: Object.freeze({ ...input.snapshot.watermark }) }
        : {}),
    });
    return Object.freeze({
      operationId: `${this._session.getSessionId()}:compact:${Date.now()}:${++this._operationSequence}`,
      trigger: input.trigger,
      snapshot,
      expectedLeafId: this._session.getLeafId(),
      required: input.required,
      estimatedReclaimableTokens: input.estimatedReclaimableTokens ?? 0,
      estimatedSavingsRatio: input.estimatedSavingsRatio ?? 0,
      customInstructions: input.customInstructions,
    });
  }

  /** Execute a frozen plan behind the per-session compaction gate. */
  async executePlan(plan: CompactionPlan, signal?: AbortSignal): Promise<CompactionOutcome> {
    const previous = this._operationTail;
    let release!: () => void;
    this._operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const outcome = await this._performCompaction(plan, signal);
      this._lastOutcome = outcome;
      return outcome;
    } finally {
      release();
    }
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
    const decision = this._policy.evaluateHardLimit(snapshot);
    const outcome = await this.executePlan(this.createPlan({
      snapshot,
      trigger: "hard_limit",
      required: true,
      estimatedReclaimableTokens: decision.estimatedReclaimableTokens,
      estimatedSavingsRatio: decision.estimatedSavingsRatio,
    }));

    if (outcome.status !== "completed") {
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

    const decision = this._policy.evaluateContextOverflow(snapshot);
    const outcome = await this.executePlan(this.createPlan({
      snapshot,
      trigger: "context_overflow",
      required: true,
      estimatedReclaimableTokens: decision.estimatedReclaimableTokens,
      estimatedSavingsRatio: decision.estimatedSavingsRatio,
    }));

    if (outcome.status !== "completed") {
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
    signal?: AbortSignal,
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
        status: "skipped",
        trigger: "user_request",
        strategy: null,
        quality: null,
        checkpointId: null,
        metrics: null,
        validation: null,
        reason: decision.reason,
        operationId: `${this._session.getSessionId()}:compact:${Date.now()}:${++this._operationSequence}`,
        durationMs: 0,
        required: false,
      };
    }

    return this.executePlan(this.createPlan({
      snapshot,
      trigger: "user_request",
      required: false,
      estimatedReclaimableTokens: decision.estimatedReclaimableTokens,
      estimatedSavingsRatio: decision.estimatedSavingsRatio,
      customInstructions,
    }), signal);
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
    return this.executePlan(this.createPlan({ snapshot, trigger, required: false }));
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
    softLimit: number;
    lastCompact: null | {
      status: CompactionOutcomeStatus;
      trigger: CapsuleTrigger;
      checkpointId: string | null;
      durationMs: number;
      reclaimedTokens: number;
    };
  } {
    const snapshot = this._lastSnapshot ?? {
      hardLimit: this._meter.hardLimit,
    } as ContextSnapshot;
    const persistedCapsule = [...this._session.getEntries()]
      .reverse()
      .find((entry): entry is ContextCapsuleEntry => isContextCapsuleEntry(entry));
    const lastCompact = this._lastOutcome ? {
      status: this._lastOutcome.status,
      trigger: this._lastOutcome.trigger,
      checkpointId: this._lastOutcome.checkpointId,
      durationMs: this._lastOutcome.durationMs,
      reclaimedTokens: this._lastOutcome.metrics?.reclaimedTokens ?? 0,
    } : persistedCapsule ? {
      status: "completed" as const,
      trigger: persistedCapsule.trigger,
      checkpointId: persistedCapsule.checkpointId,
      durationMs: persistedCapsule.metrics.generationDurationMs,
      reclaimedTokens: persistedCapsule.metrics.reclaimedTokens,
    } : null;
    return {
      source: this._meter.watermark ? "provider_usage" : "estimated",
      safetyReserveTokens: this._meter.safetyReserveTokens,
      maxOutputTokens: this._meter.maxOutputTokens,
      contextWindow: this._meter.contextWindow,
      hardLimit: this._meter.hardLimit,
      effectiveTokens: this._lastSnapshot?.effectiveTokens ?? 0,
      softLimit: this._policy.getSoftLimit(snapshot),
      lastCompact,
    };
  }

  // ─── Private: perform compaction ───

  /**
   * Perform compaction using the configured strategy chain.
   */
  private async _performCompaction(
    plan: CompactionPlan,
    externalSignal?: AbortSignal,
  ): Promise<CompactionOutcome> {
    const startedAt = Date.now();
    const { snapshot, trigger } = plan;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Compaction timed out after ${this._config.compaction.timeoutMs}ms`)),
      this._config.compaction.timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardAbort);
    };

    if (controller.signal.aborted) {
      cleanup();
      return this._makeOutcome(plan, "cancelled", startedAt, { reason: "Compaction cancelled before generation" });
    }

    const branch = this._session.getBranch();
    const branchEntryIds = branch.map((e) => e.id);

    if (branch.length === 0) {
      cleanup();
      return this._makeOutcome(plan, "skipped", startedAt, { reason: "Empty session — nothing to compact" });
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
      cleanup();
      return this._makeOutcome(plan, "skipped", startedAt, { reason: "No items to compact" });
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
      cleanup();
      return this._makeOutcome(plan, "skipped", startedAt, {
        reason: "No items to compact (all items are in the keep window)",
      });
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
      customInstructions: plan.customInstructions,
      snapshotBefore: snapshot,
      provider: this._provider,
      capabilities: this._capabilities,
      activatedSkills: this._session.getActiveSkillRefs(),
      previousPortableState: lastCapsule?.portableState,
    };

    try {
      if (this._session.getLeafId() !== plan.expectedLeafId) {
        return this._makeOutcome(plan, "stale", startedAt, {
          reason: "Session leaf changed before capsule generation",
        });
      }

      const generation = this._generator.generate(
        generationInput,
        compactedItems,
        keptItems,
        plan.required,
        controller.signal,
      );
      const result = await raceWithAbort(generation, controller.signal);

      // The generator may ignore cancellation. Never append after the barrier was cancelled.
      if (controller.signal.aborted) {
        return this._makeOutcome(plan, "cancelled", startedAt, {
          reason: abortReason(controller.signal),
        });
      }

      // Compare-and-append: a capsule is valid only for the exact leaf captured by the plan.
      if (this._session.getLeafId() !== plan.expectedLeafId) {
        return this._makeOutcome(plan, "stale", startedAt, {
          strategy: result.strategyUsed,
          metrics: result.draft.metrics,
          validation: result.validation,
          reason: "Session leaf changed while capsule was being generated",
        });
      }

      if (plan.required && !result.validation.valid) {
        return this._makeOutcome(plan, "failed", startedAt, {
          strategy: result.strategyUsed,
          metrics: result.draft.metrics,
          validation: result.validation,
          reason: `Validation failed: ${result.validation.errors.map((e) => e.message).join("; ")}`,
        });
      }

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

      const entryId = this._session.appendContextCapsule(capsuleEntry);
      // Provider usage measured the request before this capsule changed its
      // effective history. Reusing that baseline makes the post-check see the
      // pre-compaction token count and can falsely fail a hard-limit barrier.
      this._meter.invalidateWatermark();
      this._writeMemoryMirror(entryId);

      return this._makeOutcome(plan, "completed", startedAt, {
        strategy: result.strategyUsed,
        quality: result.draft.quality,
        checkpointId,
        metrics: result.draft.metrics,
        validation: result.validation,
        reason: result.validation.valid
          ? `Compaction completed using ${result.strategyUsed} strategy`
          : `Compaction completed with warnings: ${result.validation.warnings.map((w) => w.message).join("; ")}`,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      return this._makeOutcome(plan, cancelled ? "cancelled" : "failed", startedAt, {
        reason: cancelled ? abortReason(controller.signal) : "Capsule generation failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cleanup();
    }
  }

  private _makeOutcome(
    plan: CompactionPlan,
    status: CompactionOutcomeStatus,
    startedAt: number,
    values: Partial<Pick<CompactionOutcome, "strategy" | "quality" | "checkpointId" | "metrics" | "validation" | "reason" | "error">>,
  ): CompactionOutcome {
    return {
      status,
      trigger: plan.trigger,
      strategy: values.strategy ?? null,
      quality: values.quality ?? null,
      checkpointId: values.checkpointId ?? null,
      metrics: values.metrics ?? null,
      validation: values.validation ?? null,
      reason: values.reason ?? status,
      operationId: plan.operationId,
      durationMs: Math.max(0, Date.now() - startedAt),
      required: plan.required,
      ...(values.error ? { error: values.error } : {}),
    };
  }

  private _writeMemoryMirror(entryId: string): void {
    if (!this._memory) return;
    const entry = this._session
      .getEntries()
      .find((candidate): candidate is ContextCapsuleEntry => candidate.id === entryId && isContextCapsuleEntry(candidate));
    if (!entry) return;
    // A degraded deterministic capsule is safe for in-session continuity, but
    // too noisy to become durable cross-session project memory automatically.
    if (entry.quality === "degraded") return;
    try {
      this._memory.addCapsule(contextCapsuleToMemoryInput(entry, this._session.getSessionId()));
    } catch {
      // Memory mirrors are advisory; a storage failure must not invalidate the session capsule.
    }
  }
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("Compaction cancelled");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Compaction cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): string {
  return signal.reason instanceof Error ? signal.reason.message : "Compaction cancelled";
}
