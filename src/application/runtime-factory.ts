import { homedir } from "node:os";
import { join } from "node:path";
import { ContextManager } from "../core/compaction/context-manager";
import { BackgroundScheduler } from "../core/compaction/scheduler";
import type { CompactionConfig, SobaConfig } from "../core/config/types";
import { AgentLoop } from "../core/loop/agent-loop";
import type { AgentEvent } from "../core/loop/types";
import { McpClientManager } from "../core/mcp/client-manager";
import { loadMcpConfig } from "../core/mcp/config";
import { syncMcpToolsIntoRegistry } from "../core/mcp/tool-registry-sync";
import { createMemoryTools } from "../core/memory/memory-tools";
import { ProjectMemory } from "../core/memory/project-memory";
import { OpenResponsesClientProxy } from "../core/provider/client-proxy";
import { discoverModels, isLikelyChatModelId, toModelDefinitions } from "../core/provider/discovery";
import { ProviderRegistry } from "../core/provider/registry";
import type { ModelDefinition, ProviderDefinition } from "../core/provider/types";
import type { SessionManager } from "../core/session/session-manager";
import { SkillCatalog } from "../core/skills/catalog";
import { SkillDiscovery } from "../core/skills/discovery";
import { ProjectTrustStore } from "../core/skills/project-trust-store";
import { SkillManager } from "../core/skills/skill-manager";
import { bashTool } from "../core/tools/bash";
import { checkpointTool } from "../core/tools/checkpoint";
import { editTool } from "../core/tools/edit";
import { inspectFileTool } from "../core/tools/inspect-file";
import { lsTool } from "../core/tools/ls";
import { readTool } from "../core/tools/read";
import { searchFilesTool } from "../core/tools/search-files";
import { ToolRegistry } from "../core/tools/tool-registry";
import { writeTool } from "../core/tools/write";
import { TrustManager } from "../core/trust/trust-manager";
import { commandService, type ListCommandsInput, type RuntimeCommandMetadata } from "./command-service";
import { SessionLifecycleService } from "./session-lifecycle";
import {
  createDelegatedBashTool,
  createDelegatedReadTool,
  createDelegatedWriteTool,
  type RuntimeToolDelegation,
} from "./tool-delegation";
import type {
  CreateSessionInput,
  ListSessionsInput,
  LoadSessionInput,
  OpenSessionInput,
  ResumeSessionInput,
  RuntimeEventListener,
  RuntimeSessionConfigOption,
  RuntimeSessionInfo,
  RuntimeSessionSnapshot,
  SetSessionConfigInput,
  SetSessionModeInput,
  SobaRuntime,
  TurnResult,
  UserTurnInput,
} from "./types";
import { runtimeBlocksToText } from "./types";

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
  providerRegistryConfigPath?: string;
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
  mcpManager?: McpClientManager;
}

class AgentLoopRuntimeAdapter implements SobaRuntime {
  private readonly loop: AgentLoop;
  private session: SessionManager;
  private readonly sessionLifecycle: SessionLifecycleService;
  private readonly providerRegistry: ProviderRegistry;

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
    return this.loop.runTurn(runtimeBlocksToText(input.content));
  }

  cancelTurn(sessionId: string): void {
    this.assertActiveSession(sessionId);
    this.loop.abort();
  }

  onEvent(listener: RuntimeEventListener): () => void {
    return this.loop.onEvent(listener as (event: AgentEvent) => void);
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

function registerBuiltInTools(registry: ToolRegistry, delegation?: RuntimeToolDelegation): void {
  registry.register(delegation ? createDelegatedReadTool(delegation) : readTool);
  registry.register(delegation ? createDelegatedWriteTool(delegation) : writeTool);
  registry.register(delegation ? createDelegatedBashTool(delegation) : bashTool);
  registry.register(editTool);
  registry.register(lsTool);
  registry.register(searchFilesTool);
  registry.register(inspectFileTool);
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

  const trustManager = new TrustManager();
  const mcpConfig = await loadMcpConfig({ projectRoot: cwd });
  const mcpManager = mcpConfig ? new McpClientManager({ servers: mcpConfig.servers }) : undefined;
  if (mcpManager) {
    await syncMcpToolsIntoRegistry(tools, mcpManager, { trustManager });
  }

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

  const sobaDir = join(homedir(), ".soba");
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
    const { createActivateSkillTool } = await import("../core/tools/activate-skill");
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

  return {
    runtime: new AgentLoopRuntimeAdapter(agentLoop, session, sessionLifecycle, providerRegistry),
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
