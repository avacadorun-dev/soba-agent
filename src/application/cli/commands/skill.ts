import type { CommandResult } from "../public";
import {
  executePermissionsCommand,
  executePlanCommand,
  executeProjectTrustCommand,
  executeSkillCommand,
} from "../public";
import type { CommandAgentPort, CommandContext } from "./index";

export async function handleSkill(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = await executeSkillCommand({ args, commands: ctx.skillCommands });

  if (view.kind === "not_configured") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.notConfigured"),
    });
    return { handled: true };
  }

  if (view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t(view.usageKey),
    });
    return { handled: true };
  }

  if (view.kind === "unknown") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.unknownSubcommand", { subcommand: view.subcommand }),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: view.level,
    timestamp: Date.now(),
    message: view.message,
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

export function handlePlan(args: string[], ctx: CommandContext): CommandResult {
  const agentLoop = ctx.agentLoop as CommandAgentPort | undefined;
  const controller =
    agentLoop?.getWorkMode && agentLoop.setWorkMode
      ? {
          getWorkMode: () => agentLoop.getWorkMode!(),
          setWorkMode: agentLoop.setWorkMode!.bind(agentLoop),
        }
      : undefined;
  const view = executePlanCommand({ args, controller });

  if (view.kind === "not_configured" || view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.plan.usage"),
    });
    return { handled: true };
  }

  if (view.kind === "current") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.plan.current", { mode: view.mode }),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("tui.plan.changed", { mode: view.mode }),
  });
  return { handled: true };
}
