import type { CommandResult, McpRuntimeManager } from "../public";
import { executeMcpCommand } from "../public";
import type { CommandContext } from "./index";

export async function handleMcp(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = await executeMcpCommand(args, {
    i18n: ctx.i18n,
    runtime: ctx.mcpRuntime,
    manager: ctx.mcpManager,
    secretStore: ctx.mcpSecretStore,
    syncRegistry: createMcpRegistrySync(ctx),
    redactError: (input) => redactMcpCommandError(ctx, input),
  });

  ctx.renderer.emit({
    type: view.level,
    timestamp: Date.now(),
    message: view.message,
  });

  return { handled: true };
}

function createMcpRegistrySync(ctx: CommandContext): ((manager: McpRuntimeManager) => Promise<void>) | undefined {
  if (!ctx.toolRegistry || !ctx.syncMcpToolsIntoRegistry) {
    return undefined;
  }

  return async (manager) => {
    await ctx.syncMcpToolsIntoRegistry!(ctx.toolRegistry!, manager, {
      trustManager: ctx.trustManager ?? ctx.agentLoop?.getTrustManager(),
    });
  };
}

function redactMcpCommandError(ctx: CommandContext, input: {
  serverId?: string;
  message: string;
  manager?: McpRuntimeManager;
}): string {
  const redactMcpSensitiveText = ctx.redactMcpSensitiveText ?? ((text: string) => text);
  if (!input.serverId || !input.manager) {
    return redactMcpSensitiveText(input.message);
  }

  try {
    return redactMcpSensitiveText(input.message, input.manager.getServerSecurity(input.serverId));
  } catch {
    return redactMcpSensitiveText(input.message);
  }
}
