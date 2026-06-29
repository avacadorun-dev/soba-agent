import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolContext } from "../../kernel/tools/types";
import type { FlightRecordData } from "../../kernel/transcript/types";
import { BudgetTracker } from "../budget/budget-tracker";
import type { ContextManager } from "../compaction/context-manager";
import type { BackgroundScheduler } from "../compaction/scheduler";
import { ContextController } from "../context/context-controller";
import type { ProjectMemorySource } from "../memory/memory-injector";
import {
  createDangerousConfirmationAdapter,
  PermissionBroker,
} from "../permissions/permission-broker";
import { DefaultTrustController, type TrustController } from "../permissions/trust-controller";
import { ToolCallExecutor } from "../tool-calls/tool-call-executor";
import type { ProjectCommandFileReader } from "../verification/types";
import { AgentLoopEventBus } from "./agent-loop-event-bus";
import type { SkillSource } from "./skill-source";
import type { ProjectContextReader } from "./turn-prompt-preparation";
import {
  type AgentEvent,
  type AgentLoopOptions,
  DEFAULT_LOOP_OPTIONS,
} from "./types";

export interface AgentLoopRuntimeInput {
  client: OpenResponsesClient;
  session: SessionPort;
  tools: ToolRegistry;
  cwd: string;
  options?: Partial<AgentLoopOptions>;
  trustManager?: TrustController;
  budgetTracker?: BudgetTracker;
  contextManager?: ContextManager;
  backgroundScheduler?: BackgroundScheduler;
  skillManager?: SkillSource;
  autoCompactOverride?: { enabled: boolean };
  projectMemory?: ProjectMemorySource;
  projectContextReader?: ProjectContextReader;
  projectCommandFiles?: ProjectCommandFileReader;
  createToolContext: () => ToolContext;
  flight: (data: Omit<FlightRecordData, "version">) => void;
}

export interface AgentLoopRuntimeServices {
  client: OpenResponsesClient;
  tools: ToolRegistry;
  options: AgentLoopOptions;
  trustManager: TrustController;
  budgetTracker: BudgetTracker;
  contextManager: ContextManager | undefined;
  backgroundScheduler: BackgroundScheduler | undefined;
  contextController: ContextController;
  skillManager: SkillSource | undefined;
  projectMemory: ProjectMemorySource | undefined;
  projectContextReader: ProjectContextReader | undefined;
  projectCommandFiles: ProjectCommandFileReader | undefined;
  eventBus: AgentLoopEventBus;
  toolExecutor: ToolCallExecutor;
  getAutoCompactOverride(): { enabled: boolean } | undefined;
  setAutoCompactOverride(override: { enabled: boolean }): void;
}

export function createAgentLoopRuntime(input: AgentLoopRuntimeInput): AgentLoopRuntimeServices {
  const options = { ...DEFAULT_LOOP_OPTIONS, ...input.options };
  const trustManager = input.trustManager ?? new DefaultTrustController({ repoRoot: input.cwd });
  trustManager.setRepoRoot(input.cwd);
  const budgetTracker =
    input.budgetTracker ??
    new BudgetTracker({ totalBudget: options.tokenBudget });
  const autoCompactState = {
    override: input.autoCompactOverride,
  };

  const eventBus = new AgentLoopEventBus({
    shouldEmit: () => options.emitEvents,
    flight: input.flight,
  });
  const emit = (event: AgentEvent) => eventBus.emit(event);

  const contextController = new ContextController({
    contextManager: input.contextManager,
    backgroundScheduler: input.backgroundScheduler,
    autoCompactEnabled: () => autoCompactState.override?.enabled ?? true,
    emit,
  });
  const permissionBroker = new PermissionBroker({
    trustManager,
    requestPermission: createDangerousConfirmationAdapter({
      hasListeners: () => eventBus.hasListeners(),
      dispatch: (event) => eventBus.dispatchDangerousConfirmationEvent(event),
    }),
  });
  const toolExecutor = new ToolCallExecutor({
    registry: input.tools,
    permissionBroker,
    toolContext: input.createToolContext,
    emit,
  });

  return {
    client: input.client,
    tools: input.tools,
    options,
    trustManager,
    budgetTracker,
    contextManager: input.contextManager,
    backgroundScheduler: input.backgroundScheduler,
    contextController,
    skillManager: input.skillManager,
    projectMemory: input.projectMemory,
    projectContextReader: input.projectContextReader,
    projectCommandFiles: input.projectCommandFiles,
    eventBus,
    toolExecutor,
    getAutoCompactOverride: () => autoCompactState.override,
    setAutoCompactOverride: (override) => {
      autoCompactState.override = override;
    },
  };
}
