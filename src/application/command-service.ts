import type { TranslationKey } from "../shared/i18n/types";
import { SUPPORTED_LOCALES } from "../shared/i18n/types";

export type RuntimeCommandSurface = "print" | "tui" | "acp";

const ALL_RUNTIME_COMMAND_SURFACES = ["print", "tui", "acp"] as const satisfies readonly RuntimeCommandSurface[];

export interface RuntimeCommandMetadata {
  /** Stable command id without the leading slash. */
  id: string;
  /** User-facing slash form, e.g. "/session". */
  name: `/${string}`;
  descriptionKey: TranslationKey;
  usage?: string;
  surfaces: readonly RuntimeCommandSurface[];
}

export const RUNTIME_COMMANDS = [
  {
    id: "compact",
    name: "/compact",
    descriptionKey: "command.description.compact",
    usage: "/compact [instructions]",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "rewind",
    name: "/rewind",
    descriptionKey: "command.description.rewind",
    usage: "/rewind [checkpoint-id]",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "session",
    name: "/session",
    descriptionKey: "command.description.session",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "sessions",
    name: "/sessions",
    descriptionKey: "command.description.sessions",
    usage: "/sessions list|resume <id>|load <id>|close [id]|delete <id>",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "capsule",
    name: "/capsule",
    descriptionKey: "command.description.capsule",
    usage: "/capsule [checkpoint-id] | create <objective> | export <checkpoint-id> <path> | load <path>",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "auto-compact",
    name: "/auto-compact",
    descriptionKey: "command.description.autoCompact",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "budget",
    name: "/budget",
    descriptionKey: "command.description.budget",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "config",
    name: "/config",
    descriptionKey: "command.description.config",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "reasoning",
    name: "/reasoning",
    descriptionKey: "command.description.reasoning",
    usage: "/reasoning [default|none|minimal|low|medium|high|xhigh|max|on|off|budget <tokens>]",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "lang",
    name: "/lang",
    descriptionKey: "command.description.lang",
    usage: `/lang <${SUPPORTED_LOCALES.join("|")}>`,
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "theme",
    name: "/theme",
    descriptionKey: "command.description.theme",
    surfaces: ["print", "tui"],
  },
  {
    id: "queue",
    name: "/queue",
    descriptionKey: "command.description.queue",
    surfaces: ["tui"],
  },
  {
    id: "permissions",
    name: "/permissions",
    descriptionKey: "command.description.permissions",
    usage: "/permissions [ask|repo|full|clear]",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "plan",
    name: "/plan",
    descriptionKey: "command.description.plan",
    usage: "/plan [on|off|toggle|plan|planning|goal|agent]",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "notifications",
    name: "/notifications",
    descriptionKey: "command.description.notifications",
    surfaces: ["tui"],
  },
  {
    id: "skill",
    name: "/skill",
    descriptionKey: "command.description.skill",
    usage: "/skill list|new|edit|eval|bench|trace|promote|history|rollback|rm",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "project-trust",
    name: "/project-trust",
    descriptionKey: "command.description.projectTrust",
    usage: "/project-trust status|approve|revoke",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "mcp",
    name: "/mcp",
    descriptionKey: "command.description.mcp",
    usage: "/mcp status|reload|start <server>|stop <server>|restart <server>|auth status|login|logout <server>|secret list|set|unset",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "clear",
    name: "/clear",
    descriptionKey: "command.description.clear",
    surfaces: ["tui"],
  },
  {
    id: "help",
    name: "/help",
    descriptionKey: "command.description.help",
    surfaces: ALL_RUNTIME_COMMAND_SURFACES,
  },
  {
    id: "exit",
    name: "/exit",
    descriptionKey: "command.description.exit",
    surfaces: ["print", "tui"],
  },
] as const satisfies readonly RuntimeCommandMetadata[];

export type RuntimeCommandName = (typeof RUNTIME_COMMANDS)[number]["name"];

export interface ParsedRuntimeCommand {
  id: string;
  name: `/${string}`;
  args: string[];
}

export type CommandResult = { handled: true; exit?: boolean } | { handled: false; prompt?: string };

export interface ListCommandsInput {
  surface?: RuntimeCommandSurface;
}

export class CommandService {
  private readonly commands: readonly RuntimeCommandMetadata[];

  constructor(commands: readonly RuntimeCommandMetadata[] = RUNTIME_COMMANDS) {
    this.commands = commands;
  }

  listCommands(input: ListCommandsInput = {}): RuntimeCommandMetadata[] {
    const { surface } = input;
    const commands = surface ? this.commands.filter((command) => command.surfaces.includes(surface)) : this.commands;
    return commands.map(cloneCommandMetadata);
  }

  getCommand(nameOrId: string): RuntimeCommandMetadata | undefined {
    const normalized = nameOrId.startsWith("/") ? nameOrId : `/${nameOrId}`;
    const command = this.commands.find((candidate) => candidate.name === normalized || candidate.id === nameOrId);
    return command ? cloneCommandMetadata(command) : undefined;
  }

  parseInput(input: string): ParsedRuntimeCommand | undefined {
    if (!input.startsWith("/")) return undefined;

    const trimmed = input.slice(1).trim();
    if (!trimmed) {
      return {
        id: "",
        name: "/",
        args: [],
      };
    }

    const parts = trimmed.split(/\s+/);
    const id = parts[0]?.toLowerCase() ?? "";

    return {
      id,
      name: `/${id}`,
      args: parts.slice(1),
    };
  }
}

export const commandService = new CommandService();

export function listRuntimeCommands(input: ListCommandsInput = {}): RuntimeCommandMetadata[] {
  return commandService.listCommands(input);
}

export function parseRuntimeCommandInput(input: string): ParsedRuntimeCommand | undefined {
  return commandService.parseInput(input);
}

function cloneCommandMetadata(command: RuntimeCommandMetadata): RuntimeCommandMetadata {
  return {
    ...command,
    surfaces: command.surfaces.slice(),
  };
}
