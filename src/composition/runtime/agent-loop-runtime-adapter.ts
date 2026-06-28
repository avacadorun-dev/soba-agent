import { commandService, type ListCommandsInput, type RuntimeCommandMetadata } from "../../application/command-service";
import type {
  CreateSessionInput,
  ListSessionsInput,
  LoadSessionInput,
  OpenSessionInput,
  ResumeSessionInput,
  RuntimeCommandExecutor,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeSessionConfigOption,
  RuntimeSessionInfo,
  RuntimeSessionSnapshot,
  SetSessionConfigInput,
  SetSessionModeInput,
  SobaRuntime,
  TurnResult,
  UserTurnInput,
} from "../../application/types";
import { runtimeBlocksToText } from "../../application/types";
import type { AgentLoop } from "../../engine/turn/agent-loop";
import type { AgentEvent } from "../../engine/turn/types";
import type { ProviderRegistry } from "../../infrastructure/llm/providers/registry";
import type { PersistentSessionLifecycleService } from "../../infrastructure/persistence/sessions/session-lifecycle-service";
import type { SessionManager } from "../../infrastructure/persistence/sessions/session-manager";
import {
  buildProviderConfigOptions,
  providerHasCredentials,
  usableModelForProvider,
} from "./create-provider-stack";

export class AgentLoopRuntimeAdapter implements SobaRuntime {
  private readonly loop: AgentLoop;
  private session: SessionManager;
  private readonly sessionLifecycle: PersistentSessionLifecycleService;
  private readonly providerRegistry: ProviderRegistry;
  private commandExecutor?: RuntimeCommandExecutor;
  private readonly runtimeListeners = new Set<RuntimeEventListener>();

  constructor(loop: AgentLoop, session: SessionManager, sessionLifecycle: PersistentSessionLifecycleService, providerRegistry: ProviderRegistry) {
    this.loop = loop;
    this.session = session;
    this.sessionLifecycle = sessionLifecycle;
    this.providerRegistry = providerRegistry;
  }

  async createSession(input: CreateSessionInput): Promise<RuntimeSessionInfo> {
    const session = this.sessionLifecycle.createSessionManager(input);
    this.activateSession(session);
    return this.activeSessionInfo();
  }

  async openSession(input: OpenSessionInput): Promise<RuntimeSessionInfo> {
    const session = this.sessionLifecycle.openSessionManager(input);
    this.activateSession(session);
    return this.activeSessionInfo();
  }

  async loadSession(input: LoadSessionInput): Promise<RuntimeSessionSnapshot> {
    const session = this.sessionLifecycle.loadSessionManager(input);
    this.activateSession(session);
    return {
      info: this.activeSessionInfo(),
      entries: session.getEntries(),
    };
  }

  async resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionInfo> {
    const session = this.sessionLifecycle.resumeSessionManager(input);
    this.activateSession(session);
    return this.activeSessionInfo();
  }

  async listSessions(input: ListSessionsInput): Promise<RuntimeSessionInfo[]> {
    return this.sessionLifecycle.listSessions(input);
  }

  listCommands(input?: ListCommandsInput): RuntimeCommandMetadata[] {
    return commandService.listCommands(input);
  }

  getSessionManager(): SessionManager {
    return this.session;
  }

  activateSessionManager(session: SessionManager): void {
    this.activateSession(session);
  }

  setCommandExecutor(commandExecutor: RuntimeCommandExecutor | undefined): void {
    this.commandExecutor = commandExecutor;
  }

  async listSessionConfigOptions(sessionId: string): Promise<RuntimeSessionConfigOption[]> {
    this.assertActiveSession(sessionId);
    return buildProviderConfigOptions(this.providerRegistry);
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessionLifecycle.closeSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (sessionId === this.session.getSessionId()) {
      this.loop.abort();
    }
    this.sessionLifecycle.deleteSession(sessionId);
  }

  async setSessionConfig(input: SetSessionConfigInput): Promise<RuntimeSessionInfo> {
    this.assertActiveSession(input.sessionId);
    const value = typeof input.value === "string" ? input.value : "";
    if (input.key === "provider") {
      const provider = this.providerRegistry.getProvider(value);
      if (!provider) throw new Error(`Unknown provider "${value}"`);
      if (!providerHasCredentials(this.providerRegistry, provider)) {
        return this.activeSessionInfo();
      }
      const model = await usableModelForProvider(this.providerRegistry, provider);
      if (!model) throw new Error(`Provider "${value}" has no available models.`);
      if (!this.providerRegistry.setActive(provider.id, model.id)) {
        throw new Error(`Could not switch provider to "${value}".`);
      }
      await this.providerRegistry.persistConfig();
    } else if (input.key === "model") {
      const provider = this.providerRegistry.getActiveProvider();
      const client = this.providerRegistry.switchModel(provider.id, value);
      if (!client) throw new Error(`Could not switch model to "${value}".`);
      await this.providerRegistry.persistConfig();
    }
    return this.activeSessionInfo();
  }

  async setSessionMode(input: SetSessionModeInput): Promise<RuntimeSessionInfo> {
    this.assertActiveSession(input.sessionId);
    return this.activeSessionInfo();
  }

  async runTurn(input: UserTurnInput): Promise<TurnResult> {
    this.assertActiveSession(input.sessionId);
    const command = commandTextFromTurn(input);
    if (command && this.commandExecutor) {
      const result = await this.commandExecutor({
        command,
        source: input.source,
        emit: (event) => this.emitRuntimeEvent(event),
      });
      if (result.handled) {
        return emptyCommandTurnResult();
      }
      if (result.prompt) {
        return this.loop.runTurn(result.prompt);
      }
    }
    return this.loop.runTurn(runtimeBlocksToText(input.content));
  }

  cancelTurn(sessionId: string): void {
    this.assertActiveSession(sessionId);
    this.loop.abort();
  }

  onEvent(listener: RuntimeEventListener): () => void {
    this.runtimeListeners.add(listener);
    const unsubscribeLoop = this.loop.onEvent(listener as (event: AgentEvent) => void);
    return () => {
      this.runtimeListeners.delete(listener);
      unsubscribeLoop();
    };
  }

  private emitRuntimeEvent(event: RuntimeEvent): void {
    for (const listener of this.runtimeListeners) {
      try {
        listener(event);
      } catch {
        // Keep runtime command output best-effort, matching AgentLoop event dispatch.
      }
    }
  }

  private assertActiveSession(sessionId: string): void {
    if (sessionId !== this.session.getSessionId()) {
      throw new Error(`Runtime session ${sessionId} is not active.`);
    }
  }

  private activeSessionInfo(): RuntimeSessionInfo {
    return {
      id: this.session.getSessionId(),
      cwd: this.session.getCwd(),
    };
  }

  private activateSession(session: SessionManager): void {
    this.session = session;
    this.loop.setSessionManager(session);
  }
}

function commandTextFromTurn(input: UserTurnInput): string | undefined {
  if (input.command) {
    const name = input.command.name.startsWith("/") ? input.command.name : `/${input.command.name}`;
    return [name, ...input.command.args].join(" ").trim();
  }

  const firstBlock = input.content[0];
  if (firstBlock?.type !== "text" || !firstBlock.text.startsWith("/")) {
    return undefined;
  }

  return runtimeBlocksToText(input.content);
}

function emptyCommandTurnResult(): TurnResult {
  return {
    items: [],
    response: {} as TurnResult["response"],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    errors: [],
    activeErrors: [],
  };
}
