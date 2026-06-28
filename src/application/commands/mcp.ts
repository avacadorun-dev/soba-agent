import type {
  McpManagedServerAuthStatus,
  McpRemoteAuthCommandResult,
  McpRuntimeControllerLike,
  McpRuntimeManager,
  McpRuntimeReloadResult,
} from "../mcp-runtime-controller";

export interface McpCommandI18n {
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface McpSecretStoreLike {
  listNames(): Promise<string[]>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

export interface McpCommandServices {
  i18n: McpCommandI18n;
  runtime?: McpRuntimeControllerLike;
  manager?: McpRuntimeManager;
  secretStore?: McpSecretStoreLike;
  syncRegistry?: (manager: McpRuntimeManager) => Promise<void>;
  redactError?: (input: { serverId?: string; message: string; manager?: McpRuntimeManager }) => string;
}

export type McpCommandView = { level: "info" | "error"; message: string };

export async function executeMcpCommand(args: string[], services: McpCommandServices): Promise<McpCommandView> {
  const subcommand = args[0]?.toLowerCase() ?? "status";

  switch (subcommand) {
    case "status":
      return buildMcpStatusView(services);
    case "reload":
      return executeMcpReload(services);
    case "start":
    case "stop":
    case "restart":
      return executeMcpLifecycle(subcommand, args.slice(1), services);
    case "auth":
      return executeMcpAuth(args.slice(1), services);
    case "secret":
    case "secrets":
      return executeMcpSecret(args.slice(1), services);
    default:
      return {
        level: "error",
        message: services.i18n.t("command.mcp.result", {
          operation: subcommand,
          server: "-",
          result: services.i18n.t("command.mcp.usage"),
        }),
      };
  }
}

async function executeMcpSecret(args: string[], services: McpCommandServices): Promise<McpCommandView> {
  const action = args[0]?.toLowerCase();
  const name = args[1];
  const store = services.secretStore;

  if (!store || !action || !["list", "set", "unset", "delete", "remove"].includes(action)) {
    return { level: "error", message: services.i18n.t("command.mcp.secret.usage") };
  }

  try {
    if (action === "list") {
      const names = await store.listNames();
      return {
        level: "info",
        message: services.i18n.t("command.mcp.secret.list", {
          names: names.length > 0 ? names.join(", ") : services.i18n.t("command.mcp.secret.none"),
        }),
      };
    }

    if (!name) {
      return { level: "error", message: services.i18n.t("command.mcp.secret.usage") };
    }

    if (action === "set") {
      const value = args.slice(2).join(" ");
      if (!value) {
        return { level: "error", message: services.i18n.t("command.mcp.secret.usage") };
      }

      await store.set(name, value);
      return { level: "info", message: services.i18n.t("command.mcp.secret.set", { name }) };
    }

    const existed = await store.delete(name);
    return {
      level: "info",
      message: services.i18n.t("command.mcp.secret.unset", {
        name,
        result: existed ? services.i18n.t("command.mcp.secret.removed") : services.i18n.t("command.mcp.secret.notFound"),
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { level: "error", message: services.i18n.t("command.mcp.secret.error", { message }) };
  }
}

function buildMcpStatusView(services: McpCommandServices): McpCommandView {
  const manager = getMcpManager(services);
  if (!manager) {
    return { level: "info", message: services.i18n.t("command.mcp.status.empty") };
  }

  const status = manager.getStatus();
  if (status.servers.length === 0) {
    return { level: "info", message: services.i18n.t("command.mcp.status.empty") };
  }

  const running = status.servers.filter((server) => server.started).length;
  const lines = [
    services.i18n.t("command.mcp.status.summary", {
      configured: status.servers.length,
      running,
      ready: status.counts.ready,
      degraded: status.counts.degraded,
      crashed: status.counts.crashed,
      stopped: status.counts.stopped,
    }),
    ...status.servers.map((server) =>
      services.i18n.t("command.mcp.status.server", {
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
        error: server.lastError
          ? redactMcpManagerError(server.id, server.lastError, manager, services.redactError)
          : "none",
      }),
    ),
  ];

  return { level: "info", message: lines.join("\n") };
}

async function executeMcpLifecycle(
  action: "start" | "stop" | "restart",
  args: string[],
  services: McpCommandServices,
): Promise<McpCommandView> {
  const serverId = args[0];
  if (!serverId) {
    return { level: "error", message: services.i18n.t("command.mcp.usage") };
  }

  const manager = getMcpManager(services);
  if (!manager) {
    return {
      level: "error",
      message: services.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: services.i18n.t("command.mcp.status.empty"),
      }),
    };
  }

  try {
    if (action === "start") {
      await manager.start(serverId);
    } else if (action === "stop") {
      await manager.stop(serverId);
    } else {
      await manager.restart(serverId);
    }

    await syncMcpRegistryAfterLifecycle(manager, services);

    return {
      level: "info",
      message: services.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: "ok",
      }),
    };
  } catch (error) {
    return {
      level: "error",
      message: services.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: redactMcpManagerError(
          serverId,
          error instanceof Error ? error.message : String(error),
          manager,
          services.redactError,
        ),
      }),
    };
  }
}

async function executeMcpAuth(args: string[], services: McpCommandServices): Promise<McpCommandView> {
  const action = args[0]?.toLowerCase();
  const serverId = args[1];
  if ((action !== "status" && action !== "login" && action !== "logout") || !serverId) {
    return { level: "error", message: services.i18n.t("command.mcp.auth.usage") };
  }

  const manager = getMcpManager(services);
  if (!manager) {
    return {
      level: "error",
      message: services.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: services.i18n.t("command.mcp.status.empty"),
      }),
    };
  }

  try {
    const result = await runMcpAuthAction(manager, action, serverId);
    return {
      level: "info",
      message: formatMcpAuthResult(action, serverId, result, services.i18n),
    };
  } catch (error) {
    return {
      level: "error",
      message: services.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: redactMcpManagerError(
          serverId,
          error instanceof Error ? error.message : String(error),
          manager,
          services.redactError,
        ),
      }),
    };
  }
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
  i18n: McpCommandI18n,
): string {
  const lines = [
    i18n.t(mcpAuthActionKey(action), {
      server: serverId,
      state: result.status.state,
      type: result.status.type,
      message: result.message,
    }),
  ];

  if (result.status.nextAction) {
    lines.push(i18n.t("command.mcp.auth.nextAction", { action: result.status.nextAction }));
  }
  if (result.details) {
    lines.push(i18n.t("command.mcp.auth.details", { details: result.details }));
  }

  return lines.join("\n");
}

function mcpAuthActionKey(
  action: "status" | "login" | "logout",
): "command.mcp.auth.status" | "command.mcp.auth.login" | "command.mcp.auth.logout" {
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

async function syncMcpRegistryAfterLifecycle(
  manager: McpRuntimeManager,
  services: McpCommandServices,
): Promise<void> {
  if (services.runtime) {
    await services.runtime.syncTools();
    return;
  }

  await services.syncRegistry?.(manager);
}

async function executeMcpReload(services: McpCommandServices): Promise<McpCommandView> {
  if (!services.runtime) {
    return { level: "error", message: services.i18n.t("command.mcp.reload.unavailable") };
  }

  try {
    const result = await services.runtime.reload();
    return { level: "info", message: formatMcpReloadResult(result, services.i18n) };
  } catch (error) {
    return {
      level: "error",
      message: services.i18n.t("command.mcp.reload.error", {
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

function formatMcpReloadResult(result: McpRuntimeReloadResult, i18n: McpCommandI18n): string {
  return i18n.t("command.mcp.reload.result", {
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

function getMcpManager(services: McpCommandServices): McpRuntimeManager | undefined {
  return services.runtime?.getManager() ?? services.manager;
}

function redactMcpManagerError(
  serverId: string,
  message: string,
  manager: McpRuntimeManager,
  redactError: McpCommandServices["redactError"],
): string {
  return redactError?.({ serverId, message, manager }) ?? message;
}
