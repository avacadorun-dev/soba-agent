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
import { ProviderRegistry } from "../core/provider/registry";
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
  noStream: boolean;
  stream: boolean;
  tokenBudget: number;
  debug: boolean;
  toolDelegation?: RuntimeToolDelegation;
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
  private readonly session: SessionManager;
  private readonly sessionLifecycle: SessionLifecycleService;

  constructor(loop: AgentLoop, session: SessionManager, sessionLifecycle: SessionLifecycleService) {
    this.loop = loop;
    this.session = session;
    this.sessionLifecycle = sessionLifecycle;
  }

  async createSession(input: CreateSessionInput): Promise<RuntimeSessionInfo> {
    return this.sessionLifecycle.createSession(input);
  }

  async openSession(input: OpenSessionInput): Promise<RuntimeSessionInfo> {
    return this.sessionLifecycle.openSession(input);
  }

  async loadSession(input: LoadSessionInput): Promise<RuntimeSessionSnapshot> {
    return this.sessionLifecycle.loadSession(input);
  }

  async resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionInfo> {
    return this.sessionLifecycle.resumeSession(input);
  }

  async listSessions(input: ListSessionsInput): Promise<RuntimeSessionInfo[]> {
    return this.sessionLifecycle.listSessions(input);
  }

  listCommands(input?: ListCommandsInput): RuntimeCommandMetadata[] {
    return commandService.listCommands(input);
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
    noStream,
    stream,
    tokenBudget,
    debug,
    toolDelegation,
  } = input;

  const persistedRegistry = await ProviderRegistry.loadFromFile();
  const providerRegistry = new ProviderRegistry(persistedRegistry ?? undefined);
  const persistedDefaultModel = persistedRegistry?.defaultModel;
  const modelDiffersFromPersisted = config.model && config.model !== persistedDefaultModel;
  let cliProviderId: string | undefined;
  if (modelExplicitlyPassed || modelDiffersFromPersisted) {
    for (const provider of providerRegistry.getAllProviders()) {
      if (providerRegistry.getModel(provider.id, config.model)) {
        cliProviderId = provider.id;
        break;
      }
    }
  }
  if (!cliProviderId) {
    cliProviderId = providerRegistry.getAllProviders().find((provider) => provider.baseUrl === config.baseUrl)?.id;
  }
  if (cliProviderId) {
    providerRegistry.setActive(cliProviderId, config.model);
  }

  const client = new OpenResponsesClientProxy(providerRegistry);
  if (baseUrlOverride) {
    providerRegistry.setBaseUrl(client.getActiveProviderId(), baseUrlOverride);
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
    runtime: new AgentLoopRuntimeAdapter(agentLoop, session, sessionLifecycle),
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
