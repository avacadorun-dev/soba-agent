/**
 * Slash Command Registry — Phase 2.5 A4.
 *
 * Central registry for TUI slash commands. Commands are registered
 * by name and dispatched when the user types "/<name> [args]".
 * Supports nested subcommands (e.g. "/model set deepseek/chat").
 */

import type { SlashCommand, SlashCommandContext, SlashCommandResult } from "./types";

/**
 * Registry of TUI slash commands.
 *
 * Usage:
 * ```typescript
 * const registry = new SlashCommandRegistry();
 * registry.register({
 *   name: "model",
 *   description: "Manage AI models",
 *   handler: (args, ctx) => { ... },
 * });
 *
 * // Dispatch: registry.dispatch("/model set deepseek/chat", ctx);
 * ```
 */
export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();

  /**
   * Register a slash command. Overwrites any existing command with the same name.
   */
  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
  }

  /**
   * Get a registered command by name.
   */
  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all registered commands (for autocomplete, /help, etc.).
   */
  getAll(): SlashCommand[] {
    return [...this.commands.values()];
  }

  /**
   * Check if a command is registered.
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Unregister a command by name.
   */
  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  /**
   * Clear all registered commands.
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Dispatch a slash command input string.
   *
   * Parses "/<name> [subcommand] [args...]" and invokes the matching handler.
   * Supports nested subcommands (e.g. "/model set deepseek/chat" dispatches
   * to commands["model"].subcommands["set"].handler(["deepseek/chat"], ctx)).
   *
   * @param input - The full input string starting with "/"
   * @param context - Context for TUI interaction
   * @returns The result from the handler, or undefined if no matching command found
   */
  dispatch(input: string, context: SlashCommandContext): SlashCommandResult | undefined {
    const trimmed = input.startsWith("/") ? input.slice(1).trim() : input.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length === 0 || parts[0] === "") return undefined;

    const name = parts[0].toLowerCase();
    let command = this.commands.get(name);
    if (!command) return undefined;

    let argsIndex = 1;

    // Walk subcommand chain
    while (argsIndex < parts.length && command?.subcommands) {
      const subName = parts[argsIndex].toLowerCase();
      const sub = command.subcommands[subName] as SlashCommand | undefined;
      if (!sub) break;
      command = sub;
      argsIndex++;
    }

    const args = parts.slice(argsIndex);

    if (command?.handler) {
      return command.handler(args, context);
    }

    // Command exists but has no handler — just acknowledge it was found
    return { handled: true };
  }

  /**
   * Get the flat list of command descriptors for autocomplete suggestions.
   * Includes subcommands as flat entries (e.g. "model set", "model list").
   */
  getSuggestions(): Array<{ name: string; description: string }> {
    const result: Array<{ name: string; description: string }> = [];
    for (const command of this.commands.values()) {
      result.push({ name: `/${command.name}`, description: command.description });
      this.collectSubcommandSuggestions(command, `/${command.name}`, result);
    }
    return result;
  }

  private collectSubcommandSuggestions(
    command: SlashCommand,
    prefix: string,
    result: Array<{ name: string; description: string }>,
  ): void {
    if (!command.subcommands) return;
    const subs = Object.values(command.subcommands);
    for (let i = 0; i < subs.length; i++) {
      const sub: SlashCommand = subs[i] as SlashCommand;
      const fullName = `${prefix} ${sub.name}`;
      result.push({ name: fullName, description: sub.description });
      this.collectSubcommandSuggestions(sub, fullName, result);
    }
  }
}

/**
 * Global singleton instance of the SlashCommandRegistry.
 * Modules register their commands via imports at initialization time.
 */
export const slashCommandRegistry = new SlashCommandRegistry();
