/**
 * Slash Command types — Phase 2.5 A4.
 *
 * Defines the interface for TUI-registered slash commands.
 * Commands registered in SlashCommandRegistry are dispatched
 * when the user types a "/" command that is not handled by
 * the core command router (cli/commands.ts).
 */

import type { TuiMessageInput } from "../model/types";

/**
 * Context passed to a slash command handler.
 * Provides access to TUI infrastructure without tight coupling.
 */
export interface SlashCommandContext {
  /** Add a message to the TUI message list (info, error, etc.). */
  addMessage?: (message: TuiMessageInput) => void;
  /** Request exit from the TUI. */
  exit?: () => void;
}

/**
 * Result returned by a slash command handler.
 */
export interface SlashCommandResult {
  /** Whether the command was handled. */
  handled: boolean;
  /** Optional user-facing message to display. */
  message?: string;
  /** Whether the handler requests TUI exit. */
  exit?: boolean;
}

/**
 * A slash command registered in the TUI registry.
 *
 * Commands have a name (e.g. "model", "sessions"), an optional
 * description for autocomplete/help, optional subcommands for
 * nested dispatch (e.g. "/model set"), and an optional handler
 * that receives parsed args and context.
 */
export interface SlashCommand {
  /** Command name without the leading "/" (e.g. "model", "sessions"). */
  name: string;
  /** Human-readable description for autocomplete and /help. */
  description: string;
  /** Optional subcommands keyed by name. */
  subcommands?: Record<string, SlashCommand>;
  /**
   * Handler invoked when the command is dispatched.
   * Receives the space-separated args after the command name
   * and a context object for TUI interaction.
   */
  handler?: (args: string[], context: SlashCommandContext) => SlashCommandResult;
}
