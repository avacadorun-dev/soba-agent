import type { ResponseResource } from "../../core/client/types";
import type {
  ContextManager,
  OverflowRecoveryResult,
  PreInferenceCheckResult,
} from "../../core/compaction/context-manager";
import type { BackgroundScheduler } from "../../core/compaction/scheduler";
import type { CapsuleTrigger } from "../../core/compaction/trigger-policy";
import type { AgentEvent } from "../../core/loop/types";

export interface ContextControllerOptions {
  contextManager?: ContextManager;
  backgroundScheduler?: BackgroundScheduler;
  autoCompactEnabled?: () => boolean;
  emit?: (event: AgentEvent) => void;
}

export interface ContextRequestMetrics {
  systemPromptTokens: number;
  toolSchemaTokens: number;
  requestFingerprint: string;
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

export class ContextController {
  private readonly contextManager?: ContextManager;
  private readonly backgroundScheduler?: BackgroundScheduler;
  private readonly autoCompactEnabled: () => boolean;
  private readonly emit: (event: AgentEvent) => void;

  constructor(options: ContextControllerOptions = {}) {
    this.contextManager = options.contextManager;
    this.backgroundScheduler = options.backgroundScheduler;
    this.autoCompactEnabled = options.autoCompactEnabled ?? (() => true);
    this.emit = options.emit ?? (() => {});
  }

  cancelBackgroundCompaction(reason: string): void {
    if (this.backgroundScheduler?.isRunning()) {
      this.backgroundScheduler.cancel(reason);
    }
  }

  async performPreInferenceCheck(metrics: ContextRequestMetrics): Promise<PreInferenceCheckResult> {
    if (!this.contextManager) {
      return { canProceed: true, compactionPerformed: false };
    }

    const checkResult = await this.contextManager.preInferenceCheck(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );

    if (checkResult.compactionPerformed && checkResult.outcome) {
      this.emitCompactionStart("pre_inference", checkResult.outcome.metrics?.effectiveTokensBefore ?? 0);
      this.emitCompactionDone("pre_inference", checkResult.outcome);
    }

    if (!checkResult.canProceed) {
      this.emit({
        type: "context_error",
        timestamp: Date.now(),
        error: checkResult.error ?? "Pre-inference check failed",
        effectiveTokens: 0,
        hardLimit: 0,
        recoveryAttempted: checkResult.compactionPerformed,
      });
    }

    return checkResult;
  }

  async recoverContextOverflow(metrics: ContextRequestMetrics): Promise<OverflowRecoveryResult> {
    if (!this.contextManager) {
      return { recovered: false, shouldRetry: false, error: "Context manager is not configured." };
    }

    this.emit({
      type: "compaction_start",
      timestamp: Date.now(),
      reason: "overflow_recovery",
      effectiveTokens: 0,
      hardLimit: 0,
    });

    const recoveryResult = await this.contextManager.handleContextOverflow(
      metrics.systemPromptTokens,
      metrics.toolSchemaTokens,
      metrics.requestFingerprint,
    );

    if (recoveryResult.outcome) {
      this.emitCompactionDone("overflow_recovery", recoveryResult.outcome);
    }

    if (!recoveryResult.recovered || !recoveryResult.shouldRetry) {
      this.emit({
        type: "context_error",
        timestamp: Date.now(),
        error: recoveryResult.error ?? "Context overflow recovery failed",
        effectiveTokens: 0,
        hardLimit: 0,
        recoveryAttempted: true,
      });
    }

    return recoveryResult;
  }

  recordProviderUsage(response: ResponseResource, requestFingerprint: string): void {
    if (!this.contextManager || !response.usage) return;
    this.contextManager.recordProviderUsage(response.usage.input_tokens, null, requestFingerprint);
  }

  getEffectiveContextTokens(metrics: ContextRequestMetrics): number | undefined {
    if (!this.contextManager) return undefined;
    try {
      return this.contextManager.getSnapshot(
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
    const milestone = [...input.checkpointEvents].reverse().find((event) => event.kind === "milestone");
    if (!milestone || !this.contextManager || !this.backgroundScheduler || !this.autoCompactEnabled()) {
      return { evaluated: false, shouldCompact: false };
    }

    const { shouldCompact, snapshot } = this.contextManager.evaluateMilestone(
      input.metrics.systemPromptTokens,
      input.metrics.toolSchemaTokens,
      input.metrics.requestFingerprint,
    );

    if (shouldCompact) {
      this.backgroundScheduler.schedule(
        "milestone",
        snapshot,
        input.metrics.systemPromptTokens,
        input.metrics.toolSchemaTokens,
        input.metrics.requestFingerprint,
      );
    }

    return {
      evaluated: true,
      shouldCompact,
      trigger: "milestone",
      reason: milestone.reason,
    };
  }

  scheduleTurnComplete(input: {
    responseStatus: ResponseResource["status"] | undefined;
    errorCount: number;
    metrics: ContextRequestMetrics;
  }): ScheduleDecision {
    if (
      !this.contextManager ||
      !this.backgroundScheduler ||
      input.responseStatus !== "completed" ||
      input.errorCount !== 0 ||
      !this.autoCompactEnabled()
    ) {
      return { evaluated: false, shouldCompact: false };
    }

    const { shouldCompact, snapshot } = this.contextManager.evaluateTurnComplete(
      input.metrics.systemPromptTokens,
      input.metrics.toolSchemaTokens,
      input.metrics.requestFingerprint,
    );

    if (shouldCompact) {
      this.backgroundScheduler.schedule(
        "turn_complete",
        snapshot,
        input.metrics.systemPromptTokens,
        input.metrics.toolSchemaTokens,
        input.metrics.requestFingerprint,
      );
    }

    return {
      evaluated: true,
      shouldCompact,
      trigger: "turn_complete",
    };
  }

  private emitCompactionStart(
    reason: "pre_inference" | "overflow_recovery",
    effectiveTokens: number,
  ): void {
    this.emit({
      type: "compaction_start",
      timestamp: Date.now(),
      reason,
      effectiveTokens,
      hardLimit: 0,
    });
  }

  private emitCompactionDone(
    reason: "pre_inference" | "overflow_recovery",
    outcome: NonNullable<PreInferenceCheckResult["outcome"]>,
  ): void {
    this.emit({
      type: "compaction_done",
      timestamp: Date.now(),
      reason,
      tokensBefore: outcome.metrics?.effectiveTokensBefore ?? 0,
      tokensAfter: outcome.metrics?.estimatedTokensAfter ?? 0,
      tokensSaved: outcome.metrics?.reclaimedTokens ?? 0,
      strategy: outcome.strategy ?? "unknown",
    });
  }
}
