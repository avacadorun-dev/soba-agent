import { commandService, type ListCommandsInput, type RuntimeCommandMetadata } from "../../application/command-service";
import type { SkillManager } from "../../application/skills/skill-manager";
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
import type { PermissionMode } from "../../kernel/permissions/trust";
import type { InputImageContent, InputTextContent } from "../../kernel/transcript/types";
import { normalizeWorkModeId } from "../../kernel/work-mode/public";
import {
  buildProviderConfigOptions,
  providerHasCredentials,
  usableModelForProvider,
} from "./create-provider-stack";
import { reconcileActiveSkills } from "./create-skill-stack";

export class AgentLoopRuntimeAdapter implements SobaRuntime {
  private readonly loop: AgentLoop;
  private session: SessionManager;
  private readonly sessionLifecycle: PersistentSessionLifecycleService;
  private readonly providerRegistry: ProviderRegistry;
  private readonly skillManager?: SkillManager;
  private commandExecutor?: RuntimeCommandExecutor;
  private readonly runtimeListeners = new Set<RuntimeEventListener>();
  private sessionGate: Promise<void> = Promise.resolve();

  constructor(
    loop: AgentLoop,
    session: SessionManager,
    sessionLifecycle: PersistentSessionLifecycleService,
    providerRegistry: ProviderRegistry,
    skillManager?: SkillManager,
  ) {
    this.loop = loop;
    this.session = session;
    this.sessionLifecycle = sessionLifecycle;
    this.providerRegistry = providerRegistry;
    this.skillManager = skillManager;
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
    if (isPermissionMode(input.mode)) {
      this.loop.getTrustManager().setPermissionMode(input.mode);
      return this.activeSessionInfo();
    }
    const workMode = normalizeWorkModeId(input.mode);
    if (workMode) {
      this.loop.setWorkMode(workMode);
      return this.activeSessionInfo();
    }
    throw new Error(`Unsupported session mode "${input.mode}".`);
  }

  async runTurn(input: UserTurnInput): Promise<TurnResult> {
    const previous = this.sessionGate;
    let release!: () => void;
    this.sessionGate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.runTurnExclusive(input);
    } finally {
      release();
    }
  }

  private async runTurnExclusive(input: UserTurnInput): Promise<TurnResult> {
    this.assertActiveSession(input.sessionId);
    this.setClarificationAvailable(input.clarificationAvailable === true);
    const command = commandTextFromTurn(input);
    if (command && this.commandExecutor) {
      const result = await this.commandExecutor({
        command,
        source: input.source,
        emit: (event) => this.emitRuntimeEvent(event),
      });
      if (result.handled) {
        this.setClarificationAvailable(false);
        return emptyCommandTurnResult();
      }
      if (result.prompt) {
        try {
          return await this.loop.runTurn(result.prompt);
        } finally {
          this.setClarificationAvailable(false);
        }
      }
    }
    try {
      return await this.loop.runTurn(runtimeBlocksToUserContent(input.content));
    } finally {
      this.setClarificationAvailable(false);
    }
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

  private setClarificationAvailable(available: boolean): void {
    (this.loop as AgentLoop & { setClarificationAvailable?: (value: boolean) => void })
      .setClarificationAvailable?.(available);
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
    if (this.skillManager) {
      reconcileActiveSkills(this.skillManager, session);
    }
  }
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === "ask" || value === "repo" || value === "full";
}

function runtimeBlocksToUserContent(blocks: UserTurnInput["content"]): Array<InputTextContent | InputImageContent> {
  const content: Array<InputTextContent | InputImageContent> = [];
  for (const block of blocks) {
    if (block.type === "text") {
      content.push({ type: "input_text", text: block.text });
    } else if (block.type === "resource") {
      content.push({ type: "input_text", text: `\n\n[Resource: ${block.uri}]\n${block.text}` });
    } else if (block.type === "resource_link") {
      content.push({ type: "input_text", text: `\n\n[Resource link: ${block.name}](${block.uri})` });
    } else if (block.type === "image") {
      content.push({ type: "input_image", image_url: `data:${block.mimeType};base64,${block.data}`, detail: "auto" });
    } else {
      content.push({ type: "input_text", text: `\n\n[Audio: ${block.mimeType}]` });
    }
  }
  return content;
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
