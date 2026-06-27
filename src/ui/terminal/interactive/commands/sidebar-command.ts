/**
 * /sidebar command.
 *
 * Terminal-safe fallback for cycling, toggling, or opening sidebar panels.
 */

import { slashCommandRegistry } from "./registry";
import type { SlashCommand } from "./types";

export interface SidebarCommandDeps {
  next: () => void;
  previous: () => void;
  toggle: () => void;
  help: () => void;
}

export function createSidebarCommand(deps: SidebarCommandDeps): SlashCommand {
  return {
    name: "sidebar",
    description: "Control sidebar panels",
    handler: (args, _ctx) => {
      const action = args[0]?.toLowerCase() ?? "next";
      if (action === "prev" || action === "previous" || action === "back") {
        deps.previous();
      } else if (action === "toggle" || action === "collapse" || action === "expand") {
        deps.toggle();
      } else if (action === "help") {
        deps.help();
      } else {
        deps.next();
      }
      return { handled: true };
    },
    subcommands: {
      next: {
        name: "next",
        description: "Next sidebar panel",
        handler: () => {
          deps.next();
          return { handled: true };
        },
      },
      previous: {
        name: "previous",
        description: "Previous sidebar panel",
        handler: () => {
          deps.previous();
          return { handled: true };
        },
      },
      toggle: {
        name: "toggle",
        description: "Collapse or expand sidebar",
        handler: () => {
          deps.toggle();
          return { handled: true };
        },
      },
      help: {
        name: "help",
        description: "Open help panel",
        handler: () => {
          deps.help();
          return { handled: true };
        },
      },
    },
  };
}

export function registerSidebarCommand(deps: SidebarCommandDeps): void {
  slashCommandRegistry.register(createSidebarCommand(deps));
}
