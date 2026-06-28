import { homedir } from "node:os";
import { join } from "node:path";
import { commandService, type ListCommandsInput, type RuntimeCommandMetadata } from "../../application/command-service";
import type { CompactionConfig, SobaConfig } from "../../application/config/types";
import { McpRuntimeController } from "../../application/mcp-runtime-controller";
import type { ModelDefinition, ProviderDefinition } from "../../application/providers/types";
import { SessionLifecycleService } from "../../application/session-lifecycle";
import { SkillCatalog } from "../../application/skills/catalog";
import { SkillDiscovery } from "../../application/skills/discovery";
import { ProjectTrustStore } from "../../application/skills/project-trust-store";
import { SkillManager } from "../../application/skills/skill-manager";
import type { RuntimeToolDelegation } from "../../application/tool-delegation";
import { TrustManager } from "../../application/trust/trust-manager";
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
import { ContextManager } from "../../engine/compaction/context-manager";
import { BackgroundScheduler } from "../../engine/compaction/scheduler";
import { createMemoryTools } from "../../engine/memory/memory-tools";
import { ProjectMemory } from "../../engine/memory/project-memory";
import { AgentLoop } from "../../engine/turn/agent-loop";
import type { AgentEvent } from "../../engine/turn/types";
import { OpenResponsesClientProxy } from "../../infrastructure/llm/providers/client-proxy";
import { discoverModels, isLikelyChatModelId, toModelDefinitions } from "../../infrastructure/llm/providers/discovery";
import { ProviderRegistry } from "../../infrastructure/llm/providers/registry";
import type { McpClientManager } from "../../infrastructure/mcp/client-manager";
import { McpSecretStore } from "../../infrastructure/mcp/secret-store";
import type { SessionManager } from "../../infrastructure/persistence/sessions/session-manager";
import {
  createDelegatedBashTool,
  createDelegatedInspectFileTool,
  createDelegatedLsTool,
  createDelegatedReadTool,
  createDelegatedSearchFilesTool,
  createDelegatedWriteTool,
} from "../../infrastructure/tools/delegation";
import { bashTool } from "../../infrastructure/tools/local/bash";
import { checkpointTool } from "../../infrastructure/tools/local/checkpoint";
import { editTool } from "../../infrastructure/tools/local/edit";
import { inspectFileTool } from "../../infrastructure/tools/local/inspect-file";
import { lsTool } from "../../infrastructure/tools/local/ls";
import { readTool } from "../../infrastructure/tools/local/read";
import { searchFilesTool } from "../../infrastructure/tools/local/search-files";
import { writeTool } from "../../infrastructure/tools/local/write";
import { ToolRegistry } from "../../kernel/tools/tool-registry";

export interface RuntimeFactoryInput {
  cwd: string;
  session: SessionManager;
  config: SobaConfig;
  compactionConfig: CompactionConfig;
  interactive: boolean;
  modelExplicitlyPassed: boolean;
  baseUrlOverride?: string;
  baseUrlExplicitlyPassed?: boolean;
  apiKeyExplicitlyPassed?: boolean;
  noStream: boolean;
  stream: boolean;
  tokenBudget: number;
  debug: boolean;
  toolDelegation?: RuntimeToolDelegation;
  commandExecutorFactory?: (context: RuntimeCommandExecutorFactoryContext) => RuntimeCommandExecutor | undefined;
  providerRegistryConfigPath?: string;
}

export interface RuntimeCommandExecutorFactoryContext {
  client: OpenResponsesClientProxy;
  config: SobaConfig;
  contextManager: ContextManager;
  skillManager: SkillManager;
  agentLoop: AgentLoop;
  providerRegistry: ProviderRegistry;
  sessionLifecycle: SessionLifecycleService;
  setSession: (session: SessionManager) => void;
  mcpRuntime: McpRuntimeController;
  mcpManager?: McpClientManager;
  mcpSecretStore: McpSecretStore;
  toolRegistry: ToolRegistry;
  trustManager: TrustManager;
  getSession: () => SessionManager;
}

export interface SobaRuntimeComposition {
  runtime: SobaRuntime;
  agentLoop: AgentLoop;
  providerRegistry: ProviderRegistry;
  client: OpenResponsesClientProxy;
  tools: ToolRegistry;
  projectMemory: ProjectMemory;
  trustManager: TrustManager;
  contextManager: ContextManager;
  backgroundScheduler: BackgroundScheduler;
  skillManager: SkillManager;
  skillCatalog: SkillCatalog;
  trustStore: ProjectTrustStore;
  sessionLifecycle: SessionLifecycleService;
  mcpSecretStore: McpSecretStore;
  mcpRuntime: McpRuntimeController;
  mcpManager?: McpClientManager;
}

class AgentLoopRuntimeAdapter implements SobaRuntime {
  private readonly loop: AgentLoop;
  private session: SessionManager;
  private readonly sessionLifecycle: SessionLifecycleService;
  private readonly providerRegistry: ProviderRegistry;
  private commandExecutor?: RuntimeCommandExecutor;
  private readonly runtimeListeners = new Set<RuntimeEventListener>();

  constructor(loop: AgentLoop, session: SessionManager, sessionLifecycle: SessionLifecycleService, providerRegistry: ProviderRegistry) {
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

function registerBuiltInTools(registry: ToolRegistry, delegation?: RuntimeToolDelegation): void {
  registry.register(delegation ? createDelegatedReadTool(delegation) : readTool);
  registry.register(delegation ? createDelegatedWriteTool(delegation) : writeTool);
  registry.register(delegation ? createDelegatedBashTool(delegation) : bashTool);
  registry.register(editTool);
  registry.register(delegation ? createDelegatedLsTool(delegation) : lsTool);
  registry.register(delegation ? createDelegatedSearchFilesTool(delegation) : searchFilesTool);
  registry.register(delegation ? createDelegatedInspectFileTool(delegation) : inspectFileTool);
  registry.register(checkpointTool);
  for (const memoryTool of createMemoryTools()) {
    registry.register(memoryTool);
  }
}

export async function createSobaRuntime(input: RuntimeFactoryInput): Promise<SobaRuntimeComposition> {
  const {
    cwd,
    session,
    config,
    compactionConfig,
    interactive,
    modelExplicitlyPassed,
    baseUrlOverride,
    baseUrlExplicitlyPassed,
    apiKeyExplicitlyPassed,
    noStream,
    stream,
    tokenBudget,
    debug,
    toolDelegation,
    commandExecutorFactory,
    providerRegistryConfigPath,
  } = input;

  const persistedRegistry = config.registry ?? await ProviderRegistry.loadFromFile(providerRegistryConfigPath);
  const providerRegistry = new ProviderRegistry(persistedRegistry ?? undefined, { configPath: providerRegistryConfigPath });
  const hasRegistry = Boolean(persistedRegistry);
  let cliProviderId: string | undefined;
  if (modelExplicitlyPassed || (!hasRegistry && config.model)) {
    for (const provider of providerRegistry.getAllProviders()) {
      if (providerRegistry.getModel(provider.id, config.model)) {
        cliProviderId = provider.id;
        break;
      }
    }
  }
  if (!cliProviderId && (!hasRegistry || baseUrlExplicitlyPassed)) {
    cliProviderId = providerRegistry.getAllProviders().find((provider) => provider.baseUrl === config.baseUrl)?.id;
  }
  if (cliProviderId) {
    providerRegistry.setActive(cliProviderId, config.model);
  }
  if (config.apiKey && (!hasRegistry || apiKeyExplicitlyPassed)) {
    providerRegistry.setApiKey(providerRegistry.getActiveProvider().id, config.apiKey);
  }
  await selectFallbackProviderWithCredentials(providerRegistry);
  await selectChatModelForActiveProvider(providerRegistry);

  const client = new OpenResponsesClientProxy(providerRegistry);
  const explicitBaseUrlOverride = baseUrlOverride ?? (baseUrlExplicitlyPassed ? config.baseUrl : undefined);
  if (explicitBaseUrlOverride) {
    providerRegistry.setBaseUrl(client.getActiveProviderId(), explicitBaseUrlOverride);
  }

  const tools = new ToolRegistry();
  registerBuiltInTools(tools, toolDelegation);

  const projectMemory = new ProjectMemory({ projectRoot: cwd });
  projectMemory.initialize();

  const sobaDir = join(homedir(), ".soba");
  const trustManager = new TrustManager();
  const mcpSecretStore = new McpSecretStore({ homeDir: homedir() });
  const mcpRuntime = new McpRuntimeController({
    projectRoot: cwd,
    secretStore: mcpSecretStore,
    toolRegistry: tools,
    trustManager,
  });
  await mcpRuntime.initialize();
  const mcpManager = mcpRuntime.getManager();

  const providerIdentity = client.getProviderIdentity();
  const providerCapabilities = client.getProviderCapabilities();
  const contextManager = new ContextManager(session, {
    compaction: compactionConfig,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    provider: providerIdentity,
    capabilities: providerCapabilities,
    generatorConfig: {
      modelInvoker: {
        invoke: async (prompt: string, _signal: AbortSignal): Promise<string> => {
          const response = await client.create({
            model: config.model,
            input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
            max_output_tokens: config.maxOutputTokens,
          });
          const textOutput = response.output.find((output) => output.type === "message" && output.role === "assistant");
          return textOutput && "content" in textOutput
            ? (textOutput as { content: Array<{ text: string }> }).content.map((content) => content.text).join("")
            : "";
        },
      },
    },
  });
  const backgroundScheduler = new BackgroundScheduler(session, contextManager, {
    backgroundTimeoutMs: compactionConfig.backgroundTimeoutMs,
  });

  const trustStore = new ProjectTrustStore({ sobaDir });
  const skillDiscovery = new SkillDiscovery({
    projectPath: cwd,
    userSkillsPath: join(sobaDir, "skills"),
    bundledSkillsPath: process.env.SOBA_BUNDLED_SKILLS_PATH ?? join(process.cwd(), "skills"),
    trustStore,
  });
  const skillCatalog = new SkillCatalog({ discovery: skillDiscovery });
  const skillManager = new SkillManager({
    catalog: skillCatalog,
    discovery: skillDiscovery,
    trustStore,
  });
  skillManager.refresh();

  if (skillCatalog.getModelInvocable().length > 0) {
    const { createActivateSkillTool } = await import("../../infrastructure/tools/local/activate-skill");
    tools.register(createActivateSkillTool({
      catalog: skillCatalog,
      onActivate: (ref) => {
        skillManager.activate(ref.name);
        session.appendSkillActivation({ action: "activate", skill: ref });
      },
      isActive: (name, revision) => skillManager.getActiveSkills().some(
        (skill) => skill.name === name && skill.revision === revision,
      ),
    }));
  }

  const useStreaming = noStream ? false : stream || interactive;
  const agentLoop = new AgentLoop(client, session, tools, cwd, {
    emitEvents: true,
    tokenBudget,
    stream: useStreaming,
    debug,
    maxAgentIterations: config.maxAgentIterations,
    maxStalledIterations: config.maxStalledIterations,
    maxRunDurationMs: config.maxRunMinutes * 60 * 1000,
    bashMaxTimeoutSeconds: config.bashMaxTimeoutSeconds,
  }, trustManager, undefined, contextManager, backgroundScheduler, skillManager, { enabled: compactionConfig.auto }, projectMemory);
  const sessionLifecycle = new SessionLifecycleService(cwd);
  const runtime = new AgentLoopRuntimeAdapter(agentLoop, session, sessionLifecycle, providerRegistry);
  const commandExecutor = commandExecutorFactory?.({
    client,
    config,
    contextManager,
    skillManager,
    agentLoop,
    providerRegistry,
    sessionLifecycle,
    setSession: (nextSession) => runtime.activateSessionManager(nextSession),
    mcpRuntime,
    mcpManager,
    mcpSecretStore,
    toolRegistry: tools,
    trustManager,
    getSession: () => runtime.getSessionManager(),
  });
  runtime.setCommandExecutor(commandExecutor);

  return {
    runtime,
    agentLoop,
    providerRegistry,
    client,
    tools,
    projectMemory,
    trustManager,
    contextManager,
    backgroundScheduler,
    skillManager,
    skillCatalog,
    trustStore,
    sessionLifecycle,
    mcpSecretStore,
    mcpRuntime,
    mcpManager,
  };
}

async function buildProviderConfigOptions(providerRegistry: ProviderRegistry): Promise<RuntimeSessionConfigOption[]> {
  const activeProvider = providerRegistry.getActiveProvider();
  await refreshModelsForProvider(providerRegistry, activeProvider);
  const activeModel = providerRegistry.getActiveModel();
  const providerOptions = providerRegistry.getAllProviders().map((provider) => ({
    value: provider.id,
    name: provider.name,
    description: providerHasCredentials(providerRegistry, provider)
      ? provider.baseUrl
      : `${provider.baseUrl} (missing ${provider.apiKeyEnv ?? "API key"})`,
  }));

  const models = providerRegistry.getModelsFor(activeProvider.id);
  const modelOptions = (models.length > 0 ? models : [activeModel]).map((model) => ({
    value: model.id,
    name: model.name,
    description: `${model.contextWindow.toLocaleString()} ctx, ${model.maxOutput.toLocaleString()} max output`,
  }));

  return [
    {
      id: "provider",
      name: "Provider",
      description: "Model provider used for new turns.",
      category: "model",
      type: "select",
      currentValue: activeProvider.id,
      options: providerOptions,
    },
    {
      id: "model",
      name: "Model",
      description: "Model used for new turns.",
      category: "model",
      type: "select",
      currentValue: activeModel.id,
      options: modelOptions,
    },
  ];
}

async function selectFallbackProviderWithCredentials(providerRegistry: ProviderRegistry): Promise<void> {
  const activeProvider = providerRegistry.getActiveProvider();
  if (providerHasCredentials(providerRegistry, activeProvider)) return;

  const fallback = await findFallbackProviderSelection(providerRegistry, activeProvider.id);
  if (fallback) {
    providerRegistry.setActive(fallback.providerId, fallback.modelId);
  }
}

async function selectChatModelForActiveProvider(providerRegistry: ProviderRegistry): Promise<void> {
  const activeProvider = providerRegistry.getActiveProvider();
  const activeModel = providerRegistry.getActiveModel();
  if (activeModel.id && isLikelyChatModelId(activeModel.id)) return;
  const model = await usableModelForProvider(providerRegistry, activeProvider);
  if (model && model.id !== activeModel.id) {
    providerRegistry.setActive(activeProvider.id, model.id);
  }
}

async function findFallbackProviderSelection(
  providerRegistry: ProviderRegistry,
  activeProviderId: string,
): Promise<{ providerId: string; modelId: string } | null> {
  for (const providerId of fallbackProviderIds(providerRegistry, activeProviderId)) {
    const provider = providerRegistry.getProvider(providerId);
    if (!provider || !providerHasCredentials(providerRegistry, provider)) continue;
    const model = await usableModelForProvider(providerRegistry, provider);
    if (model) return { providerId, modelId: model.id };
  }
  return null;
}

function fallbackProviderIds(providerRegistry: ProviderRegistry, activeProviderId: string): string[] {
  const savedProviderIds = Object.entries(providerRegistry.snapshotState().providers)
    .filter(([providerId, secret]) => providerId !== activeProviderId && Boolean(secret.apiKey))
    .map(([providerId]) => providerId);
  const remainingProviderIds = providerRegistry
    .getAllProviders()
    .map((provider) => provider.id)
    .filter((providerId) => providerId !== activeProviderId && !savedProviderIds.includes(providerId));
  return [...savedProviderIds, ...remainingProviderIds];
}

function providerHasCredentials(providerRegistry: ProviderRegistry, provider: ProviderDefinition): boolean {
  return !provider.apiKeyEnv || Boolean(providerRegistry.resolveApiKey(provider.id));
}

async function usableModelForProvider(providerRegistry: ProviderRegistry, provider: ProviderDefinition): Promise<ModelDefinition | null> {
  await refreshModelsForProvider(providerRegistry, provider);
  const existingModels = providerRegistry.getModelsFor(provider.id);
  const chatModels = existingModels.filter((model) => isLikelyChatModelId(model.id));
  const candidateModels = chatModels.length > 0 ? chatModels : existingModels;
  const existingModel =
    candidateModels.find((model) => model.id === provider.defaultModel) ??
    candidateModels.find((model) => model.id.toLowerCase().includes("chat")) ??
    candidateModels.find((model) => model.id.toLowerCase().includes("code")) ??
    candidateModels[0];
  if (existingModel) return existingModel;

  const discovery = await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
  if (!discovery.ok) return null;
  const discoveredModels = toModelDefinitions(discovery, provider);
  const discoveredChatModels = discoveredModels.filter((model) => isLikelyChatModelId(model.id));
  const discoveredCandidates = discoveredChatModels.length > 0 ? discoveredChatModels : discoveredModels;
  return discoveredCandidates.find((model) => model.id === discovery.suggestedDefault) ?? discoveredCandidates[0] ?? null;
}

async function refreshModelsForProvider(providerRegistry: ProviderRegistry, provider: ProviderDefinition): Promise<void> {
  if (provider.models && provider.models.length > 0) return;
  if (!providerHasCredentials(providerRegistry, provider)) return;
  await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
}
