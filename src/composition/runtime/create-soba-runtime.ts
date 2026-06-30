import { homedir } from "node:os";
import type { PortableCapsuleServiceFactory } from "../../application/capsules/service";
import type { CompactFallbackCompactorPort } from "../../application/commands/compact";
import type { CompactionConfig, SobaConfig } from "../../application/config/types";
import type { SessionLifecycleService } from "../../application/session-lifecycle";
import type { SkillCatalog } from "../../application/skills/catalog";
import type { SkillCommands } from "../../application/skills/commands";
import type { ProjectTrustStore } from "../../application/skills/project-trust-store";
import type { SkillManager } from "../../application/skills/skill-manager";
import type { RuntimeToolDelegation } from "../../application/tool-delegation";
import { TrustManager } from "../../application/trust/trust-manager";
import type {
  RuntimeCommandExecutor,
  SobaRuntime,
} from "../../application/types";
import { ContextManager } from "../../engine/compaction/context-manager";
import { BackgroundScheduler } from "../../engine/compaction/scheduler";
import { AgentLoop } from "../../engine/turn/agent-loop";
import type { OpenResponsesClientProxy } from "../../infrastructure/llm/providers/client-proxy";
import type { ProviderRegistry } from "../../infrastructure/llm/providers/registry";
import type { McpClientManager } from "../../infrastructure/mcp/client-manager";
import type { McpRuntimeController } from "../../infrastructure/mcp/runtime-controller";
import type { McpSecretStore } from "../../infrastructure/mcp/secret-store";
import { createFilesystemPortableCapsuleService } from "../../infrastructure/persistence/capsules/portable-capsule-storage";
import { FilesystemEvidenceProofStorage } from "../../infrastructure/persistence/evidence/proof-storage";
import { ProjectMemory } from "../../infrastructure/persistence/memory/project-memory";
import { PersistentSessionLifecycleService } from "../../infrastructure/persistence/sessions/session-lifecycle-service";
import type { SessionManager } from "../../infrastructure/persistence/sessions/session-manager";
import { ToolRegistry } from "../../kernel/tools/tool-registry";
import { AgentLoopRuntimeAdapter } from "./agent-loop-runtime-adapter";
import { EngineCompactFallbackCompactor } from "./compact-fallback-compactor";
import { createMcpStack } from "./create-mcp-stack";
import { createProviderStack } from "./create-provider-stack";
import { createSkillStack } from "./create-skill-stack";
import { createToolStack } from "./create-tool-stack";
import { createProjectCommandFileReader, createProjectContextReader } from "./project-files";

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
  skillCommands: SkillCommands;
  agentLoop: AgentLoop;
  providerRegistry: ProviderRegistry;
  sessionLifecycle: PersistentSessionLifecycleService;
  setSession: (session: SessionManager) => void;
  mcpRuntime: McpRuntimeController;
  mcpManager?: McpClientManager;
  mcpSecretStore: McpSecretStore;
  toolRegistry: ToolRegistry;
  trustManager: TrustManager;
  getSession: () => SessionManager;
  portableCapsuleServiceFactory: PortableCapsuleServiceFactory;
  fallbackCompactor: CompactFallbackCompactorPort;
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
  skillCommands: SkillCommands;
  skillCatalog: SkillCatalog;
  trustStore: ProjectTrustStore;
  sessionLifecycle: SessionLifecycleService;
  mcpSecretStore: McpSecretStore;
  mcpRuntime: McpRuntimeController;
  mcpManager?: McpClientManager;
  portableCapsuleServiceFactory: PortableCapsuleServiceFactory;
  fallbackCompactor: CompactFallbackCompactorPort;
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

  const { providerRegistry, client } = await createProviderStack({
    config,
    modelExplicitlyPassed,
    baseUrlOverride,
    baseUrlExplicitlyPassed,
    apiKeyExplicitlyPassed,
    providerRegistryConfigPath,
  });

  const tools = createToolStack(toolDelegation);

  const projectMemory = new ProjectMemory({ projectRoot: cwd });
  projectMemory.initialize();
  const evidenceProofStorage = new FilesystemEvidenceProofStorage({ projectRoot: cwd });

  const homeDir = homedir();
  const trustManager = new TrustManager();
  const { mcpSecretStore, mcpRuntime, mcpManager } = await createMcpStack({
    projectRoot: cwd,
    homeDir,
    toolRegistry: tools,
    trustManager,
  });

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

  const { skillManager, skillCommands, skillCatalog, trustStore } = await createSkillStack({
    projectPath: cwd,
    homeDir,
    session,
    toolRegistry: tools,
  });

  const useStreaming = noStream ? false : stream || interactive;
  const agentLoop = new AgentLoop(
    client,
    session,
    tools,
    cwd,
    {
      emitEvents: true,
      tokenBudget,
      stream: useStreaming,
      debug,
      maxAgentIterations: config.maxAgentIterations,
      maxStalledIterations: config.maxStalledIterations,
      maxRunDurationMs: config.maxRunMinutes * 60 * 1000,
      bashMaxTimeoutSeconds: config.bashMaxTimeoutSeconds,
    },
    trustManager,
    undefined,
    contextManager,
    backgroundScheduler,
    skillManager,
    { enabled: compactionConfig.auto },
    projectMemory,
    createProjectContextReader(),
    createProjectCommandFileReader(cwd),
    evidenceProofStorage,
  );
  const sessionLifecycle = new PersistentSessionLifecycleService(cwd);
  const portableCapsuleServiceFactory = createFilesystemPortableCapsuleService;
  const fallbackCompactor = new EngineCompactFallbackCompactor();
  const runtime = new AgentLoopRuntimeAdapter(agentLoop, session, sessionLifecycle, providerRegistry);
  const commandExecutor = commandExecutorFactory?.({
    client,
    config,
    contextManager,
    skillManager,
    skillCommands,
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
    portableCapsuleServiceFactory,
    fallbackCompactor,
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
    skillCommands,
    skillCatalog,
    trustStore,
    sessionLifecycle,
    mcpSecretStore,
    mcpRuntime,
    mcpManager,
    portableCapsuleServiceFactory,
    fallbackCompactor,
  };
}
