import { type Accessor, batch, createSignal, type Setter } from "solid-js";
import type {
  InputImageContent,
  InputTextContent,
  RuntimeContentBlock,
  RuntimeEvent,
  TranslationKey,
} from "../../../../application/ui/public";
import {
  CURRENT_SESSION_VERSION,
  executePlanCommand,
  I18n,
  isTuiThemeName,
  type PermissionMode,
  TrustManager,
  type TuiThemeName,
  type WorkMode,
} from "../../../../application/ui/public";
import { SYNTHWAVE_NOODLE_FRAMES } from "../../output/agent-status-line";
import { registerKeysCommand } from "../commands/keys-command";
import { registerModelCommand } from "../commands/model-command";
import { registerClearCommand, registerNotificationsCommand } from "../commands/notification-command";
import { slashCommandRegistry } from "../commands/registry";
import { registerSearchCommand } from "../commands/search-command";
import { registerSidebarCommand } from "../commands/sidebar-command";
import type { SlashCommandContext } from "../commands/types";
import { CommandHistory } from "../lib/command-history";
import { formatTuiEvidenceSummary, splitAssistantEvidence } from "../lib/evidence-summary";
import { formatToolArgs, formatToolResult, formatToolSummary } from "../lib/format-tool";
import { parseTuiInput } from "../lib/input-mode";
import { buildFileTree, readChangeStats } from "../lib/project-info";
import {
  type ComposerBlock,
  type ComposerBlockInput,
  composerBlockToPromptText,
  formatComposerBlock,
  validateComposerBlock,
} from "../lib/rich-paste";
import type { NotificationStore } from "./notification-store";
import { type ActivePane, type ChangeStat, type InteractiveTUIOptions, type QueuedMessage, SIDEBAR_MODES, type SidebarMode, type TuiMessage, type TuiMessageInput } from "./types";

const PROJECT_INFO_READ_ONLY_TOOLS = new Set(["read", "inspect_file", "ls", "search_files", "checkpoint", "activate_skill"]);
const PROJECT_INFO_REFRESH_DELAY_MS = 0;
const MAX_LIVE_TOOL_OUTPUT_BYTES = 50 * 1024;

function appendLiveToolOutput(content: string, chunk: string): string {
  const normalizedChunk = chunk.replace(/\r(?!\n)/g, "\n");
  const combined = content + normalizedChunk;
  const bytes = Buffer.from(combined, "utf-8");
  if (bytes.length <= MAX_LIVE_TOOL_OUTPUT_BYTES) return combined;
  return `[Earlier live output omitted]\n${new TextDecoder().decode(bytes.subarray(-MAX_LIVE_TOOL_OUTPUT_BYTES))}`;
}

interface TuiTrustController {
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  clearSessionApprovals(): void;
}

function shouldRefreshProjectInfoAfterTool(toolName: string): boolean {
  return !PROJECT_INFO_READ_ONLY_TOOLS.has(toolName);
}

export class TuiStore {
  readonly options: InteractiveTUIOptions;
  readonly history: CommandHistory;
  readonly messages: Accessor<TuiMessage[]>;
  readonly status: Accessor<string>;
  readonly isIdle: Accessor<boolean>;
  readonly noodleFrame: Accessor<number | null>;
  readonly usedTokens: Accessor<number>;
  readonly effectiveContextTokens: Accessor<number>;
  readonly fileTree: Accessor<string[]>;
  private readonly setFileTree: Setter<string[]>;
  readonly changes: Accessor<ChangeStat[]>;
  readonly confirmation: Accessor<Extract<RuntimeEvent, { type: "dangerous_confirmation" }> | null>;
  readonly clarification: Accessor<Extract<RuntimeEvent, { type: "clarification_request" }> | null>;
  readonly inputValue: Accessor<string>;
  readonly composerBlocks: Accessor<ComposerBlock[]>;
  readonly lastAssistantText: Accessor<string>;
  readonly isProcessing: Accessor<boolean>;
  readonly activeCompaction: Accessor<boolean>;
  readonly themeName: Accessor<TuiThemeName>;
  readonly model: Accessor<string>;
  readonly providerName: Accessor<string>;
  readonly projectTrusted: Accessor<boolean>;
  readonly localeRevision: Accessor<number>;
  readonly queuedMessages: Accessor<QueuedMessage[]>;
  readonly permissionMode: Accessor<PermissionMode>;
  readonly workMode: Accessor<WorkMode>;
  readonly sidebarMode: Accessor<SidebarMode>;
  readonly sidebarCollapsed: Accessor<boolean>;
  readonly activePane: Accessor<ActivePane>;
  readonly isSearchOpen: Accessor<boolean>;
  readonly highlightedMessageIndex: Accessor<number>;
  // ─── Agent configuration (from InteractiveTUIOptions) ───
  readonly debug: Accessor<boolean>;
  readonly maxOutputTokens: Accessor<number>;
  readonly maxCompletionTokens: Accessor<number>;
  readonly maxAgentIterations: Accessor<number>;
  readonly maxStalledIterations: Accessor<number>;
  readonly maxRunMinutes: Accessor<number>;
  readonly autoCompact: Accessor<boolean>;
  private readonly setMessages: Setter<TuiMessage[]>;
  private readonly setStatus: Setter<string>;
  private readonly setIsIdle: Setter<boolean>;
  private readonly setNoodleFrame: Setter<number | null>;
  private readonly setUsedTokens: Setter<number>;
  private readonly setEffectiveContextTokens: Setter<number>;
  private readonly setChanges: Setter<ChangeStat[]>;
  private readonly setConfirmation: Setter<Extract<RuntimeEvent, { type: "dangerous_confirmation" }> | null>;
  private readonly setClarification: Setter<Extract<RuntimeEvent, { type: "clarification_request" }> | null>;
  private readonly _toolSummaries = new Map<string, string>();
  private readonly _toolDetails = new Map<string, string[]>();
  private readonly _liveToolResultIds = new Map<string, number>();
  private readonly setInputValue: Setter<string>;
  private readonly setComposerBlocks: Setter<ComposerBlock[]>;
  private readonly setLastAssistantText: Setter<string>;
  private readonly setIsProcessing: Setter<boolean>;
  private readonly setActiveCompaction: Setter<boolean>;
  private readonly setThemeName: Setter<TuiThemeName>;
  private readonly setModel: Setter<string>;
  private readonly setProviderName: Setter<string>;
  private readonly setProjectTrusted: Setter<boolean>;
  private readonly setLocaleRevision: Setter<number>;
  private readonly setQueuedMessages: Setter<QueuedMessage[]>;
  private readonly setPermissionMode: Setter<PermissionMode>;
  private readonly setWorkMode: Setter<WorkMode>;
  private readonly setIsSearchOpen: Setter<boolean>;
  private readonly setHighlightedMessageIndex: Setter<number>;
  private readonly setSidebarMode: Setter<SidebarMode>;
  private readonly setSidebarCollapsed: Setter<boolean>;
  private readonly setActivePane: Setter<ActivePane>;
  private _scrollboxRef: { scrollTo(position: number): void; readonly height: number; readonly scrollHeight: number } | null = null;
  private nextId = 1;
  private nextQueueId = 1;
  private nextComposerBlockId = 1;
  private streamMessageId: string | null = null;
  private streamTuiId: number | null = null;
  private readonly reasoningTuiIds = new Map<string, number>();
  private readonly assistantTuiIds = new Map<string, number>();
  private readonly assistantRelatedTuiIds = new Map<string, number[]>();
  private finalizedIds = new Set<string>();
  private readonly displayedCompactionCheckpoints = new Set<string>();
  private noodleTimer: ReturnType<typeof setInterval> | null = null;
  private fileTreeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private changesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private turnActive = false;
  private readonly onExit: () => void;
  private readonly i18n: I18n;
  private readonly trustManager: TuiTrustController;
  private readonly _notificationStore: NotificationStore | undefined;
  private unsubscribeProxy: (() => void) | undefined;
  constructor(options: InteractiveTUIOptions, onExit: () => void = () => {}) {
    this.options = options;
    this.i18n = options.i18n ?? new I18n("en");
    this.history = new CommandHistory();
    this._notificationStore = options.notificationStore;
    this.onExit = onExit;
    this.trustManager = options.agentLoop.getTrustManager?.() ?? new TrustManager();
    [this.localeRevision, this.setLocaleRevision] = createSignal(0);
    [this.messages, this.setMessages] = createSignal<TuiMessage[]>([]);
    [this.status, this.setStatus] = createSignal(this.l("tui.status.idle"));
    [this.isIdle, this.setIsIdle] = createSignal(true);
    [this.noodleFrame, this.setNoodleFrame] = createSignal<number | null>(null);
    [this.usedTokens, this.setUsedTokens] = createSignal(0);
    [this.effectiveContextTokens, this.setEffectiveContextTokens] = createSignal(0);
    [this.fileTree, this.setFileTree] = createSignal<string[]>(buildFileTree(options.cwd));
    [this.changes, this.setChanges] = createSignal<ChangeStat[]>(readChangeStats(options.cwd));
    [this.confirmation, this.setConfirmation] = createSignal<Extract<
      RuntimeEvent,
      { type: "dangerous_confirmation" }
    > | null>(null);
    [this.clarification, this.setClarification] = createSignal<Extract<
      RuntimeEvent,
      { type: "clarification_request" }
    > | null>(null);
    [this.inputValue, this.setInputValue] = createSignal("");
    [this.composerBlocks, this.setComposerBlocks] = createSignal<ComposerBlock[]>([]);
    [this.lastAssistantText, this.setLastAssistantText] = createSignal("");
    [this.isProcessing, this.setIsProcessing] = createSignal(false);
    [this.activeCompaction, this.setActiveCompaction] = createSignal(false);
    [this.themeName, this.setThemeName] = createSignal(options.theme);
    [this.model, this.setModel] = createSignal(options.agentLoop.getModel());
    [this.providerName, this.setProviderName] = createSignal(options.providerStore?.registry.getActiveProvider().name ?? "");
    const identity = options.trustStore
      ? options.trustStore.computeProjectIdentity(options.cwd)
      : null;
    [this.projectTrusted, this.setProjectTrusted] = createSignal(
      identity && options.trustStore ? options.trustStore.isTrusted(identity) : false,
    );
    [this.queuedMessages, this.setQueuedMessages] = createSignal<QueuedMessage[]>([]);
    [this.permissionMode, this.setPermissionMode] = createSignal(this.trustManager.getPermissionMode());
    [this.workMode, this.setWorkMode] = createSignal<WorkMode>(options.agentLoop.getWorkMode?.() ?? "agent");
    [this.sidebarMode, this.setSidebarMode] = createSignal<SidebarMode>("session");
    [this.sidebarCollapsed, this.setSidebarCollapsed] = createSignal(false);
    [this.activePane, this.setActivePane] = createSignal<ActivePane>("input");
    [this.isSearchOpen, this.setIsSearchOpen] = createSignal(false);
    [this.highlightedMessageIndex, this.setHighlightedMessageIndex] = createSignal(-1);
    [this.debug] = createSignal(options.debug);
    [this.maxOutputTokens] = createSignal(options.maxOutputTokens);
    [this.maxCompletionTokens] = createSignal(options.maxCompletionTokens);
    [this.maxAgentIterations] = createSignal(options.maxAgentIterations);
    [this.maxStalledIterations] = createSignal(options.maxStalledIterations);
    [this.maxRunMinutes] = createSignal(options.maxRunMinutes);
    [this.autoCompact] = createSignal(options.autoCompact);

    // Subscribe to client proxy model changes so the sidebar stays in sync
    // when ModelSelector switches providers/models.
    if (options.clientProxy) {
      this.unsubscribeProxy = options.clientProxy.onChange((info) => {
        this.setModel(info.modelId);
        const provider = options.providerStore?.registry.getProvider(info.providerId);
        if (provider) this.setProviderName(provider.name);
      });
    }

    // Phase 2.5 A4: Register TUI commands in the slash command registry
    this.registerCommands();
    this.restoreLastCompaction();
  }

  /**
   * Register TUI slash commands in the global registry.
   * Called once during construction. Future TUI commands
   * (/model, /search, /sessions) register themselves similarly.
   */
  private registerCommands(): void {
    // /clear — clear visible messages
    registerClearCommand(() => this.clearMessages());

    // /notifications — show notification history
    if (this._notificationStore) {
      registerNotificationsCommand({ store: this._notificationStore });
    }

    // /search — open search overlay
    registerSearchCommand({
      openSearch: (initialQuery) => this.openSearch(initialQuery),
    });

    registerSidebarCommand({
      next: () => this.cycleSidebarMode(1),
      previous: () => this.cycleSidebarMode(-1),
      toggle: () => this.toggleSidebar(),
      help: () => this.openHelpSidebar(),
    });
    registerKeysCommand();

    if (this.options.providerStore) {
      registerModelCommand({ providerStore: this.options.providerStore });
    }
  }

  /**
   * Translate a key and subscribe the caller to runtime locale changes.
   */
  l(key: TranslationKey, vars?: Record<string, string | number>): string {
    this.localeRevision();
    return this.i18n.t(key, vars);
  }

  /** Get the notification store (for TuiApp). */
  get notificationStore(): NotificationStore | undefined {
    return this._notificationStore;
  }

  /** Set the scrollbox ref so jumpToMessage can scroll to match. */
  setJumpScrollbox(ref: { scrollTo(position: number): void; readonly height: number; readonly scrollHeight: number } | null): void {
    this._scrollboxRef = ref;
  }

  /** Open search overlay with optional initial query. */
  openSearch(initialQuery = ""): void {
    this.setIsSearchOpen(true);
    this.setActivePane("overlay");
    void initialQuery;
  }

  /** Close search overlay. */
  closeSearch(): void {
    this.setIsSearchOpen(false);
    this.setActivePane("input");
  }

  /** Highlight a message by index and scroll to it (jump from search result). */
  jumpToMessage(index: number): void {
    this.setHighlightedMessageIndex(index);

    // Scroll to make the message visible
    const sb = this._scrollboxRef;
    if (sb) {
      const total = this.messages().length;
      if (total > 0) {
        // Estimate position: proportional to index in total messages
        const ratio = index / total;
        const target = Math.max(0, Math.floor(ratio * sb.scrollHeight) - Math.floor(sb.height / 3));
        sb.scrollTo(target);
      }
    }

    // Clear highlight after 2 seconds
    setTimeout(() => {
      this.setHighlightedMessageIndex(-1);
    }, 2000);
  }

  /** Toggle sidebar collapsed state (Ctrl+Shift+S). */
  toggleSidebar(): void {
    this.setSidebarCollapsed((collapsed) => !collapsed);
    this.setActivePane("sidebar");
  }

  /** Cycle sidebar mode forward (Ctrl+B) or backward (Ctrl+Shift+B). */
  cycleSidebarMode(direction: 1 | -1 = 1): void {
    const current = this.sidebarMode();
    const index = SIDEBAR_MODES.indexOf(current);
    const next = (index + direction + SIDEBAR_MODES.length) % SIDEBAR_MODES.length;
    this.setSidebarMode(SIDEBAR_MODES[next]);
    this.setActivePane("sidebar");
  }

  /** Open the help sidebar directly (Ctrl+H). Expands sidebar if collapsed. */
  openHelpSidebar(): void {
    if (this.sidebarCollapsed()) {
      this.setSidebarCollapsed(false);
    }
    this.setSidebarMode("help");
    this.setActivePane("sidebar");
  }

  /** Track which TUI pane currently receives keyboard intent. */
  setActiveUiPane(pane: ActivePane): void {
    this.setActivePane(pane);
  }

  /** Session format version (v2). */
  getSessionFormat(): string {
    return `v${CURRENT_SESSION_VERSION}`;
  }

  /** Whether the current session is persisted to disk. */
  isSessionPersisted(): boolean {
    return this.options.agentLoop.getSessionManager().isPersisted();
  }

  /** Current session ID (short hash). */
  getSessionId(): string {
    return this.options.agentLoop.getSessionManager().getSessionId();
  }

  /** Debug info from context manager (reserves, limits). */
  getContextDebugInfo(): {
    source: "provider_usage" | "estimated";
    safetyReserveTokens: number;
    maxOutputTokens: number;
    contextWindow: number;
    hardLimit: number;
    effectiveTokens: number;
    softLimit: number;
    lastCompact: null | {
      status: string;
      trigger: string;
      checkpointId: string | null;
      durationMs: number;
      reclaimedTokens: number;
    };
  } | null {
    const cm = this.options.agentLoop.getContextManager();
    if (!cm) return null;
    return cm.getDebugInfo();
  }

  /** Refresh project trust status from the trust store. */
  refreshProjectTrust(): void {
    const identity = this.options.trustStore
      ? this.options.trustStore.computeProjectIdentity(this.options.cwd)
      : null;
    this.setProjectTrusted(
      identity && this.options.trustStore ? this.options.trustStore.isTrusted(identity) : false,
    );
  }

  /** Return the i18n placeholder for the input bar. */
  getInputPlaceholder(): string {
    if (this.confirmation()) {
      return this.l("tui.placeholder.dangerous");
    }
    const clarification = this.clarification();
    if (clarification) {
      return this.l(
        clarification.request.allowOther
          ? "tui.placeholder.clarificationOther"
          : "tui.placeholder.clarification",
        { count: clarification.request.options.length },
      );
    }
    return this.l("tui.placeholder.default");
  }

  /** Return the help keys hint text for the status bar. */
  getHelpKeys(): string {
    return this.l("tui.keys.help");
  }

  /** Return the localized "thinking" label. */
  getThinkingLabel(): string {
    return this.l("tui.thinking");
  }

  /** Navigate history: 1 = older (up), -1 = newer (down). Returns the entry or null. */
  historyNavigate(direction: 1 | -1): string | null {
    return direction === 1 ? this.history.older() : this.history.newer();
  }

  setInput(value: string): void {
    this.setInputValue(value);
  }

  addComposerBlock(block: ComposerBlockInput): boolean {
    const validationError = validateComposerBlock(block, this.composerBlocks());
    if (validationError) {
      this.add({ type: "warning", content: validationError });
      return false;
    }
    this.setComposerBlocks((blocks) => [...blocks, { ...block, id: this.nextComposerBlockId++ } as ComposerBlock]);
    this.setActiveUiPane("input");
    return true;
  }

  removeLastComposerBlock(): boolean {
    const blocks = this.composerBlocks();
    if (blocks.length === 0) return false;
    this.setComposerBlocks(blocks.slice(0, -1));
    return true;
  }

  clearComposerBlocks(): void {
    this.setComposerBlocks([]);
  }

  hasSubmittableInput(value: string): boolean {
    return value.trim().length > 0 || this.composerBlocks().length > 0;
  }

  formatComposerBlock(block: ComposerBlock): string {
    return formatComposerBlock(block);
  }

  clearMessages(): void {
    this.setMessages([]);
    this.finalizedIds.clear();
    this.reasoningTuiIds.clear();
    this.assistantTuiIds.clear();
    this.assistantRelatedTuiIds.clear();
  }

  /** Stop the active tool, or cancel the turn when no tool is running. */
  cancel(): void {
    this.cancelClarification();
    if (this.options.agentLoop.abortActiveTool()) {
      this.setStatus(this.l("tui.status.working"));
      this.add({ type: "info", content: this.l("tui.info.toolStopped") });
      return;
    }
    this.options.agentLoop.abort();
    this.stopNoodle();
    this.setIsProcessing(false);
    this.setIsIdle(true);
    this.setStatus(this.l("tui.status.idle"));
    this.add({ type: "info", content: this.l("tui.info.cancelled") });
    this.streamMessageId = null;
    this.streamTuiId = null;
    this.reasoningTuiIds.clear();
    this.assistantTuiIds.clear();
    this.assistantRelatedTuiIds.clear();
  }

  copyLastAssistant(): boolean {
    const text = this.lastAssistantText();
    if (!text) return false;
    return this.copyText(text);
  }

  /** Return the complete visible message history as one copyable text document. */
  getTranscriptText(): string {
    return this.messages()
      .map((message) => {
        switch (message.type) {
          case "user":
            return `${this.l("tui.label.you")}\n${message.content}`;
          case "assistant":
            return `${this.l("tui.label.assistant")}\n${message.content}`;
          case "evidence":
            return formatTuiEvidenceSummary(message.summary);
          case "reasoning":
            return `🍜 ${this.l("tui.reasoning")}\n${message.content}`;
          case "narration":
            return message.content;
          case "tool-start":
            return `→ ${message.summary}`;
          case "tool-result":
            return message.isError
              ? message.content
                  .split("\n")
                  .slice(0, 5)
                  .map((line) => `  ✖ ${line}`)
                  .join("\n")
              : "";
          case "tool-end":
            return "";
          case "info":
          case "error":
          case "warning":
          case "success":
            return message.content;
        }
      })
      .filter((text) => text.trim().length > 0)
      .join("\n\n");
  }

  copyTranscript(): boolean {
    return this.copyText(this.getTranscriptText());
  }

  notifyCopied(): void {
    this.setStatus(this.l("tui.status.copied"));
    setTimeout(() => this.setStatus(this.l("tui.status.idle")), 1500);
  }

  private copyText(text: string): boolean {
    if (!text) return false;
    process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf-8").toString("base64")}\x07`);
    this.notifyCopied();
    return true;
  }

  async submit(rawInput: string): Promise<void> {
    const blocks = this.composerBlocks();
    const trimmedInput = rawInput.trim();
    const parsedInput =
      blocks.length === 0
        ? parseTuiInput(trimmedInput)
        : { mode: trimmedInput ? ("message" as const) : ("empty" as const), content: trimmedInput };
    const input = parsedInput.content;
    if (parsedInput.mode === "empty" && blocks.length === 0) return;
    if (this.confirmation()) {
      this.resolveConfirmation(trimmedInput);
      return;
    }
    if (this.clarification()) {
      this.resolveClarificationInput(trimmedInput);
      return;
    }
    this.setInputValue("");
    this.clearComposerBlocks();
    this.history.add(this.formatTurnDisplay(trimmedInput, blocks));
    if (blocks.length === 0 && /^\/queue(?:\s|$)/.test(input)) {
      this.handleQueueCommand(input);
      return;
    }
    if (blocks.length === 0 && /^\/permissions(?:\s|$)/.test(input)) {
      this.handlePermissionsCommand(input);
      return;
    }
    if (blocks.length === 0 && /^\/plan(?:\s|$)/.test(input)) {
      this.handlePlanCommand(input);
      return;
    }
    if (
      blocks.length === 0
      && /^\/compact(?:\s|$)/.test(input)
      && (this.turnActive || this.isProcessing() || this.activeCompaction())
    ) {
      this.enqueue(input, "command");
      return;
    }
    if (blocks.length === 0 && parsedInput.mode === "slash-command") {
      // Phase 2.5 A4: Try TUI slash command registry first.
      // This dispatches TUI commands like /clear, /notifications,
      // and future /model, /search, /sessions without modifying
      // the core command router.
      const tuiCtx: SlashCommandContext = {
        addMessage: (message) => this.add(message),
        exit: () => this.onExit(),
      };
      const registryResult = slashCommandRegistry.dispatch(input, tuiCtx);
      if (registryResult) {
        if (registryResult.exit) this.onExit();
        return;
      }

      const result = await this.options.executeCommand(input, (event) => this.onCommandOutput(event));
      if ("exit" in result && result.exit) this.onExit();
      if (!result.handled && result.prompt) {
        if (this.turnActive || this.isProcessing() || this.activeCompaction()) {
          this.enqueue(result.prompt);
        } else {
          await this.runTurn(result.prompt);
        }
      }
      return;
    }
    const shellKind =
      blocks.length === 0 && (parsedInput.mode === "shell" || parsedInput.mode === "shell-silent")
        ? parsedInput.mode
        : null;
    if (shellKind) {
      const command = parsedInput.content;
      if (!command) return;
      if (this.turnActive || this.isProcessing() || this.activeCompaction()) {
        this.enqueue(command, shellKind);
        return;
      }
      await this.runShellCommand(command, shellKind === "shell-silent");
      return;
    }
    if (this.turnActive || this.isProcessing() || this.activeCompaction()) {
      this.enqueue(input, "message", blocks);
      return;
    }
    await this.runTurn(input, blocks);
  }

  private buildRuntimeContent(input: string, blocks: ComposerBlock[]): RuntimeContentBlock[] {
    const content: RuntimeContentBlock[] = [];
    for (const block of blocks) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else {
        content.push({ type: "image", mimeType: block.mimeType, data: block.data });
      }
    }
    if (input.trim().length > 0) {
      content.push({ type: "text", text: input });
    }
    return content;
  }

  private buildAgentLoopContent(input: string, blocks: ComposerBlock[]): Array<InputTextContent | InputImageContent> {
    const content: Array<InputTextContent | InputImageContent> = [];
    for (const block of blocks) {
      if (block.type === "text") {
        content.push({ type: "input_text", text: block.text });
      } else {
        content.push({ type: "input_image", image_url: `data:${block.mimeType};base64,${block.data}`, detail: "auto" });
      }
    }
    if (input.trim().length > 0) {
      content.push({ type: "input_text", text: input });
    }
    return content;
  }

  private formatTurnDisplay(input: string, blocks: ComposerBlock[]): string {
    return [
      ...blocks.map((block) => composerBlockToPromptText(block)),
      input,
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  private async runTurn(input: string, blocks: ComposerBlock[] = []): Promise<void> {
    this.turnActive = true;
    this.setIsProcessing(true);
    this.setIsIdle(false);
    this.setStatus(this.l("tui.status.working"));
    try {
      if (this.options.runtime) {
        await this.options.runtime.runTurn({
          sessionId: this.getSessionId(),
          source: "tui",
          content: this.buildRuntimeContent(input, blocks),
          clarificationAvailable: true,
        });
      } else {
        this.options.agentLoop.setClarificationAvailable?.(true);
        try {
          await this.options.agentLoop.runTurn(blocks.length === 0 ? input : this.buildAgentLoopContent(input, blocks));
        } finally {
          this.options.agentLoop.setClarificationAvailable?.(false);
        }
      }
    } catch (error) {
      this.add({
        type: "error",
        content: this.l("tui.label.error", { message: error instanceof Error ? error.message : String(error) }),
      });
      this.setIsProcessing(false);
      this.setIsIdle(true);
      this.setStatus(this.l("tui.status.idle"));
    }
    this.turnActive = false;
    await this.runNextQueued();
  }

  private async runShellCommand(command: string, silent: boolean): Promise<void> {
    this.turnActive = true;
    this.setIsProcessing(true);
    this.setIsIdle(false);
    this.setStatus(this.l("tui.status.running", { tool: "bash" }));
    try {
      await this.options.agentLoop.runShellCommand(command, silent);
    } catch (error) {
      this.add({
        type: "error",
        content: this.l("tui.label.error", { message: error instanceof Error ? error.message : String(error) }),
      });
    }
    this.stopNoodle();
    this.turnActive = false;
    this.setIsProcessing(false);
    this.setIsIdle(true);
    this.setStatus(this.l("tui.status.idle"));
    await this.runNextQueued();
  }

  onAgentEvent(event: RuntimeEvent): void {
    switch (event.type) {
      case "turn_start":
        this.add({ type: "user", content: event.userInput });
        break;
      case "thinking":
        if (event.active) {
          this.startNoodle();
        } else {
          this.stopNoodle();
        }
        break;
      case "assistant_message_start": {
        if (this.streamMessageId) break;
        // A new assistant text response means the previous thought is done.
        this.finalizeStreamingReasoning();
        // Stop noodle animation — streaming text provides its own visual feedback
        this.stopNoodle();
        const message = this.add({ type: "assistant", content: "", streaming: true });
        this.streamMessageId = event.messageId;
        this.streamTuiId = message.id;
        this.setStatus(this.l("tui.status.responding"));
        break;
      }
      case "assistant_text_delta":
        if (event.messageId === this.streamMessageId && this.streamTuiId !== null) {
          batch(() => {
            this.updateAssistant(this.streamTuiId as number, (content) => content + event.delta, true);
          });
        }
        break;
      case "assistant_reasoning_delta": {
        this.stopNoodle();
        this.setStatus(this.l("tui.thinking"));
        const existingReasoningId = this.reasoningTuiIds.get(event.messageId);
        if (existingReasoningId !== undefined) {
          this.updateReasoning(existingReasoningId, (content) => content + event.delta);
          break;
        }

        const reasoningMsg: TuiMessage = { id: this.nextId++, type: "reasoning", content: event.delta, streaming: true };
        this.reasoningTuiIds.set(event.messageId, reasoningMsg.id);
        this.setMessages((messages) => {
          if (this.streamMessageId === event.messageId && this.streamTuiId !== null) {
            const index = messages.findIndex((m) => m.id === this.streamTuiId);
            if (index >= 0) {
              return [...messages.slice(0, index), reasoningMsg, ...messages.slice(index)];
            }
          }
          return [...messages, reasoningMsg];
        });
        break;
      }
      case "assistant_text_done": {
        const tuiId = this.streamTuiId;
        if (!this.finalizedIds.has(event.messageId) && tuiId !== null) {
          this.finalizedIds.add(event.messageId);
          this.assistantTuiIds.set(event.messageId, tuiId);
          const relatedIds: number[] = [];
          batch(() => {
            const split = splitAssistantEvidence(event.fullText);
            this.updateAssistant(tuiId, () => split.body, false);
            if (split.evidence) {
              const evidence = this.insertAfter(tuiId, { type: "evidence", summary: split.evidence });
              relatedIds.push(evidence.id);
            }
            this.setLastAssistantText(event.fullText);
            // Insert reasoning BEFORE the assistant message
            if (event.reasoningContent) {
              const existingReasoningId = this.reasoningTuiIds.get(event.messageId);
              if (existingReasoningId !== undefined) {
                this.updateReasoning(existingReasoningId, () => event.reasoningContent as string, false);
                relatedIds.push(existingReasoningId);
              } else {
                const reasoningMsg: TuiMessage = { id: this.nextId++, type: "reasoning", content: event.reasoningContent, streaming: false };
                relatedIds.push(reasoningMsg.id);
                this.setMessages((messages) => {
                  const index = messages.findIndex((m) => m.id === tuiId);
                  if (index < 0) return messages;
                  return [...messages.slice(0, index), reasoningMsg, ...messages.slice(index)];
                });
              }
            }
          });
          this.assistantRelatedTuiIds.set(event.messageId, relatedIds);
          this.reasoningTuiIds.delete(event.messageId);
          this.streamMessageId = null;
          this.streamTuiId = null;
        }
        break;
      }
      case "assistant_message_superseded": {
        this.removeAssistantMessageByModelId(event.messageId);
        break;
      }
      case "assistant_message":
        if (!this.finalizedIds.has(event.messageId)) {
          this.finalizedIds.add(event.messageId);
          // Add reasoning BEFORE assistant message
          if (event.reasoningContent) {
            this.add({ type: "reasoning", content: event.reasoningContent, streaming: false });
          }
          this.addAssistantFinalText(event.text);
          this.setLastAssistantText(event.text);
        }
        break;
      case "working_narration":
        // Narration is the next activity — finish any streaming thought first.
        this.finalizeStreamingReasoning();
        this.add({
          type: "narration",
          eventType: event.eventType,
          content: event.message,
          evidenceIds: event.evidenceIds,
        });
        break;
      case "tool_call_start":
        // A tool call is the next activity — finish any streaming thought first.
        this.finalizeStreamingReasoning();
        this.stopNoodle();
        // Store summary for use by tool-result
        this._toolSummaries.set(event.toolCallId, formatToolSummary(event.toolName, event.args));
        this._toolDetails.set(event.toolCallId, formatToolArgs(event.toolName, event.args));
        this.add({ type: "tool-start", toolName: event.toolName, summary: this._toolSummaries.get(event.toolCallId)! });
        if (event.userInitiated && event.toolName === "bash" && !event.silent) {
          const liveResult = this.add({
            type: "tool-result",
            content: "",
            isError: false,
            isDiff: false,
            toolName: event.toolName,
            summary: this._toolSummaries.get(event.toolCallId) ?? "Bash",
            toolCallId: event.toolCallId,
            details: this._toolDetails.get(event.toolCallId) ?? [],
            streaming: true,
          });
          this._liveToolResultIds.set(event.toolCallId, liveResult.id);
        }
        this.setStatus(this.l("tui.status.running", { tool: event.toolName }));
        break;
      case "tool_call_output": {
        const liveResultId = this._liveToolResultIds.get(event.toolCallId);
        if (liveResultId !== undefined) {
          this.updateToolResult(liveResultId, (message) => ({
            ...message,
            content: appendLiveToolOutput(message.content, event.chunk),
          }));
        }
        break;
      }
      case "tool_call_result": {
        const resultContent = formatToolResult(event.result, this.i18n);
        const isDiff = event.toolName === "edit";
        const summary = this._toolSummaries.get(event.toolCallId) ?? "";
        const details = this._toolDetails.get(event.toolCallId) ?? [];
        const liveResultId = this._liveToolResultIds.get(event.toolCallId);
        if (liveResultId !== undefined) {
          this.updateToolResult(liveResultId, (message) => ({
            ...message,
            content: resultContent,
            isError: event.result.isError,
            isDiff,
            summary,
            details,
            streaming: false,
          }));
        } else {
          this.add({
            type: "tool-result",
            content: resultContent,
            isError: event.result.isError,
            isDiff,
            toolName: event.toolName,
            summary,
            toolCallId: event.toolCallId,
            details,
          });
        }
        break;
      }
      case "tool_call_end":
        this.add({ type: "tool-end", toolName: event.toolName, durationMs: event.durationMs });
        // Patch the last tool-result with durationMs for the ToolResultBlock
        this.setMessages((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (
              m.type === "tool-result" &&
              (m.toolCallId === event.toolCallId || (!m.toolCallId && m.toolName === event.toolName)) &&
              m.durationMs === undefined
            ) {
              const updated = [...prev];
              updated[i] = { ...m, durationMs: event.durationMs };
              return updated;
            }
          }
          return prev;
        });
        this._liveToolResultIds.delete(event.toolCallId);
        // Coalesce project info refreshes for bursts of read-only or parallel tool calls.
        if (shouldRefreshProjectInfoAfterTool(event.toolName)) {
          this.refreshFileTreeDeferred();
          this.refreshChangesDeferred();
        }
        // Only restart noodle if we are not currently streaming text
        if (!this.streamMessageId) {
          this.startNoodle();
        }
        break;
      case "budget_update":
        this.setUsedTokens(event.usedTokens);
        if (event.effectiveContextTokens !== undefined && event.effectiveContextTokens > 0) {
          this.setEffectiveContextTokens(event.effectiveContextTokens);
        }
        if (event.percentage >= 90 && this._notificationStore) {
          this._notificationStore.notify(
            "warning",
            this.l("tui.notifications.budgetCriticalTitle"),
            this.l("tui.notifications.budgetUsage", {
              percent: event.percentage,
              used: event.usedTokens,
              total: event.totalBudget,
            }),
          );
        } else if (event.percentage >= 80 && this._notificationStore) {
          this._notificationStore.notify(
            "warning",
            this.l("tui.notifications.budgetWarningTitle"),
            this.l("tui.notifications.budgetUsage", {
              percent: event.percentage,
              used: event.usedTokens,
              total: event.totalBudget,
            }),
          );
        }
        break;
      case "turn_end":
        this.finalizeStreamingReasoning(true);
        this.stopNoodle();
        this.setIsProcessing(false);
        this.setIsIdle(true);
        this.setStatus(this.l("tui.status.idle"));
        break;
      case "turn_error":
        this.finalizeStreamingReasoning(true);
        this.add({ type: "error", content: this.l("tui.label.error", { message: event.error }) });
        this._notificationStore?.notify(
          "error",
          this.l("tui.notifications.turnErrorTitle"),
          event.error.slice(0, 120),
        );
        this.stopNoodle();
        this.setIsProcessing(false);
        this.setIsIdle(true);
        this.setStatus(this.l("tui.status.idle"));
        break;
      case "loop_guard":
        this.add({
          type: event.action === "recover" ? "warning" : "error",
          content: this.l("tui.label.loopGuard", { action: event.action, message: event.message }),
        });
        break;
      case "turn_stop_reason":
        if (event.reason !== "completed")
          this.add({ type: "info", content: this.l("tui.label.stop", { reason: event.reason, detail: event.detail }) });
        break;
      case "dangerous_confirmation":
        // Permission request is the next activity — finish any streaming thought first.
        this.finalizeStreamingReasoning();
        this.setConfirmation(event);
        this.add({
          type: "warning",
          content: this.l("tui.label.dangerous", { description: event.description, reason: event.reason }),
        });
        this._notificationStore?.notify(
          "warning",
          this.l("tui.notifications.permissionRequiredTitle"),
          this.l("tui.notifications.permissionRequiredMessage", { tool: event.toolName }),
        );
        this.setStatus(this.l("tui.status.confirmation"));
        break;
      case "clarification_request":
        // Claim synchronously: the event bus resolves unclaimed requests as unavailable
        // immediately after listeners return.
        event.claim();
        this.finalizeStreamingReasoning();
        this.stopNoodle();
        this.setClarification(event);
        this.setStatus(this.l("tui.status.clarification"));
        break;
      case "skill_activated":
        this._notificationStore?.notify(
          "success",
          this.l("tui.notifications.skillActivatedTitle", { skill: event.skillName }),
          this.l("tui.notifications.skillActivatedMessage", { revision: event.skillRevision }),
        );
        break;
      case "compaction_done":
        this.setActiveCompaction(false);
        this.addCompactionSummary(event);
        this._notificationStore?.notify(
          "info",
          this.l("tui.notifications.compactionCompleteTitle"),
          this.l("tui.notifications.compactionCompleteMessage", {
            tokens: event.tokensSaved,
            strategy: event.strategy,
          }),
        );
        void this.runNextQueued();
        break;
      case "compaction_start": {
        const percent = event.hardLimit > 0
          ? Math.round((event.tokensBefore / event.hardLimit) * 100)
          : 0;
        this.setActiveCompaction(true);
        this.setStatus(this.l("tui.status.compactingPercent", { percent }));
        break;
      }
      case "compaction_skipped":
      case "compaction_cancelled":
      case "compaction_failed":
        this.setActiveCompaction(false);
        this.setStatus(this.isProcessing() ? this.l("tui.status.working") : this.l("tui.status.idle"));
        if (event.type === "compaction_failed") {
          this.add({ type: "warning", content: event.reason });
        }
        void this.runNextQueued();
        break;
      case "plan_update":
        this.finalizeStreamingReasoning();
        break;
      case "function_call_delta":
      case "function_call_done":
      case "skill_deactivated":
      case "context_error":
        break;
    }
  }

  dispose(): void {
    this.stopNoodle();
    if (this.fileTreeRefreshTimer) clearTimeout(this.fileTreeRefreshTimer);
    if (this.changesRefreshTimer) clearTimeout(this.changesRefreshTimer);
    this.fileTreeRefreshTimer = null;
    this.changesRefreshTimer = null;
    this.unsubscribeProxy?.();

    this.confirmation()?.resolve("deny");
    this.clarification()?.resolve({ status: "cancelled" });
  }

  private enqueue(content: string, kind: QueuedMessage["kind"] = "message", blocks: ComposerBlock[] = []): void {
    const queued = {
      id: this.nextQueueId++,
      content,
      kind,
      ...(kind === "message" && blocks.length > 0 ? { blocks: blocks.map((block) => ({ ...block })) } : {}),
    };
    this.setQueuedMessages((messages) => [...messages, queued]);
    this.add({ type: "info", content: this.l("tui.queue.added", { id: queued.id }) });
  }

  private async runNextQueued(): Promise<void> {
    if (this.turnActive || this.isProcessing() || this.activeCompaction()) return;
    const next = this.queuedMessages()[0];
    if (!next) return;
    this.setQueuedMessages((messages) => messages.slice(1));
    if (next.kind === "message") {
      await this.runTurn(next.content, next.blocks ?? []);
    } else if (next.kind === "command") {
      const result = await this.options.executeCommand(next.content, (event) => this.onCommandOutput(event));
      if ("prompt" in result && result.prompt) await this.runTurn(result.prompt);
    } else {
      await this.runShellCommand(next.content, next.kind === "shell-silent");
    }
  }

  private handleQueueCommand(input: string): void {
    const [, action = "", idOrAll = "", ...contentParts] = input.split(/\s+/);
    if (!action) {
      const queued = this.queuedMessages();
      this.add({
        type: "info",
        content:
          queued.length === 0
            ? this.l("tui.queue.empty")
            : [
                this.l("tui.queue.title"),
                ...queued.map((message) => `  #${message.id} ${this.formatQueuedMessage(message)}`),
              ].join("\n"),
      });
      return;
    }
    if (action === "cancel") {
      if (idOrAll === "all") {
        this.setQueuedMessages([]);
        this.add({ type: "info", content: this.l("tui.queue.cancelledAll") });
        return;
      }
      const id = Number.parseInt(idOrAll, 10);
      const exists = this.queuedMessages().some((message) => message.id === id);
      this.setQueuedMessages((messages) => messages.filter((message) => message.id !== id));
      this.add({ type: exists ? "info" : "error", content: this.l(exists ? "tui.queue.cancelled" : "tui.queue.notFound", { id }) });
      return;
    }
    if (action === "edit") {
      const id = Number.parseInt(idOrAll, 10);
      const content = contentParts.join(" ").trim();
      const exists = this.queuedMessages().some((message) => message.id === id);
      if (!exists || !content) {
        this.add({
          type: "error",
          content: exists ? this.l("tui.queue.editUsage") : this.l("tui.queue.notFound", { id }),
        });
        return;
      }
      this.setQueuedMessages((messages) =>
        messages.map((message) => (message.id === id ? { ...message, content } : message)),
      );
      this.add({ type: "info", content: this.l("tui.queue.edited", { id }) });
      return;
    }
    this.add({ type: "error", content: this.l("tui.queue.usage") });
  }

  private formatQueuedMessage(message: QueuedMessage): string {
    if (message.kind === "shell") return `!${message.content}`;
    if (message.kind === "shell-silent") return `!!${message.content}`;
    return this.formatTurnDisplay(message.content, message.blocks ?? []);
  }

  private handlePermissionsCommand(input: string): void {
    const [, action = ""] = input.split(/\s+/);
    const trustManager = this.trustManager;
    if (!action) {
      this.add({
        type: "info",
        content: this.l("tui.permissions.current", { mode: trustManager.getPermissionMode() }),
      });
      return;
    }
    if (action === "ask" || action === "repo" || action === "full") {
      trustManager.setPermissionMode(action);
      this.setPermissionMode(action);
      this.add({ type: "info", content: this.l("tui.permissions.changed", { mode: action }) });
      return;
    }
    if (action === "clear") {
      trustManager.clearSessionApprovals();
      trustManager.setPermissionMode("ask");
      this.setPermissionMode("ask");
      this.add({ type: "info", content: this.l("tui.permissions.cleared") });
      return;
    }
    this.add({ type: "error", content: this.l("tui.permissions.usage") });
  }

  private handlePlanCommand(input: string): void {
    const args = input.trim().split(/\s+/).slice(1);
    const agentLoop = this.options.agentLoop;
    const controller =
      agentLoop.getWorkMode && agentLoop.setWorkMode
        ? {
            getWorkMode: () => agentLoop.getWorkMode?.() ?? this.workMode(),
            setWorkMode: (mode: WorkMode) => {
              agentLoop.setWorkMode?.(mode);
              this.setWorkMode(mode);
            },
          }
        : {
            getWorkMode: () => this.workMode(),
            setWorkMode: (mode: WorkMode) => this.setWorkMode(mode),
          };
    const view = executePlanCommand({ args, controller });
    if (view.kind === "usage" || view.kind === "not_configured") {
      this.add({ type: "error", content: this.l("tui.plan.usage") });
      return;
    }
    if (view.kind === "current") {
      this.add({ type: "info", content: this.l("tui.plan.current", { mode: view.mode }) });
      return;
    }
    this.add({ type: "info", content: this.l("tui.plan.changed", { mode: view.mode }) });
  }

  private add(message: TuiMessageInput): TuiMessage {
    const withId = { ...message, id: this.nextId++ } as TuiMessage;
    this.setMessages((messages) => [...messages, withId]);
    return withId;
  }

  private insertAfter(afterId: number, message: TuiMessageInput): TuiMessage {
    const withId = { ...message, id: this.nextId++ } as TuiMessage;
    this.setMessages((messages) => {
      const index = messages.findIndex((candidate) => candidate.id === afterId);
      if (index < 0) return [...messages, withId];
      return [...messages.slice(0, index + 1), withId, ...messages.slice(index + 1)];
    });
    return withId;
  }

  private addAssistantFinalText(text: string): void {
    const split = splitAssistantEvidence(text);
    if (split.body.trim().length > 0 || !split.evidence) {
      this.add({ type: "assistant", content: split.body, streaming: false });
    }
    if (split.evidence) {
      this.add({ type: "evidence", summary: split.evidence });
    }
  }

  private removeAssistantMessageByModelId(messageId: string): void {
    const assistantId = this.assistantTuiIds.get(messageId);
    const relatedIds = this.assistantRelatedTuiIds.get(messageId) ?? [];
    if (assistantId === undefined && relatedIds.length === 0) return;

    const idsToRemove = new Set([assistantId, ...relatedIds].filter((id): id is number => id !== undefined));
    this.setMessages((messages) => messages.filter((message) => !idsToRemove.has(message.id)));
    this.assistantTuiIds.delete(messageId);
    this.assistantRelatedTuiIds.delete(messageId);
    this.reasoningTuiIds.delete(messageId);
    this.finalizedIds.delete(messageId);
    if (this.streamMessageId === messageId) {
      this.streamMessageId = null;
      this.streamTuiId = null;
    }
  }

  /**
   * Update a single assistant message in the messages array.
   * Uses index-based lookup instead of .map() to avoid creating
   * new object references for unchanged messages.
   */
  private updateAssistant(id: number, update: (content: string) => string, streaming: boolean): void {
    this.setMessages((messages) => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx === -1) return messages;
      const message = messages[idx];
      if (message.type !== "assistant") return messages;
      const updated: TuiMessage = { ...message, content: update(message.content), streaming };
      // Replace only the changed item — keep references for all others
      const next = messages.slice();
      next[idx] = updated;
      return next;
    });
  }

  private updateReasoning(id: number, update: (content: string) => string, streaming?: boolean): void {
    this.setMessages((messages) => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx === -1) return messages;
      const message = messages[idx];
      if (message.type !== "reasoning") return messages;
      const updated: TuiMessage =
        streaming === undefined
          ? { ...message, content: update(message.content) }
          : { ...message, content: update(message.content), streaming };
      const next = messages.slice();
      next[idx] = updated;
      return next;
    });
  }

  private updateToolResult(
    id: number,
    update: (message: Extract<TuiMessage, { type: "tool-result" }>) => Extract<TuiMessage, { type: "tool-result" }>,
  ): void {
    this.setMessages((messages) => {
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0) return messages;
      const message = messages[index];
      if (message.type !== "tool-result") return messages;
      const next = messages.slice();
      next[index] = update(message);
      return next;
    });
  }

  /**
   * Mark every currently-streaming reasoning block as completed.
   *
   * Called when the agent moves on to the next activity (text response,
   * tool call, narration, permission request, turn end) so that finished
   * long thoughts can collapse in the transcript. The reasoning→messageId
   * map is preserved by default so a later `assistant_text_done` can still
   * finalize the same block instead of creating a duplicate.
   */
  private finalizeStreamingReasoning(clearMap = false): void {
    if (this.reasoningTuiIds.size === 0) return;
    this.setMessages((messages) => {
      let changed = false;
      const next = messages.slice();
      for (let i = 0; i < next.length; i++) {
        const m = next[i];
        if (m.type === "reasoning" && m.streaming) {
          next[i] = { ...m, streaming: false };
          changed = true;
        }
      }
      return changed ? next : messages;
    });
    if (clearMap) this.reasoningTuiIds.clear();
  }

  /** Refresh file tree asynchronously to reflect newly created/deleted files. */
  private refreshFileTreeDeferred(): void {
    if (this.fileTreeRefreshTimer) return;
    const cwd = this.options.cwd;
    this.fileTreeRefreshTimer = setTimeout(() => {
      this.fileTreeRefreshTimer = null;
      this.setFileTree(buildFileTree(cwd));
    }, PROJECT_INFO_REFRESH_DELAY_MS);
  }

  /** Refresh git change stats asynchronously to avoid blocking the render loop. */
  private refreshChangesDeferred(): void {
    if (this.changesRefreshTimer) return;
    const cwd = this.options.cwd;
    // Use setImmediate-like scheduling to defer the blocking git call
    this.changesRefreshTimer = setTimeout(() => {
      this.changesRefreshTimer = null;
      this.setChanges(readChangeStats(cwd));
    }, PROJECT_INFO_REFRESH_DELAY_MS);
  }

  /**
   * Confirm or deny a dangerous operation from the trust dialog.
   * Public API for TrustDialog component (Phase 2.5 A3).
   */
  confirmDecision(decision: "once" | "session" | "repo" | "full" | "deny"): void {
    const confirmation = this.confirmation();
    if (!confirmation) return;
    confirmation.resolve(decision);
    if (decision === "repo" || decision === "full") this.setPermissionMode(decision);
    this.setConfirmation(null);
    this.setInputValue("");
    this.add({
      type: decision === "deny" ? "error" : "success",
      content: this.l(
        decision === "deny"
          ? "tui.info.denied"
          : decision === "session"
            ? "tui.permissions.sessionApproved"
            : decision === "repo"
              ? "tui.permissions.repoApproved"
              : decision === "full"
                ? "tui.permissions.fullApproved"
                : "tui.info.allowed",
      ),
    });
    this.setStatus(this.isProcessing() ? this.l("tui.status.working") : this.l("tui.status.idle"));
  }

  answerClarification(choice: string, other?: string): void {
    const event = this.clarification();
    if (!event) return;
    event.resolve({ status: "answered", choice, ...(other ? { other } : {}) });
    this.setClarification(null);
    this.setInputValue("");
    this.setStatus(this.isProcessing() ? this.l("tui.status.working") : this.l("tui.status.idle"));
    if (this.isProcessing()) this.startNoodle();
  }

  declineClarification(): void {
    const event = this.clarification();
    if (!event) return;
    event.resolve({ status: "declined" });
    this.setClarification(null);
    this.setInputValue("");
    this.setStatus(this.isProcessing() ? this.l("tui.status.working") : this.l("tui.status.idle"));
    if (this.isProcessing()) this.startNoodle();
  }

  cancelClarification(): void {
    const event = this.clarification();
    if (!event) return;
    event.resolve({ status: "cancelled" });
    this.setClarification(null);
    this.setInputValue("");
  }

  private resolveClarificationInput(input: string): void {
    const event = this.clarification();
    if (!event || !input) return;
    const normalized = input.toLocaleLowerCase();
    const numericIndex = /^\d+$/.test(normalized) ? Number(normalized) - 1 : -1;
    const selected = numericIndex >= 0
      ? event.request.options[numericIndex]
      : event.request.options.find((option) =>
          option.id.toLocaleLowerCase() === normalized || option.label.toLocaleLowerCase() === normalized
        );
    if (selected) {
      this.answerClarification(selected.id);
      return;
    }
    if (event.request.allowOther) this.answerClarification("other", input);
  }

  private resolveConfirmation(input: string): void {
    const confirmation = this.confirmation();
    if (!confirmation) return;
    const normalized = input.toLowerCase();
    const decision =
      normalized === "y" || normalized === "yes"
        ? "once"
        : normalized === "s" || normalized === "session"
          ? "session"
          : normalized === "r" || normalized === "repo"
            ? "repo"
            : normalized === "f" || normalized === "full"
              ? "full"
            : "deny";
    this.confirmDecision(decision);
  }

  private onCommandOutput(event: { type: string; [key: string]: unknown }): void {
    if (event.type === "error") this.add({ type: "error", content: String(event.message) });
    if (event.type === "info") this.add({ type: "info", content: String(event.message) });
    if (event.type === "capsule_create_start") {
      this.add({ type: "info", content: String(event.message) });
      this.setStatus(this.l("command.capsule.create.start"));
    }
    if (event.type === "language_changed") {
      this.setLocaleRevision((revision) => revision + 1);
      this.add({ type: "info", content: String(event.message) });
      this.setStatus(this.l("tui.status.idle"));
    }
    if (event.type === "compaction_start") {
      const tokensBefore = Number(event.tokensBefore) || 0;
      const hardLimit = Number(event.hardLimit) || this.options.contextWindow;
      const percent = hardLimit > 0 ? Math.round((tokensBefore / hardLimit) * 100) : 0;
      this.setActiveCompaction(true);
      this.setStatus(this.l("tui.status.compactingPercent", { percent }));
    }
    if (event.type === "compaction_skipped" || event.type === "compaction_cancelled" || event.type === "compaction_failed") {
      this.setActiveCompaction(false);
      this.setStatus(this.l("tui.status.idle"));
      void this.runNextQueued();
    }
    if (event.type === "theme_changed" && isTuiThemeName(event.theme)) {
      this.setThemeName(event.theme);
      this.setStatus(this.l("tui.status.theme", { name: String(event.theme) }));
    }
    if (event.type === "model_changed" && typeof event.model === "string") {
      this.setModel(event.model);
    }
    if (event.type === "trust_changed") {
      this.refreshProjectTrust();
    }
    if (event.type === "compaction_done") {
      this.addCompactionSummary(event as {
        trigger?: unknown;
        tokensBefore?: unknown;
        tokensAfter?: unknown;
        checkpointId?: unknown;
      });
      this.setActiveCompaction(false);
      this.setStatus(this.l("tui.status.idle"));
      void this.runNextQueued();
    }
    if (event.type === "capsule_create_done") this.setStatus(this.l("tui.status.idle"));
  }

  private addCompactionSummary(event: {
    trigger?: unknown;
    tokensBefore?: unknown;
    tokensAfter?: unknown;
    checkpointId?: unknown;
    portableState?: unknown;
  }): void {
    const checkpointId = typeof event.checkpointId === "string" ? event.checkpointId : null;
    if (checkpointId && this.displayedCompactionCheckpoints.has(checkpointId)) return;
    if (checkpointId) this.displayedCompactionCheckpoints.add(checkpointId);
    const before = Number(event.tokensBefore) || 0;
    const after = Number(event.tokensAfter) || 0;
    const percent = before > 0 ? Math.max(0, Math.round(((before - after) / before) * 100)) : 0;
    const stateSummary = checkpointId ? this.compactionStateSummary(checkpointId, event.portableState) : "";
    this.add({
      type: "success",
      content: this.l("tui.compact.completeDetailed", {
        trigger: typeof event.trigger === "string" ? event.trigger : "manual",
        before,
        after,
        percent,
        capsule: checkpointId ?? "—",
        summary: stateSummary ? ` · ${stateSummary}` : "",
      }),
    });
  }

  private compactionStateSummary(checkpointId: string, suppliedState?: unknown): string {
    const loop = this.options.agentLoop as typeof this.options.agentLoop & {
      getSessionManager?: () => { getEntries?: () => Array<Record<string, unknown>> };
    };
    const entries = (loop.getSessionManager?.().getEntries?.() ?? []) as unknown as Array<Record<string, unknown>>;
    const capsule = entries
      .find((entry) => entry.type === "context_capsule" && entry.checkpointId === checkpointId);
    const state = (suppliedState ?? capsule?.portableState) as {
      goal?: unknown;
      completed?: unknown;
      inProgress?: unknown;
      pending?: unknown;
    } | undefined;
    if (!state) return "";
    const completed = Array.isArray(state.completed)
      ? state.completed.filter((item): item is string => typeof item === "string")
      : [];
    const inProgress = Array.isArray(state.inProgress)
      ? state.inProgress.filter((item): item is string => typeof item === "string")
      : [];
    const pending = Array.isArray(state.pending)
      ? state.pending.filter((item): item is string => typeof item === "string")
      : [];
    const text = completed[0] ?? inProgress[0] ?? pending[0]
      ?? (typeof state.goal === "string" ? state.goal : "");
    if (!text) return "";
    const suffix = completed.length > 1 ? ` (+${completed.length - 1})` : "";
    const normalized = `${text}${suffix}`.replaceAll(/\s+/g, " ").trim();
    return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157).trimEnd()}...`;
  }

  private restoreLastCompaction(): void {
    const loop = this.options.agentLoop as typeof this.options.agentLoop & {
      getSessionManager?: () => { getEntries?: () => Array<{ type: string }> };
    };
    const entries = loop.getSessionManager?.().getEntries?.() ?? [];
    const capsuleEntry = [...entries].reverse().find((entry) => entry.type === "context_capsule");
    if (!capsuleEntry) return;
    const capsule = capsuleEntry as unknown as Record<string, unknown>;
    const metrics = capsule.metrics as { effectiveTokensBefore?: number; estimatedTokensAfter?: number } | undefined;
    this.addCompactionSummary({
      trigger: capsule.trigger,
      tokensBefore: metrics?.effectiveTokensBefore,
      tokensAfter: metrics?.estimatedTokensAfter,
      checkpointId: capsule.checkpointId,
      portableState: capsule.portableState,
    });
  }

  private startNoodle(): void {
    if (this.noodleTimer) return;
    this.setNoodleFrame(0);
    this.noodleTimer = setInterval(() => {
      this.setNoodleFrame((frame) => ((frame ?? 0) + 1) % SYNTHWAVE_NOODLE_FRAMES.length);
    }, 120);
  }

  private stopNoodle(): void {
    if (this.noodleTimer) clearInterval(this.noodleTimer);
    this.noodleTimer = null;
    this.setNoodleFrame(null);
  }
}
