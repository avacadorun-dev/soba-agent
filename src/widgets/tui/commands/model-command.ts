/**
 * /model command.
 *
 * Opens the provider/model selector as a terminal-safe fallback for the model
 * picker hotkey. Optional args become the selector search query.
 */

import type { ProviderStore } from "../model/provider-store";
import { slashCommandRegistry } from "./registry";
import type { SlashCommand } from "./types";

export interface ModelCommandDeps {
  providerStore: Pick<ProviderStore, "open" | "setSearch">;
}

export function createModelCommand(deps: ModelCommandDeps): SlashCommand {
  return {
    name: "model",
    description: "Open provider/model selector",
    handler: (args, _ctx) => {
      deps.providerStore.open();
      const query = args.join(" ").trim();
      if (query) deps.providerStore.setSearch(query);
      return { handled: true };
    },
  };
}

export function registerModelCommand(deps: ModelCommandDeps): void {
  slashCommandRegistry.register(createModelCommand(deps));
}
