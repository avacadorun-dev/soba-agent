/**
 * Agent Loop.
 *
 * Backward-compatible facade for the SOBA agent turn runtime.
 *
 * AgentLoop keeps legacy constructor/getter APIs for hosts and delegates the
 * actual turn orchestration to agent-turn-runner.
 */

import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import type { Usage } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolContext, ToolResult } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
} from "../../kernel/transcript/types";
import { BudgetTracker } from "../budget/budget-tracker";
import type { ContextManager } from "../compaction/context-manager";
import type { BackgroundScheduler } from "../compaction/scheduler";
import type { EvidenceProofSink } from "../evidence";
import type { ProjectMemorySource } from "../memory/memory-injector";
import type { TrustController } from "../permissions/trust-controller";
import type { ProjectCommandFileReader } from "../verification/types";
import {
  type AgentLoopRuntimeServices,
  createAgentLoopRuntime,
} from "./agent-loop-runtime";
import { runAgentTurn } from "./agent-turn-runner";
import type { SkillSource } from "./skill-source";
import type { ProjectContextReader } from "./turn-prompt-preparation";
import {
  type AgentEvent,
  type AgentLoopOptions,
  type AgentTurnResult,
} from "./types";

export { createUserItem } from "./turn-helpers";
export type { ProjectContextReader } from "./turn-prompt-preparation";

// ─── AgentLoop ───

export class AgentLoop {
  private session: SessionPort;
  private cwd: string;
  private runtime: AgentLoopRuntimeServices;
  private _abortController: AbortController | null = null;
  private state = {
    totalUsage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    } as Usage,
    turnCount: 0,
    isProcessing: false,
    /** Number of trust-dialog denials in the current turn */
    denialCount: 0,
    /** Description of the most recently denied operation */
    lastDeniedOperation: "",
  };

  constructor(
    client: OpenResponsesClient,
    session: SessionPort,
    tools: ToolRegistry,
    cwd: string,
    options: Partial<AgentLoopOptions> = {},
    trustManager?: TrustController,
    budgetTracker?: BudgetTracker,
    contextManager?: ContextManager,
    backgroundScheduler?: BackgroundScheduler,
    skillManager?: SkillSource,
    autoCompactOverride?: { enabled: boolean },
    projectMemory?: ProjectMemorySource,
    projectContextReader?: ProjectContextReader,
    projectCommandFiles?: ProjectCommandFileReader,
    evidenceProofSink?: EvidenceProofSink,
  ) {
    this.session = session;
    this.cwd = cwd;
    this.runtime = createAgentLoopRuntime({
      client,
      session,
      tools,
      cwd,
      options,
      trustManager,
      budgetTracker,
      contextManager,
      backgroundScheduler,
      skillManager,
      autoCompactOverride,
      projectMemory,
      projectContextReader,
      projectCommandFiles,
      evidenceProofSink,
      createToolContext: () => this.createToolContext(),
      flight: (data) => this.flight(data),
    });
  }

  /** Get current total usage */
  getUsage(): Usage {
    return { ...this.state.totalUsage };
  }

  /** Get turn count */
  getTurnCount(): number {
    return this.state.turnCount;
  }

  /** Get the active model from the client config */
  getModel(): string {
    return this.runtime.client.getConfig().model;
  }

  /** Get trust controller (legacy method name kept for host compatibility). */
  getTrustManager(): TrustController {
    return this.runtime.trustManager;
  }

  /** Get budget tracker */
  getBudgetTracker(): BudgetTracker {
    return this.runtime.budgetTracker;
  }

  /** Get context manager (if available) */
  getContextManager(): ContextManager | undefined {
    return this.runtime.contextManager;
  }

  getSessionManager(): SessionPort {
    return this.session;
  }

  setSessionManager(session: SessionPort): void {
    this.session = session;
    this.cwd = session.getCwd();
    this.runtime.trustManager.setRepoRoot(this.cwd);
  }

  private createToolContext(): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.session.getSessionId(),
      session: this.session,
      bashMaxTimeoutSeconds: this.runtime.options.bashMaxTimeoutSeconds,
    };
  }

  /** Get background scheduler (if available) */
  getBackgroundScheduler(): BackgroundScheduler | undefined {
    return this.runtime.backgroundScheduler;
  }

  /** Get skill source (legacy method name kept for host compatibility). */
  getSkillManager(): SkillSource | undefined {
    return this.runtime.skillManager;
  }

  /**
   * Set auto-compact override for runtime toggle.
   * When enabled is false, background compaction is skipped.
   */
  setAutoCompactOverride(override: { enabled: boolean }): void {
    this.runtime.setAutoCompactOverride(override);
  }

  /**
   * Get current auto-compact override status.
   */
  getAutoCompactOverride(): { enabled: boolean } | undefined {
    return this.runtime.getAutoCompactOverride();
  }

  /** Subscribe to agent events */
  onEvent(listener: (event: AgentEvent) => void): () => void {
    return this.runtime.eventBus.onEvent(listener);
  }

  /**
   * Write a debug entry to the session when debug mode is enabled.
   */
  private debug(data: DebugEntry["data"]): void {
    if (!this.runtime.options.debug) return;
    this.session.appendDebug(data);
  }

  private flight(data: Omit<FlightRecordData, "version">): void {
    this.session.appendFlightRecord({ version: 1, ...data });
  }

  /** Emit an event to all listeners */
  private emit(event: AgentEvent): void {
    this.runtime.eventBus.emit(event);
  }

  /**
   * Abort the currently running turn (if any).
   * Cancels in-progress tool execution (e.g., long-running bash commands).
   */
  abort(): void {
    this._abortController?.abort();
  }

  /** Stop only the currently executing tool and allow the agent turn to continue. */
  abortActiveTool(): boolean {
    return this.runtime.toolExecutor.abortActiveTool();
  }

  hasActiveTool(): boolean {
    return this.runtime.toolExecutor.hasActiveTool();
  }

  /**
   * Execute a user-authored shell command without sending it to the model.
   * Explicit user shell commands bypass agent trust checks.
   */
  async runShellCommand(command: string, silent = false): Promise<ToolResult> {
    return this.runtime.toolExecutor.runDirectShellCommand(command, silent);
  }

  /**
   * Run a single turn of the agent loop.
   *
   * A turn processes one user input and continues until
   * the LLM returns a response without tool calls.
   */
  async runTurn(userText: string): Promise<AgentTurnResult> {
    return runAgentTurn({
      userText,
      session: this.session,
      cwd: this.cwd,
      runtime: this.runtime,
      state: this.state,
      setAbortController: (controller) => {
        this._abortController = controller;
      },
      clearAbortController: () => {
        this._abortController = null;
      },
      createToolContext: () => this.createToolContext(),
      emit: (event) => this.emit(event),
      debug: (data) => this.debug(data),
      flight: (data) => this.flight(data),
    });
  }
}
