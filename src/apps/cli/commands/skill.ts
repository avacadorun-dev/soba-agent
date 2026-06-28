import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandResult, PermissionMode } from "../../../application/cli/public";
import { ProjectTrustStore } from "../../../application/cli/public";
import type { CommandContext } from "./index";

export async function handleSkill(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.skillManager) {
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

  const { SkillCommands } = await import("../../../application/cli/public");
  const { DraftStore } = await import("../../../application/cli/public");
  const { RevisionStore } = await import("../../../application/cli/public");
  const { SkillEvaluator } = await import("../../../application/cli/public");

  const sobaDir = join(homedir(), ".soba");
  const draftStore = new DraftStore({ draftsPath: join(sobaDir, "skill-drafts") });
  const revisionStore = new RevisionStore({ revisionsPath: join(sobaDir, "skill-revisions") });
  const evaluator = new SkillEvaluator({ evalRunsPath: join(sobaDir, "eval-runs") });

  const skillCommands = new SkillCommands({
    draftStore,
    revisionStore,
    evaluator,
    catalog: ctx.skillManager["catalog"],
    userSkillsPath: join(sobaDir, "skills"),
    projectSkillsPath: join(process.cwd(), ".soba", "skills"),
  });

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
  if (!ctx.skillManager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.notConfigured"),
    });
    return { handled: true };
  }

  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.usage"),
    });
    return { handled: true };
  }

  const trustStore = ctx.skillManager["trustStore"];
  const projectIdentity = ProjectTrustStore.computeProjectIdentity(process.cwd());

  switch (subcommand) {
    case "status": {
      const isTrusted = trustStore.isTrusted(projectIdentity);
      const record = trustStore.getRecord(projectIdentity);

      const lines = [
        ctx.i18n.t("command.projectTrust.status.title"),
        ctx.i18n.t("command.projectTrust.status.root", { root: projectIdentity.canonicalRoot }),
      ];

      if (projectIdentity.gitCommonDir) {
        lines.push(ctx.i18n.t("command.projectTrust.status.gitDir", { gitDir: projectIdentity.gitCommonDir }));
      }

      lines.push(
        ctx.i18n.t("command.projectTrust.status.trusted", {
          trusted: ctx.i18n.t(isTrusted ? "general.yes" : "general.no"),
        }),
      );

      if (record) {
        lines.push(ctx.i18n.t("command.projectTrust.status.trustedAt", { date: record.trustedAt }));
        lines.push(ctx.i18n.t("command.projectTrust.status.fingerprint", { fp: record.skillsFingerprint.slice(0, 16) }));
      }

      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: lines.join("\n"),
      });
      break;
    }

    case "approve": {
      const discovery = ctx.skillManager["discovery"];
      const fingerprint = discovery.computeFingerprint(projectIdentity.canonicalRoot);

      const isTrusted = trustStore.isTrusted(projectIdentity);

      if (isTrusted) {
        trustStore.updateFingerprint(projectIdentity, fingerprint);
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.approve.updated"),
        });
      } else {
        trustStore.approve(projectIdentity, fingerprint);
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.approve.approved"),
        });
      }

      ctx.skillManager.refresh();
      ctx.renderer.emit({ type: "trust_changed", trusted: true, timestamp: Date.now() });
      break;
    }

    case "revoke": {
      const revoked = trustStore.revoke(projectIdentity);

      if (revoked) {
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.revoke.revoked"),
        });

        ctx.skillManager.refresh();
        ctx.renderer.emit({ type: "trust_changed", trusted: false, timestamp: Date.now() });
      } else {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.revoke.notTrusted"),
        });
      }
      break;
    }

    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.projectTrust.unknownSubcommand", { subcommand }),
      });
  }

  return { handled: true };
}

export function handlePermissions(args: string[], ctx: CommandContext): CommandResult {
  const trustManager = ctx.trustManager ?? ctx.agentLoop?.getTrustManager();
  if (!trustManager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.usage"),
    });
    return { handled: true };
  }

  const mode = args[0]?.toLowerCase();
  if (!mode) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.current", { mode: trustManager.getPermissionMode() }),
    });
    return { handled: true };
  }

  if (mode === "clear") {
    trustManager.clearSessionApprovals();
    trustManager.setPermissionMode("ask");
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.cleared"),
    });
    return { handled: true };
  }

  if (isPermissionMode(mode)) {
    trustManager.setPermissionMode(mode);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.changed", { mode }),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "error",
    timestamp: Date.now(),
    message: ctx.i18n.t("tui.permissions.usage"),
  });
  return { handled: true };
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === "ask" || value === "repo" || value === "full";
}
