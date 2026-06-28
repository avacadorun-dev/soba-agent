import type { AgentEvent, AgentTurnResult } from "../engine/turn/types";
import type { SessionInfo } from "../kernel/transcript/types";
import type { CommandResult, ListCommandsInput, RuntimeCommandMetadata } from "./command-service";

export type { CommandResult, ListCommandsInput, RuntimeCommandMetadata } from "./command-service";

export type RuntimeSource = "print" | "tui" | "acp";

export type RuntimeContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; uri: string; text: string; mimeType?: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string };

export interface RuntimeCommandInput {
  name: string;
  args: string[];
}

export interface UserTurnInput {
  sessionId: string;
  content: RuntimeContentBlock[];
  source: RuntimeSource;
  command?: RuntimeCommandInput;
}

export type RuntimeEvent = AgentEvent;
export type RuntimeEventListener = (event: RuntimeEvent) => void;
export type Unsubscribe = () => void;
export type TurnResult = AgentTurnResult;

export interface RuntimeCommandExecutionInput {
  command: string;
  source: RuntimeSource;
  emit: (event: RuntimeEvent) => void;
}

export type RuntimeCommandExecutor = (input: RuntimeCommandExecutionInput) => CommandResult | Promise<CommandResult>;

export interface CreateSessionInput {
  cwd: string;
}

export interface OpenSessionInput {
  cwd: string;
  sessionId: string;
}

export interface LoadSessionInput {
  sessionId: string;
}

export interface ResumeSessionInput {
  sessionId: string;
}

export interface ListSessionsInput {
  cwd: string;
}

export interface SetSessionConfigInput {
  sessionId: string;
  key: string;
  value: unknown;
}

export interface SetSessionModeInput {
  sessionId: string;
  mode: string;
  enabled: boolean;
}

export interface RuntimeSessionConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: "select";
  currentValue: string;
  options: Array<{
    value: string;
    name: string;
    description?: string | null;
  }>;
}

export interface RuntimeSessionInfo {
  id: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  entries?: number;
}

export interface RuntimeSessionSnapshot {
  info: RuntimeSessionInfo;
  entries: unknown[];
}

export interface SobaRuntime {
  createSession(input: CreateSessionInput): Promise<RuntimeSessionInfo>;
  openSession(input: OpenSessionInput): Promise<RuntimeSessionInfo>;
  loadSession(input: LoadSessionInput): Promise<RuntimeSessionSnapshot>;
  resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionInfo>;
  listSessions(input: ListSessionsInput): Promise<RuntimeSessionInfo[]>;
  listCommands(input?: ListCommandsInput): RuntimeCommandMetadata[];
  listSessionConfigOptions?(sessionId: string): Promise<RuntimeSessionConfigOption[]>;
  closeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionConfig(input: SetSessionConfigInput): Promise<RuntimeSessionInfo>;
  setSessionMode(input: SetSessionModeInput): Promise<RuntimeSessionInfo>;
  runTurn(input: UserTurnInput): Promise<TurnResult>;
  cancelTurn(sessionId: string): void;
  onEvent(listener: RuntimeEventListener): Unsubscribe;
}

export function sessionInfoToRuntime(info: SessionInfo): RuntimeSessionInfo {
  return {
    id: info.id,
    cwd: info.cwd,
    updatedAt: info.timestamp,
    entries: info.entries,
  };
}

export function runtimeBlocksToText(blocks: RuntimeContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "resource") return `\n\n[Resource: ${block.uri}]\n${block.text}`;
      if (block.type === "resource_link") return `\n\n[Resource link: ${block.name}](${block.uri})`;
      if (block.type === "image") return `\n\n[Image: ${block.mimeType}]`;
      return `\n\n[Audio: ${block.mimeType}]`;
    })
    .join("")
    .trim();
}
