import type { CommandResult } from "../../../application/cli/public";
import { executePermissionsCommand, executeProjectTrustCommand } from "../../../application/cli/public";
import type { CommandContext } from "./index";

export async function handleSkill(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.skillManager || !ctx.skillCommands) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.notConfigured"),
    });
    return { handled: true };
  }

  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.usage"),
    });
    return { handled: true };
  }

  const skillCommands = ctx.skillCommands;

  let result;

  switch (subcommand) {
    case "list": {
      const includeInvalid = args.includes("--invalid");
      const includeDisabled = args.includes("--disabled");
      result = await skillCommands.list({ includeInvalid, includeDisabled });
      break;
    }

    case "new": {
      const name = args[1];
      const description = args.slice(2).join(" ");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.newUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.new(name, description);
      break;
    }

    case "edit": {
      const name = args[1];
      const instructions = args.slice(2).join(" ");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.editUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.edit(name, instructions || undefined);
      break;
    }

    case "eval": {
      const name = args[1];
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.evalUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.eval(name);
      break;
    }

    case "promote": {
      const name = args[1];
      const scopeArg = args.find((a) => a.startsWith("--scope="))?.split("=")[1] || "user";
      const scope = scopeArg === "project" ? "project" : "user";
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.promoteUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.promote(name, scope);
      break;
    }

    case "history": {
      const name = args[1];
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.historyUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.history(name);
      break;
    }

    case "rollback": {
      const name = args[1];
      const revisionId = args[2];
      if (!name || !revisionId) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.rollbackUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.rollback(name, revisionId);
      break;
    }

    case "rm":
    case "remove": {
      const name = args[1];
      const confirmed = args.includes("--confirm");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.removeUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.remove(name, confirmed);
      break;
    }

    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.unknownSubcommand", { subcommand }),
      });
      return { handled: true };
  }

  ctx.renderer.emit({
    type: result.success ? "info" : "error",
    timestamp: Date.now(),
    message: result.message,
  });

  return { handled: true };
}

export async function handleProjectTrust(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = executeProjectTrustCommand({
    args,
    skillManager: ctx.skillManager,
    projectPath: ctx.session.getCwd(),
  });

  if (view.kind === "not_configured") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.notConfigured"),
    });
    return { handled: true };
  }

  if (view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.usage"),
    });
    return { handled: true };
  }

  if (view.kind === "status") {
    const lines = [
      ctx.i18n.t("command.projectTrust.status.title"),
      ctx.i18n.t("command.projectTrust.status.root", { root: view.canonicalRoot }),
    ];

    if (view.gitCommonDir) {
      lines.push(ctx.i18n.t("command.projectTrust.status.gitDir", { gitDir: view.gitCommonDir }));
    }

    lines.push(
      ctx.i18n.t("command.projectTrust.status.trusted", {
        trusted: ctx.i18n.t(view.trusted ? "general.yes" : "general.no"),
      }),
    );

    if (view.trustedAt && view.skillsFingerprint) {
      lines.push(ctx.i18n.t("command.projectTrust.status.trustedAt", { date: view.trustedAt }));
      lines.push(ctx.i18n.t("command.projectTrust.status.fingerprint", { fp: view.skillsFingerprint.slice(0, 16) }));
    }

    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: lines.join("\n"),
    });
    return { handled: true };
  }

  if (view.kind === "approved") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t(view.updated ? "command.projectTrust.approve.updated" : "command.projectTrust.approve.approved"),
    });
    ctx.renderer.emit({ type: "trust_changed", trusted: true, timestamp: Date.now() });
    return { handled: true };
  }

  if (view.kind === "revoked") {
    ctx.renderer.emit({
      type: view.revoked ? "info" : "error",
      timestamp: Date.now(),
      message: ctx.i18n.t(view.revoked ? "command.projectTrust.revoke.revoked" : "command.projectTrust.revoke.notTrusted"),
    });
    if (view.revoked) {
      ctx.renderer.emit({ type: "trust_changed", trusted: false, timestamp: Date.now() });
    }
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "error",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.projectTrust.unknownSubcommand", { subcommand: view.subcommand }),
  });
  return { handled: true };
}

export function handlePermissions(args: string[], ctx: CommandContext): CommandResult {
  const trustManager = ctx.trustManager ?? ctx.agentLoop?.getTrustManager();
  const view = executePermissionsCommand({ args, controller: trustManager });

  if (view.kind === "not_configured" || view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.usage"),
    });
    return { handled: true };
  }

  if (view.kind === "current") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.current", { mode: view.mode }),
    });
    return { handled: true };
  }

  if (view.kind === "cleared") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.cleared"),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("tui.permissions.changed", { mode: view.mode }),
  });
  return { handled: true };
}
