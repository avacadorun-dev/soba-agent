/**
 * /search command — Phase 2.5 B4.
 *
 * Opens the search overlay via slash command (alternative to Ctrl+F).
 * Usage: /search [query] — opens overlay with optional initial query.
 */

import { slashCommandRegistry } from "./registry";
import type { SlashCommand } from "./types";

export interface SearchCommandDeps {
  openSearch: (initialQuery?: string) => void;
}

export function createSearchCommand(deps: SearchCommandDeps): SlashCommand {
  return {
    name: "search",
    description: "Search conversation history",
    handler: (args, _ctx) => {
      const query = args.join(" ");
      deps.openSearch(query || "");
      return { handled: true };
    },
  };
}

export function registerSearchCommand(deps: SearchCommandDeps): void {
  slashCommandRegistry.register(createSearchCommand(deps));
}
