/**
 * /keys command.
 *
 * Prints the runtime keymap, including portable function-key defaults and
 * legacy terminal control aliases.
 */

import { getKeymapHelpRows } from "../lib/keymap";
import { slashCommandRegistry } from "./registry";
import type { SlashCommand } from "./types";

export function createKeysCommand(): SlashCommand {
  return {
    name: "keys",
    description: "Show keyboard shortcuts",
    handler: (_args, ctx) => {
      const lines = ["Keyboard shortcuts", ...getKeymapHelpRows(), "", "Fallback commands: /model, /reasoning, /search, /clear, /sidebar"];
      ctx.addMessage?.({
        type: "info",
        content: lines.join("\n"),
      });
      return { handled: true };
    },
  };
}

export function registerKeysCommand(): void {
  slashCommandRegistry.register(createKeysCommand());
}
