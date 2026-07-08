import type { CommandResult, I18n, ProjectTrustStore, RuntimeAgentHandle, RuntimeModelChangeSource, SobaRuntime, TuiThemeName } from "../../../../application/ui/public";
import type { TuiEvidenceSummary } from "../lib/evidence-summary";
import type { ComposerBlock } from "../lib/rich-paste";
import type { NotificationStore } from "./notification-store";
import type { ProviderStore } from "./provider-store";

export type CommandOutput = { type: string; timestamp: number; [key: string]: unknown };

export interface InteractiveTUIOptions {
  cwd: string;
  tokenBudget: number;
  contextWindow: number;
  theme: TuiThemeName;
  runtime?: SobaRuntime;
  /** Legacy transition handle for shell shortcuts, status data and cancellation. */
  agentLoop: RuntimeAgentHandle;
  toolNames: string[];
  executeCommand: (input: string, output: (event: CommandOutput) => void) => Promise<CommandResult>;
  /** I18n instance for localized status messages (optional, defaults to English). */
  i18n?: I18n;
  /** Project trust store for displaying trust status in the header. */
  trustStore?: ProjectTrustStore;
  /** Notification store for TUI notifications system (Phase 2.5 A2). */
  notificationStore?: NotificationStore;
  /** Client proxy for subscribing to model changes (keeps sidebar model in sync). */
  clientProxy?: RuntimeModelChangeSource;
  /** Provider store for showing active provider name in sidebar. */
  providerStore?: ProviderStore;
  // ─── Agent configuration parameters (displayed in sidebar) ───
  /** Enable debug mode — writes loop decision entries to session JSONL. */
  debug: boolean;
  /** Maximum output tokens per model response. */
  maxOutputTokens: number;
  /** Maximum reasoning/completion tokens per model response (0 = unlimited). */
  maxCompletionTokens: number;
  /** Emergency ceiling for model invocations per task (0 = unlimited). */
  maxAgentIterations: number;
  /** Consecutive no-progress tool iterations before stall recovery. */
  maxStalledIterations: number;
  /** Maximum wall-clock duration of one task in minutes (0 = unlimited). */
  maxRunMinutes: number;
  /** Whether proactive auto-compaction is enabled. */
  autoCompact: boolean;
}

export interface QueuedMessage {
  id: number;
  content: string;
  blocks?: ComposerBlock[];
  kind: "message" | "shell" | "shell-silent";
}

export type TuiMessage =
  | { id: number; type: "user"; content: string }
  | { id: number; type: "assistant"; content: string; streaming: boolean }
  | { id: number; type: "evidence"; summary: TuiEvidenceSummary }
  | { id: number; type: "reasoning"; content: string; streaming: boolean }
  | { id: number; type: "narration"; eventType: string; content: string; evidenceIds: string[] }
  | { id: number; type: "tool-start"; toolName: string; summary: string }
  | {
      id: number;
      type: "tool-result";
      content: string;
      isError: boolean;
      isDiff: boolean;
      toolName: string;
      summary: string;
      toolCallId?: string;
      details?: string[];
      durationMs?: number;
    }
  | { id: number; type: "tool-end"; toolName: string; durationMs: number }
  | { id: number; type: "info" | "error" | "warning" | "success"; content: string };

export type TuiMessageInput = TuiMessage extends infer Message
  ? Message extends { id: number }
    ? Omit<Message, "id">
    : never
  : never;

export interface ChangeStat {
  path: string;
  added: number;
  removed: number;
}

export type SidebarMode = "session" | "changes" | "files" | "tools" | "debug" | "help";

export const SIDEBAR_MODES: SidebarMode[] = ["session", "changes", "files", "tools", "debug", "help"];

export type ActivePane = "input" | "output" | "sidebar" | "overlay";
