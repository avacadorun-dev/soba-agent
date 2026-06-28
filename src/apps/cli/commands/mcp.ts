import type {
  CommandResult,
  McpManagedServerAuthStatus,
  McpRemoteAuthCommandResult,
  McpRuntimeManager,
  McpRuntimeReloadResult,
} from "../../../application/cli/public";
import {
  McpSecretStoreError,
  redactMcpSensitiveText,
  syncMcpToolsIntoRegistry,
} from "../../../application/cli/public";
import type { CommandContext } from "./index";

export async function handleMcp(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const subcommand = args[0]?.toLowerCase() ?? "status";

  switch (subcommand) {
    case "status":
      emitMcpStatus(ctx);
      return { handled: true };
    case "reload":
      return handleMcpReload(ctx);
    case "start":
    case "stop":
    case "restart":
      return handleMcpLifecycle(subcommand, args.slice(1), ctx);
    case "auth":
      return handleMcpAuth(args.slice(1), ctx);
    case "secret":
    case "secrets":
      return handleMcpSecret(args.slice(1), ctx);
    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.result", {
          operation: subcommand,
          server: "-",
          result: ctx.i18n.t("command.mcp.usage"),
        }),
      });
      return { handled: true };
  }
}

async function handleMcpSecret(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const action = args[0]?.toLowerCase();
  const name = args[1];
  const store = ctx.mcpSecretStore;

  if (!store || !action || !["list", "set", "unset", "delete", "remove"].includes(action)) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.usage"),
    });
    return { handled: true };
  }

  try {
    if (action === "list") {
      const names = await store.listNames();
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.list", {
          names: names.length > 0 ? names.join(", ") : ctx.i18n.t("command.mcp.secret.none"),
        }),
      });
      return { handled: true };
    }

    if (!name) {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.usage"),
      });
      return { handled: true };
    }

    if (action === "set") {
      const value = args.slice(2).join(" ");
      if (!value) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.mcp.secret.usage"),
        });
        return { handled: true };
      }

      await store.set(name, value);
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.set", { name }),
      });
      return { handled: true };
    }

    const existed = await store.delete(name);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.unset", {
        name,
        result: existed ? ctx.i18n.t("command.mcp.secret.removed") : ctx.i18n.t("command.mcp.secret.notFound"),
      }),
    });
  } catch (error) {
    const message = error instanceof McpSecretStoreError || error instanceof Error ? error.message : String(error);
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.error", { message }),
    });
  }

  return { handled: true };
}

function emitMcpStatus(ctx: CommandContext): void {
  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.status.empty"),
    });
    return;
  }

  const status = manager.getStatus();
  if (status.servers.length === 0) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.status.empty"),
    });
    return;
  }

  const running = status.servers.filter((server) => server.started).length;
  const lines = [
    ctx.i18n.t("command.mcp.status.summary", {
      configured: status.servers.length,
      running,
      ready: status.counts.ready,
      degraded: status.counts.degraded,
      crashed: status.counts.crashed,
      stopped: status.counts.stopped,
    }),
    ...status.servers.map((server) =>
      ctx.i18n.t("command.mcp.status.server", {
        id: server.id,
        name: server.name,
        enabled: String(server.enabled),
        started: String(server.started),
        state: server.state,
        lifecycle: server.lifecycle ?? "none",
        protocol: server.protocolVersion ?? "none",
        transport: server.transport ?? "stdio",
        auth: formatMcpAuthStatus(server.authState),
        restarts: server.crashRestartCount,
        error: server.lastError ? redactMcpManagerError(server.id, server.lastError, manager) : "none",
      }),
    ),
  ];

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });
}

async function handleMcpLifecycle(
  action: "start" | "stop" | "restart",
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const serverId = args[0];
  if (!serverId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.usage"),
    });
    return { handled: true };
  }

  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: ctx.i18n.t("command.mcp.status.empty"),
      }),
    });
    return { handled: true };
  }

  try {
    if (action === "start") {
      await manager.start(serverId);
    } else if (action === "stop") {
      await manager.stop(serverId);
    } else {
      await manager.restart(serverId);
    }

    await syncMcpRegistryAfterLifecycle(ctx);

    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: "ok",
      }),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: redactMcpManagerError(serverId, error instanceof Error ? error.message : String(error), manager),
      }),
    });
  }

  return { handled: true };
}

async function handleMcpAuth(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const action = args[0]?.toLowerCase();
  const serverId = args[1];
  if ((action !== "status" && action !== "login" && action !== "logout") || !serverId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.auth.usage"),
    });
    return { handled: true };
  }

  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: ctx.i18n.t("command.mcp.status.empty"),
      }),
    });
    return { handled: true };
  }

  try {
    const result = await runMcpAuthAction(manager, action, serverId);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: formatMcpAuthResult(action, serverId, result, ctx),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: redactMcpManagerError(serverId, error instanceof Error ? error.message : String(error), manager),
      }),
    });
  }

  return { handled: true };
}

async function runMcpAuthAction(
  manager: McpRuntimeManager,
  action: "status" | "login" | "logout",
  serverId: string,
): Promise<McpRemoteAuthCommandResult> {
  if (action === "status") {
    return manager.getAuthStatus(serverId);
  }
  if (action === "login") {
    return manager.login(serverId);
  }
  return manager.logout(serverId);
}

function formatMcpAuthResult(
  action: "status" | "login" | "logout",
  serverId: string,
  result: McpRemoteAuthCommandResult,
  ctx: CommandContext,
): string {
  const lines = [
    ctx.i18n.t(mcpAuthActionKey(action), {
      server: serverId,
      state: result.status.state,
      type: result.status.type,
      message: result.message,
    }),
  ];

  if (result.status.nextAction) {
    lines.push(ctx.i18n.t("command.mcp.auth.nextAction", { action: result.status.nextAction }));
  }
  if (result.details) {
    lines.push(ctx.i18n.t("command.mcp.auth.details", { details: result.details }));
  }

  return lines.join("\n");
}

function mcpAuthActionKey(action: "status" | "login" | "logout"): "command.mcp.auth.status" | "command.mcp.auth.login" | "command.mcp.auth.logout" {
  if (action === "status") {
    return "command.mcp.auth.status";
  }
  if (action === "login") {
    return "command.mcp.auth.login";
  }
  return "command.mcp.auth.logout";
}

function formatMcpAuthStatus(status: McpManagedServerAuthStatus | undefined): string {
  if (!status) {
    return "unknown";
  }

  const detail = status.detail ? `:${status.detail}` : "";
  const nextAction = status.nextAction ? ` next=${status.nextAction}` : "";
  return `${status.type}/${status.state}${detail}${nextAction}`;
}

async function syncMcpRegistryAfterLifecycle(ctx: CommandContext): Promise<void> {
  if (ctx.mcpRuntime) {
    await ctx.mcpRuntime.syncTools();
    return;
  }

  const manager = getMcpManager(ctx);
  if (!manager || !ctx.toolRegistry) {
    return;
  }

  await syncMcpToolsIntoRegistry(ctx.toolRegistry, manager, {
    trustManager: ctx.trustManager ?? ctx.agentLoop?.getTrustManager(),
  });
}

async function handleMcpReload(ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.mcpRuntime) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.reload.unavailable"),
    });
    return { handled: true };
  }

  try {
    const result = await ctx.mcpRuntime.reload();
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: formatMcpReloadResult(result, ctx),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.reload.error", {
        message: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  return { handled: true };
}

function formatMcpReloadResult(result: McpRuntimeReloadResult, ctx: CommandContext): string {
  return ctx.i18n.t("command.mcp.reload.result", {
    configured: result.serverIds.length,
    added: formatList(result.addedServerIds),
    removed: formatList(result.removedServerIds),
    restarted: formatList(result.restartedServerIds),
    tools: result.toolSync.registered.length,
    skipped: result.toolSync.skipped.length,
  });
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function getMcpManager(ctx: CommandContext): McpRuntimeManager | undefined {
  return ctx.mcpRuntime?.getManager() ?? ctx.mcpManager;
}

function redactMcpManagerError(serverId: string, message: string, manager: McpRuntimeManager): string {
  try {
    return redactMcpSensitiveText(message, manager.getServerSecurity(serverId));
  } catch {
    return redactMcpSensitiveText(message);
  }
}
