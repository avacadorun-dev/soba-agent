/**
 * @deprecated Compaction is no longer generated in the background.
 *
 * This compatibility shim can retain one immutable intent for older hosts. New
 * code stores intent in ContextController and executes it at the preflight
 * barrier. In particular, schedule() never calls ContextManager or starts a
 * promise, timer, or generator.
 */

import type { SessionPort } from "../../kernel/session/session-port";
import type { ContextManager } from "./context-manager";
import type { ContextSnapshot } from "./context-meter";
import type { CapsuleTrigger } from "./trigger-policy";

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

export class BackgroundScheduler {
  private pending: BackgroundOperation | null = null;
  private sequence = 0;
  private readonly session: SessionPort;
  private readonly config: SchedulerConfig;

  constructor(
    session: SessionPort,
    _contextManager: ContextManager,
    config: SchedulerConfig,
  ) {
    this.session = session;
    this.config = config;
  }

  schedule(
    trigger: CapsuleTrigger,
    snapshot: ContextSnapshot,
    _systemPromptTokens: number,
    _toolSchemaTokens: number,
    _requestFingerprint: string,
  ): void {
    if (this.pending) this.cancel("New intent scheduled");
    this.pending = Object.freeze({
      id: `deferred_${++this.sequence}_${Date.now()}`,
      trigger,
      leafId: this.session.getLeafId(),
      snapshot: Object.freeze({ ...snapshot }),
      startedAt: Date.now(),
      abortController: new AbortController(),
    });
  }

  cancel(reason: string): void {
    if (!this.pending) return;
    const operation = this.pending;
    this.pending = null;
    operation.abortController.abort(reason);
    this.config.events?.onOperationCancelled?.(operation, reason);
  }

  /** Background work is never running in the preflight architecture. */
  isRunning(): boolean {
    return false;
  }

  /** Returns the retained compatibility intent without consuming it. */
  getCurrentOperation(): BackgroundOperation | null {
    return this.pending;
  }

  takePendingOperation(): BackgroundOperation | null {
    const operation = this.pending;
    this.pending = null;
    return operation;
  }
}
