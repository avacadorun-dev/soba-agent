import type { CommandResult, McpRuntimeManager } from "../public";
import {
  executeMcpCommand,
  redactMcpSensitiveText,
  syncMcpToolsIntoRegistry,
} from "../public";
import type { CommandContext } from "./index";

export async function handleMcp(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = await executeMcpCommand(args, {
    i18n: ctx.i18n,
    runtime: ctx.mcpRuntime,
    manager: ctx.mcpManager,
    secretStore: ctx.mcpSecretStore,
    syncRegistry: createMcpRegistrySync(ctx),
    redactError: redactMcpCommandError,
  });

  ctx.renderer.emit({
    type: view.level,
    timestamp: Date.now(),
    message: view.message,
  });

  return { handled: true };
}

function createMcpRegistrySync(ctx: CommandContext): ((manager: McpRuntimeManager) => Promise<void>) | undefined {
  if (!ctx.toolRegistry) {
    return undefined;
  }

  return async (manager) => {
    await syncMcpToolsIntoRegistry(ctx.toolRegistry!, manager, {
      trustManager: ctx.trustManager ?? ctx.agentLoop?.getTrustManager(),
    });
  };
}

function redactMcpCommandError(input: {
  serverId?: string;
  message: string;
  manager?: McpRuntimeManager;
}): string {
  if (!input.serverId || !input.manager) {
    return redactMcpSensitiveText(input.message);
  }

  try {
    return redactMcpSensitiveText(input.message, input.manager.getServerSecurity(input.serverId));
  } catch {
    return redactMcpSensitiveText(input.message);
  }
}
