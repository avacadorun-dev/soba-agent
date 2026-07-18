import type { CapsuleTrigger } from "../../kernel/compaction/config";
import type { ResponseResource } from "../../kernel/model/openresponses-types";
import type {
  CompactionOutcome,
  CompactionPlan,
  ContextManager,
  OverflowRecoveryResult,
  PreInferenceCheckResult,
} from "../compaction/context-manager";
import type { TriggerDecision } from "../compaction/trigger-policy";
import type { AgentEvent } from "../turn/types";

export interface ContextControllerOptions {
  contextManager?: ContextManager;
  autoCompactEnabled?: () => boolean;
  emit?: (event: AgentEvent) => void;
}

export interface ContextRequestMetrics {
  systemPromptTokens: number;
  toolSchemaTokens: number;
  requestFingerprint: string;
  turnIndex?: number;
}

export interface CheckpointLikeEvent {
  kind: "milestone" | "plan_pivot";
  reason: string;
}

export interface ScheduleDecision {
  evaluated: boolean;
  shouldCompact: boolean;
  trigger?: CapsuleTrigger;
  reason?: string;
}

interface PendingTrigger {
  trigger: "turn_complete" | "milestone" | "plan_pivot";
  reason?: string;
}

/**
 * Owns deferred compaction intent. No capsule generation happens here until the
 * next pre-inference barrier explicitly awaits it.
 */
export class ContextController {
  private readonly contextManager?: ContextManager;
  private readonly autoCompactEnabled: () => boolean;
  private readonly emit: (event: AgentEvent) => void;
  private pendingTrigger: PendingTrigger | null = null;
  private lastSoftAttemptTurn: number | string | null = null;
  private overflowAttemptTurns = new Set<number | string>();

  constructor(options: ContextControllerOptions = {}) {
    this.contextManager = options.contextManager;
    this.autoCompactEnabled = options.autoCompactEnabled ?? (() => true);
    this.emit = options.emit ?? (() => {});
  }

  /** @deprecated Background compaction no longer exists; retained for host compatibility. */
  cancelBackgroundCompaction(_reason: string): void {}

  async performPreInferenceCheck(
    metrics: ContextRequestMetrics,
    signal?: AbortSignal,
  ): Promise<PreInferenceCheckResult> {
    if (!this.contextManager) return { canProceed: true, compactionPerformed: false };

    const snapshot = this.contextManager.getSnapshot(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );
    const policy = this.contextManager.getPolicy();
    const hardDecision = policy.evaluateHardLimit(snapshot);
    let decision: TriggerDecision | null = hardDecision.shouldCompact ? hardDecision : null;
    let trigger: CapsuleTrigger | null = decision?.trigger ?? null;
    let required = hardDecision.shouldCompact;
    const turnKey = metrics.turnIndex ?? metrics.requestFingerprint;
    if (typeof turnKey === "number") {
      for (const attemptedTurn of this.overflowAttemptTurns) {
        if (typeof attemptedTurn === "number" && attemptedTurn !== turnKey) this.overflowAttemptTurns.delete(attemptedTurn);
      }
    }

    if (!required && !this.autoCompactEnabled()) this.pendingTrigger = null;

    if (!required && this.autoCompactEnabled() && this.lastSoftAttemptTurn !== turnKey) {
      const pending = this.consumePendingTrigger();
      if (pending) {
        decision = pending.trigger === "turn_complete"
          ? policy.evaluateTurnComplete(snapshot)
          : policy.evaluateMilestone(snapshot);
        if (decision.shouldCompact) trigger = pending.trigger;
      }
      if (!decision?.shouldCompact) {
        decision = policy.evaluateAutoThreshold(snapshot);
        trigger = decision.trigger;
      }
    }

    if (!decision?.shouldCompact || !trigger) {
      return { canProceed: true, compactionPerformed: false };
    }

    if (!required) this.lastSoftAttemptTurn = turnKey;
    const plan = this.contextManager.createPlan({
      trigger,
      snapshot,
      required,
      estimatedReclaimableTokens: decision.estimatedReclaimableTokens,
      estimatedSavingsRatio: decision.estimatedSavingsRatio,
    });
    this.emitStart(plan);
    const outcome = await this.contextManager.executePlan(plan, signal);
    const postSnapshot = this.contextManager.getSnapshot(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );
    this.emitOutcome(plan, outcome, postSnapshot.effectiveTokens);

    if (outcome.status === "completed" && postSnapshot.effectiveTokens <= postSnapshot.hardLimit) {
      return { canProceed: true, compactionPerformed: true, outcome };
    }

    // A soft barrier is advisory: warn through its terminal event and continue
    // whenever the actual request remains below the mandatory hard limit.
    if (!required && postSnapshot.effectiveTokens <= postSnapshot.hardLimit) {
      return { canProceed: true, compactionPerformed: false, outcome };
    }

    const error = outcome.status === "completed"
      ? `Post-compaction effective tokens (${postSnapshot.effectiveTokens}) still exceed hard limit (${postSnapshot.hardLimit}).`
      : outcome.reason;
    this.emitContextError(error, postSnapshot.effectiveTokens, postSnapshot.hardLimit, true);
    return { canProceed: false, compactionPerformed: outcome.status === "completed", error, outcome };
  }

  async recoverContextOverflow(
    metrics: ContextRequestMetrics,
    signal?: AbortSignal,
  ): Promise<OverflowRecoveryResult> {
    if (!this.contextManager) {
      return { recovered: false, shouldRetry: false, error: "Context manager is not configured." };
    }
    const turnKey = metrics.turnIndex ?? metrics.requestFingerprint;
    if (this.overflowAttemptTurns.has(turnKey)) {
      const error = "Context overflow recovery already attempted for this turn.";
      this.emitContextError(error, 0, 0, true);
      return { recovered: false, shouldRetry: false, error };
    }
    this.overflowAttemptTurns.add(turnKey);

    const snapshot = this.contextManager.getSnapshot(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );
    const decision = this.contextManager.getPolicy().evaluateContextOverflow(snapshot);
    const plan = this.contextManager.createPlan({
      trigger: "context_overflow",
      snapshot,
      required: true,
      estimatedReclaimableTokens: decision.estimatedReclaimableTokens,
      estimatedSavingsRatio: decision.estimatedSavingsRatio,
    });
    this.emitStart(plan);
    const outcome = await this.contextManager.executePlan(plan, signal);
    const postSnapshot = this.contextManager.getSnapshot(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );
    this.emitOutcome(plan, outcome, postSnapshot.effectiveTokens);

    if (outcome.status === "completed" && postSnapshot.effectiveTokens <= postSnapshot.hardLimit) {
      return { recovered: true, shouldRetry: true, outcome };
    }
    const error = outcome.status === "completed"
      ? `Emergency compaction freed insufficient context. Post-compaction: ${postSnapshot.effectiveTokens}, hard limit: ${postSnapshot.hardLimit}`
      : outcome.reason;
    this.emitContextError(error, postSnapshot.effectiveTokens, postSnapshot.hardLimit, true);
    return { recovered: false, shouldRetry: false, outcome, error };
  }

  recordProviderUsage(
    response: ResponseResource,
    requestFingerprint: string,
    measuredThroughEntryId: string | null = null,
  ): void {
    if (!this.contextManager || !response.usage) return;
    this.contextManager.recordProviderUsage(response.usage.input_tokens, measuredThroughEntryId, requestFingerprint);
  }

  getEffectiveContextTokens(metrics: ContextRequestMetrics): number | undefined {
    try {
      return this.contextManager?.getSnapshot(
        metrics.systemPromptTokens,
        metrics.toolSchemaTokens,
        metrics.requestFingerprint,
      ).effectiveTokens;
    } catch {
      return undefined;
    }
  }

  scheduleLatestMilestone(input: {
    checkpointEvents: CheckpointLikeEvent[];
    metrics: ContextRequestMetrics;
  }): ScheduleDecision {
    const checkpoint = [...input.checkpointEvents].reverse()
      .find((event) => event.kind === "milestone" || event.kind === "plan_pivot");
    if (!checkpoint || !this.contextManager || !this.autoCompactEnabled()) {
      return { evaluated: false, shouldCompact: false };
    }
    this.markPending({ trigger: checkpoint.kind, reason: checkpoint.reason });
    return { evaluated: true, shouldCompact: true, trigger: checkpoint.kind, reason: checkpoint.reason };
  }

  scheduleTurnComplete(input: {
    responseStatus: ResponseResource["status"] | undefined;
    errorCount: number;
    metrics: ContextRequestMetrics;
  }): ScheduleDecision {
    if (!this.contextManager || input.responseStatus !== "completed" || input.errorCount !== 0 || !this.autoCompactEnabled()) {
      return { evaluated: false, shouldCompact: false };
    }
    this.markPending({ trigger: "turn_complete" });
    return { evaluated: true, shouldCompact: true, trigger: "turn_complete" };
  }

  getPendingTrigger(): CapsuleTrigger | null {
    return this.pendingTrigger?.trigger ?? null;
  }

  private markPending(next: PendingTrigger): void {
    const priority = (trigger: PendingTrigger["trigger"]) => trigger === "turn_complete" ? 1 : 2;
    if (!this.pendingTrigger || priority(next.trigger) >= priority(this.pendingTrigger.trigger)) {
      this.pendingTrigger = next;
    }
  }

  private consumePendingTrigger(): PendingTrigger | null {
    const pending = this.pendingTrigger;
    this.pendingTrigger = null;
    return pending;
  }

  private emitStart(plan: CompactionPlan): void {
    const softLimit = this.contextManager?.getPolicy().getSoftLimit(plan.snapshot) ?? 0;
    this.emit({
      type: "compaction_start",
      timestamp: Date.now(),
      operationId: plan.operationId,
      trigger: plan.trigger,
      reason: legacyReason(plan.trigger),
      tokensBefore: plan.snapshot.effectiveTokens,
      effectiveTokens: plan.snapshot.effectiveTokens,
      softLimit,
      hardLimit: plan.snapshot.hardLimit,
      required: plan.required,
      source: plan.snapshot.source,
      checkpointId: null,
      quality: null,
      strategy: null,
      durationMs: 0,
      reclaimedTokens: 0,
    });
  }

  private emitOutcome(plan: CompactionPlan, outcome: CompactionOutcome, measuredTokensAfter: number): void {
    const tokensAfter = outcome.metrics?.estimatedTokensAfter ?? measuredTokensAfter;
    const reclaimedTokens = outcome.metrics?.reclaimedTokens
      ?? Math.max(0, plan.snapshot.effectiveTokens - tokensAfter);
    const softLimit = this.contextManager?.getPolicy().getSoftLimit(plan.snapshot) ?? 0;
    if (outcome.status === "completed") {
      this.emit({
        type: "compaction_done",
        timestamp: Date.now(),
        operationId: plan.operationId,
        trigger: plan.trigger,
        reason: legacyReason(plan.trigger),
        tokensBefore: plan.snapshot.effectiveTokens,
        tokensAfter,
        tokensSaved: reclaimedTokens,
        reclaimedTokens,
        strategy: outcome.strategy ?? "unknown",
        quality: outcome.quality,
        checkpointId: outcome.checkpointId,
        durationMs: outcome.durationMs,
        softLimit,
        hardLimit: plan.snapshot.hardLimit,
        required: plan.required,
      });
      return;
    }
    const type = outcome.status === "cancelled"
      ? "compaction_cancelled"
      : outcome.status === "failed"
        ? "compaction_failed"
        : "compaction_skipped";
    this.emit({
      type,
      timestamp: Date.now(),
      operationId: plan.operationId,
      trigger: plan.trigger,
      reason: outcome.reason,
      tokensBefore: plan.snapshot.effectiveTokens,
      tokensAfter,
      reclaimedTokens,
      durationMs: outcome.durationMs,
      softLimit,
      hardLimit: plan.snapshot.hardLimit,
      required: plan.required,
      checkpointId: null,
      quality: null,
      strategy: outcome.strategy,
    });
  }

  private emitContextError(error: string, effectiveTokens: number, hardLimit: number, recoveryAttempted: boolean): void {
    this.emit({ type: "context_error", timestamp: Date.now(), error, effectiveTokens, hardLimit, recoveryAttempted });
  }
}

function legacyReason(trigger: CapsuleTrigger): "pre_inference" | "overflow_recovery" | "manual" {
  if (trigger === "context_overflow") return "overflow_recovery";
  if (trigger === "user_request") return "manual";
  return "pre_inference";
}
