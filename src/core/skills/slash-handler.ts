/**
 * Slash Command Handler for Skills — Phase 2
 *
 * Handles /skill:<name> [args] commands.
 * Activates the skill and converts args to a user message.
 *
 * Phase 2.5 A4: Also exports a bridge function for TUI command
 * registry fallback — when a slash command is not a skill command,
 * the caller can check the TUI SlashCommandRegistry.
 *
 * Spec: internal-design-notes § Activation
 */

import type { ActivatedSkillRef } from "../session/types-v2";
import type { SkillManager } from "../skills/skill-manager";

export interface SkillSlashCommandResult {
  success: boolean;
  activation?: ActivatedSkillRef;
  userMessage?: string;
  error?: string;
}

export interface SlashCommandFallbackResult {
  handled: boolean;
  message?: string;
  exit?: boolean;
}

export interface SlashCommandFallbackRegistry<TContext = unknown> {
  dispatch(input: string, context: TContext): SlashCommandFallbackResult | undefined;
}

/**
 * Parse and handle /skill:<name> [args] command.
 */
export function handleSkillSlashCommand(
  input: string,
  skillManager: SkillManager,
  onActivate: (ref: ActivatedSkillRef) => void,
): SkillSlashCommandResult {
  // Parse command: /skill:<name> [args]
  const match = input.match(/^\/skill:([a-z0-9-]+)(?:\s+(.*))?$/);

  if (!match) {
    return {
      success: false,
      error: "Invalid command format. Use /skill:<name> [args]",
    };
  }

  const name = match[1];
  const args = match[2]?.trim() || "";

  // Activate the skill
  const result = skillManager.activate(name);

  if (!result.success) {
    return {
      success: false,
      error: result.error || `Failed to activate skill '${name}'`,
    };
  }

  const skill = skillManager.getSkill(name);
  if (!skill) {
    return {
      success: false,
      error: `Skill '${name}' not found in catalog`,
    };
  }

  // Create activation reference
  const ref: ActivatedSkillRef = {
    name: skill.name,
    scope: skill.scope,
    revision: skill.revision || "unknown",
    contentHash: skill.contentHash || "unknown",
  };

  // Persist activation
  onActivate(ref);

  // Create user message from args
  let userMessage: string;
  if (args) {
    userMessage = args;
  } else {
    userMessage = `Apply the ${name} skill to the current task.`;
  }

  return {
    success: true,
    activation: ref,
    userMessage,
  };
}

/**
 * Check if input is a skill slash command.
 */
export function isSkillSlashCommand(input: string): boolean {
  return /^\/skill:[a-z0-9-]+/.test(input.trim());
}

/**
 * Try to dispatch a slash command through the TUI command registry.
 *
 * This is the bridge between the core command router and the TUI
 * command registry. When a slash command is not a skill command
 * and not a known core command, the caller should try this fallback.
 *
 * Phase 2.5 A4: Slash Commands Registry integration.
 *
 * @param input - The full slash command input (e.g. "/model list")
 * @param registry - The TUI command registry
 * @param context - Context for TUI interaction
 * @returns The dispatch result, or undefined if the command is not found
 */
export function tryTuiRegistryFallback<TContext>(
  input: string,
  registry: SlashCommandFallbackRegistry<TContext>,
  context: TContext,
): SlashCommandFallbackResult | undefined {
  return registry.dispatch(input, context);
}
