/**
 * Background compaction scheduler.
 *
 * Manages asynchronous compaction operations that run after turn completion.
 *
 * Key constraints:
 * - Only one background operation per session at a time
 * - Operation receives immutable snapshot of branch and leaf id
 * - Before append, scheduler verifies leaf id hasn't changed
 * - New user turn cancels the operation
 * - Operation timeout controlled by backgroundTimeoutMs
 * - Background failure does not modify current branch
 *
 * Spec: internal-design-notes § Background Scheduling
 */

import type { SessionPort } from "../../kernel/session/session-port";
import type { ContextManager } from "./context-manager";
import type { ContextSnapshot } from "./context-meter";
import type { CapsuleTrigger } from "./trigger-policy";

// ─── Types ───

export interface BackgroundOperation {
  id: string;
  trigger: CapsuleTrigger;
  leafId: string | null;
  snapshot: ContextSnapshot;
  startedAt: number;
  abortController: AbortController;
}

export interface SchedulerEvents {
  onOperationStarted?: (operation: BackgroundOperation) => void;
  onOperationCompleted?: (operation: BackgroundOperation, checkpointId: string | null) => void;
  onOperationCancelled?: (operation: BackgroundOperation, reason: string) => void;
  onOperationFailed?: (operation: BackgroundOperation, error: Error) => void;
}

export interface SchedulerConfig {
  backgroundTimeoutMs: number;
  events?: SchedulerEvents;
}

// ─── Scheduler ───

export class BackgroundScheduler {
  private _session: SessionPort;
  private _contextManager: ContextManager;
  private _config: SchedulerConfig;
  private _currentOperation: BackgroundOperation | null = null;
  private _operationCounter = 0;

  constructor(
    session: SessionPort,
    contextManager: ContextManager,
    config: SchedulerConfig,
  ) {
    this._session = session;
    this._contextManager = contextManager;
    this._config = config;
  }

  /**
   * Schedule a background compaction operation.
   *
   * Returns immediately. The operation runs asynchronously.
   * If an operation is already running, it is cancelled first.
   *
   * @param trigger - The trigger that initiated compaction
   * @param snapshot - Context snapshot at scheduling time
   * @param systemPromptTokens - For post-compaction validation
   * @param toolSchemaTokens - For post-compaction validation
   * @param requestFingerprint - For post-compaction validation
   */
  schedule(
    trigger: CapsuleTrigger,
    snapshot: ContextSnapshot,
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): void {
    // Cancel any existing operation
    if (this._currentOperation) {
      this.cancel("New operation scheduled");
    }

    const leafId = this._session.getLeafId();
    const operationId = `bg_${++this._operationCounter}_${Date.now()}`;
    const abortController = new AbortController();

    const operation: BackgroundOperation = {
      id: operationId,
      trigger,
      leafId,
      snapshot,
      startedAt: Date.now(),
      abortController,
    };

    this._currentOperation = operation;
    this._config.events?.onOperationStarted?.(operation);

    // Run asynchronously
    this._runOperation(
      operation,
      systemPromptTokens,
      toolSchemaTokens,
      requestFingerprint,
    ).catch((error) => {
      // Errors are handled in _runOperation, but catch here to prevent unhandled rejection
      console.error("[BackgroundScheduler] Unexpected error:", error);
    });
  }

  /**
   * Cancel the current background operation (if any).
   *
   * Called when a new user turn starts.
   */
  cancel(reason: string): void {
    if (!this._currentOperation) {
      return;
    }

    const operation = this._currentOperation;
    operation.abortController.abort();
    this._currentOperation = null;
    this._config.events?.onOperationCancelled?.(operation, reason);
  }

  /**
   * Check if a background operation is currently running.
   */
  isRunning(): boolean {
    return this._currentOperation !== null;
  }

  /**
   * Get the current operation (if any).
   */
  getCurrentOperation(): BackgroundOperation | null {
    return this._currentOperation;
  }

  // ─── Private ───

  /**
   * Execute the background compaction operation.
   *
   * Uses Promise.race to handle timeout and cancellation:
   * - compactionPromise: the actual compaction work
   * - abortPromise: resolves when the abort signal fires (cancel/timeout)
   */
  private async _runOperation(
    operation: BackgroundOperation,
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): Promise<void> {
    // Check if already cancelled
    if (operation.abortController.signal.aborted) {
      if (this._currentOperation?.id === operation.id) {
        this._currentOperation = null;
      }
      return;
    }

    // Create abort promise that resolves when signal fires
    const abortPromise = new Promise<"aborted">((resolve) => {
      const onAbort = () => resolve("aborted" as const);
      if (operation.abortController.signal.aborted) {
        resolve("aborted" as const);
        return;
      }
      operation.abortController.signal.addEventListener("abort", onAbort, { once: true });
    });

    // Create timeout that fires the abort signal
    const timeoutId = setTimeout(() => {
      if (this._currentOperation?.id === operation.id) {
        operation.abortController.abort();
      }
    }, this._config.backgroundTimeoutMs);

    try {
      // Pre-compaction leaf check: ensure no new items were added since scheduling
      const leafBeforeCompaction = this._session.getLeafId();
      if (leafBeforeCompaction !== operation.leafId) {
        // Leaf changed before compaction started — abort
        clearTimeout(timeoutId);
        if (this._currentOperation?.id === operation.id) {
          this._currentOperation = null;
        }
        this._config.events?.onOperationFailed?.(
          operation,
          new Error(`Leaf changed before compaction: ${operation.leafId} → ${leafBeforeCompaction}`),
        );
        return;
      }

      // Race: compaction vs abort
      void systemPromptTokens;
      void toolSchemaTokens;
      void requestFingerprint;
      const compactionPromise = this._contextManager.compactScheduled(operation.trigger, operation.snapshot);

      const result = await Promise.race([
        compactionPromise.then((outcome) => ({ type: "completed" as const, outcome })),
        abortPromise.then(() => ({ type: "aborted" as const })),
      ]);

      clearTimeout(timeoutId);

      if (result.type === "aborted") {
        // Operation was cancelled or timed out
        if (this._currentOperation?.id === operation.id) {
          this._currentOperation = null;
        }
        return;
      }

      const outcome = result.outcome;

      // Success — the capsule was appended by ContextManager,
      // which changes the leaf. This is expected behavior.
      // The stale leaf check was already done before compaction started.
      if (this._currentOperation?.id === operation.id) {
        this._currentOperation = null;
      }
      this._config.events?.onOperationCompleted?.(operation, outcome.checkpointId);
    } catch (error) {
      clearTimeout(timeoutId);

      if (this._currentOperation?.id === operation.id) {
        this._currentOperation = null;
      }

      // Don't emit failure for cancellations
      if (operation.abortController.signal.aborted) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      this._config.events?.onOperationFailed?.(operation, err);
    }
  }
}
