import type { SkillCommandResult, SkillCommands } from "../skills/commands";

export type SkillCommandView =
  | { kind: "not_configured" }
  | { kind: "usage"; usageKey: string }
  | { kind: "unknown"; subcommand: string }
  | { kind: "result"; level: "info" | "error"; message: string };

export async function executeSkillCommand(input: {
  args: string[];
  commands?: SkillCommands;
}): Promise<SkillCommandView> {
  const { args, commands } = input;
  if (!commands) {
    return { kind: "not_configured" };
  }

  const subcommand = args[0]?.toLowerCase();
  if (!subcommand) {
    return { kind: "usage", usageKey: "command.skill.usage" };
  }

  let result: SkillCommandResult;

  switch (subcommand) {
    case "list":
      result = await commands.list({
        includeInvalid: args.includes("--invalid"),
        includeDisabled: args.includes("--disabled"),
      });
      break;

    case "new": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.newUsage" };
      }
      result = await commands.new(name, args.slice(2).join(" "));
      break;
    }

    case "edit": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.editUsage" };
      }
      const instructions = args.slice(2).join(" ");
      result = await commands.edit(name, instructions || undefined);
      break;
    }

    case "eval": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.evalUsage" };
      }
      result = await commands.eval(name);
      break;
    }

    case "promote": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.promoteUsage" };
      }
      const scopeArg = args.find((arg) => arg.startsWith("--scope="))?.split("=")[1] || "user";
      result = await commands.promote(name, scopeArg === "project" ? "project" : "user");
      break;
    }

    case "history": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.historyUsage" };
      }
      result = await commands.history(name);
      break;
    }

    case "rollback": {
      const name = args[1];
      const revisionId = args[2];
      if (!name || !revisionId) {
        return { kind: "usage", usageKey: "command.skill.rollbackUsage" };
      }
      result = await commands.rollback(name, revisionId);
      break;
    }

    case "rm":
    case "remove": {
      const name = args[1];
      if (!name) {
        return { kind: "usage", usageKey: "command.skill.removeUsage" };
      }
      result = await commands.remove(name, args.includes("--confirm"));
      break;
    }

    default:
      return { kind: "unknown", subcommand };
  }

  return {
    kind: "result",
    level: result.success ? "info" : "error",
    message: result.message,
  };
}
