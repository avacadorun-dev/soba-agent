import type { ReasoningSelection } from "../../kernel/model/reasoning";
import type { InputImageContent, InputTextContent } from "../../kernel/transcript/types";
import type { WorkMode } from "../../kernel/work-mode/public";
import type { ModelDefinition, ProviderDefinition, TestResult } from "../providers/public";
import type { PermissionMode } from "../trust/trust-manager";

export type { ReasoningSelection } from "../../kernel/model/reasoning";
export {
  formatReasoningSelection,
  reasoningSelectionToConfigValue,
} from "../../kernel/model/reasoning";
export { CURRENT_SESSION_VERSION } from "../../kernel/session/version";
export type { InputImageContent, InputTextContent, SessionInfo } from "../../kernel/transcript/types";
export type { WorkMode } from "../../kernel/work-mode/public";
export {
  isRestrictedWorkMode,
  isWorkMode,
  normalizeWorkModeId,
  WORK_MODES,
} from "../../kernel/work-mode/public";
export { detectLocale, I18n, isLocale, resetI18n } from "../../shared/i18n/i18n";
export type { Locale, TranslationKey } from "../../shared/i18n/types";
export type {
  CommandResult,
  ListCommandsInput,
  ParsedRuntimeCommand,
  RuntimeCommandMetadata,
  RuntimeCommandName,
  RuntimeCommandSurface,
} from "../command-service";
export {
  CommandService,
  commandService,
  listRuntimeCommands,
  parseRuntimeCommandInput,
  RUNTIME_COMMANDS,
} from "../command-service";
export type {
  PlanCommandController,
  PlanCommandView,
} from "../commands/plan";
export { executePlanCommand } from "../commands/plan";
export type {
  SobaConfig,
  TuiThemeName,
} from "../config/types";
export {
  DEFAULT_CONFIG,
  isTuiThemeName,
  TUI_THEME_NAMES,
} from "../config/types";
export type {
  ParsedEvidenceHandoff,
  SplitEvidenceHandoffResult,
} from "../evidence-handoff";
export {
  formatParsedEvidenceHandoff,
  splitEvidenceHandoff,
} from "../evidence-handoff";
export type {
  ModelDefinition,
  ProviderDefinition,
  TestResult,
} from "../providers/public";
export {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
  findBuiltinProvider,
} from "../providers/public";
export type { ProjectTrustStoreOptions } from "../skills/project-trust-store";
export { ProjectTrustStore } from "../skills/project-trust-store";
export type {
  PermissionMode,
  TrustCheckResult,
  TrustLevel,
  TrustManagerOptions,
  TrustRule,
} from "../trust/trust-manager";
export { TrustManager } from "../trust/trust-manager";
export type {
  CreateSessionInput,
  ListSessionsInput as RuntimeListSessionsInput,
  LoadSessionInput,
  OpenSessionInput,
  ResumeSessionInput,
  RuntimeCommandExecutionInput,
  RuntimeCommandExecutor,
  RuntimeCommandInput,
  RuntimeContentBlock,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeSessionConfigOption,
  RuntimeSessionInfo,
  RuntimeSessionSnapshot,
  RuntimeSource,
  SetSessionConfigInput,
  SetSessionModeInput,
  SobaRuntime,
  TurnResult,
  Unsubscribe,
  UserTurnInput,
} from "../types";

export interface RuntimeAgentTrustController {
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  clearSessionApprovals(): void;
}

export interface RuntimeAgentSessionView {
  isPersisted(): boolean;
  getSessionId(): string;
  getEntries?(): Array<{ type: string }>;
}

export interface RuntimeAgentContextDebugInfo {
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
}

export interface RuntimeAgentContextView {
  getDebugInfo(): RuntimeAgentContextDebugInfo;
}

export interface RuntimeAgentHandle {
  getTrustManager?(): RuntimeAgentTrustController;
  getWorkMode?(): WorkMode;
  setWorkMode?(mode: WorkMode): void;
  setClarificationAvailable?(available: boolean): void;
  getModel(): string;
  getSessionManager(): RuntimeAgentSessionView;
  getContextManager(): RuntimeAgentContextView | undefined;
  abortActiveTool(): boolean;
  abort(): void;
  runTurn(userInput: string | Array<InputTextContent | InputImageContent>): Promise<unknown>;
  runShellCommand(command: string, silent?: boolean): Promise<unknown>;
}

export interface RuntimeModelChange {
  providerId: string;
  modelId: string;
  previous: { providerId: string; modelId: string };
}

export type RuntimeModelChangeHandler = (info: RuntimeModelChange) => void;

export interface RuntimeModelChangeSource {
  onChange(handler: RuntimeModelChangeHandler): () => void;
  notifyChange(): boolean;
}

export type RuntimeModelDiscoveryStatus =
  | { kind: "loaded" }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

export interface RuntimeProviderCatalog {
  getActiveProvider(): ProviderDefinition;
  getActiveModel(): ModelDefinition;
  getAllProviders(): ProviderDefinition[];
  getModelsFor(providerId: string): ModelDefinition[];
  getModelDiscoveryStatus(providerId: string): RuntimeModelDiscoveryStatus;
  getProvider(providerId: string): ProviderDefinition | undefined;
  getModel(providerId: string, modelId: string): ModelDefinition | undefined;
  getActiveClientConfig(): {
    reasoning?: ReasoningSelection;
    reasoningEffective?: ReasoningSelection;
    reasoningFallbackReason?: string;
  };
  switchModel(providerId: string, modelId: string): unknown;
  refreshBuiltinModels(onUpdate?: () => void): Promise<void>;
  testConnection(
    providerId: string,
    modelId: string,
    options?: { signal?: AbortSignal; apiKey?: string; baseUrl?: string },
  ): Promise<TestResult>;
}
