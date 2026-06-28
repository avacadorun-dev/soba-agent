/**
 * REPL slash-commands for SOBA Agent.
 *
 * Commands are prefixed with "/" and processed before sending to the LLM.
 */

import type { AgentLoop, ContextManager, I18n, McpRuntimeControllerLike, McpRuntimeManager, OpenResponsesClient, ProviderRegistry, RuntimeSessionHandle, SessionLifecycleService, SkillCommands, SkillManager, SlashCommandContext, SlashCommandRegistry, SobaConfig, ToolRegistry, TrustManager, TuiRenderer } from "../public";
import {
  type CommandResult, handleSkillSlashCommand, isSkillSlashCommand, McpSecretStore, notify,
  parseRuntimeCommandInput,
  RUNTIME_COMMANDS,
  type RuntimeCommandMetadata, tryTuiRegistryFallback
} from "../public";
import { handleCapsule } from "./capsule";
import {
  handleAutoCompact,
  handleCompact,
  handleConfig,
  handleHelp,
  handleLang,
  handleRewind,
  handleTheme,
} from "./general";
import { handleMcp } from "./mcp";
import { handleBudget, handleSession, handleSessions } from "./session";
import { handlePermissions, handleProjectTrust, handleSkill } from "./skill";

// ─── Types ───

export interface CommandContext {
  client: OpenResponsesClient;
  session: RuntimeSessionHandle;
  sessionLifecycle?: SessionLifecycleService;
  setSession?: (session: RuntimeSessionHandle) => void;
  config: SobaConfig;
  i18n: I18n;
  renderer: Pick<TuiRenderer, "emit">;
  contextManager?: ContextManager;
  autoCompactOverride?: { enabled: boolean };
  skillManager?: SkillManager;
  skillCommands?: SkillCommands;
  agentLoop?: AgentLoop;
  registry?: ProviderRegistry;
  mcpRuntime?: McpRuntimeControllerLike;
  mcpManager?: McpRuntimeManager;
  mcpSecretStore?: McpSecretStore;
  toolRegistry?: ToolRegistry;
  trustManager?: TrustManager;
  /** TUI slash command registry for dispatching TUI commands (Phase 2.5 A4). */
  tuiRegistry?: SlashCommandRegistry;
}

export type { CommandResult };

export const SLASH_COMMANDS: readonly RuntimeCommandMetadata[] = RUNTIME_COMMANDS;

// ─── Command Router ───

const COMMAND_HANDLERS: Record<
  string,
  (args: string[], ctx: CommandContext) => CommandResult | Promise<CommandResult>
> = {
  compact: handleCompact,
  rewind: handleRewind,
  session: handleSession,
  sessions: handleSessions,
  capsule: handleCapsule,
  "auto-compact": handleAutoCompact,
  budget: handleBudget,
  config: handleConfig,
  lang: handleLang,
  theme: handleTheme,
  permissions: handlePermissions,
  skill: handleSkill,
  "project-trust": handleProjectTrust,
  mcp: handleMcp,
  help: handleHelp,
  exit: () => ({ handled: true, exit: true }),
  quit: () => ({ handled: true, exit: true }),
};

/**
 * Process a slash command. Returns CommandResult indicating
 * whether the input was handled and if the REPL should exit.
 */
export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  if (!input.startsWith("/")) return { handled: false };

  // Check for skill slash command first: /skill:<name> [args]
  if (isSkillSlashCommand(input)) {
    if (!ctx.skillManager) {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.notConfigured"),
      });
      return { handled: true };
    }

    const result = handleSkillSlashCommand(
      input,
      ctx.skillManager,
      (ref) => {
        // Persist activation in session
        ctx.session.appendSkillActivation({ action: "activate", skill: ref });
      },
    );

    if (result.success) {
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.activated", { name: result.activation?.name ?? input }),
      });
      notify(
        "success",
        `Skill activated: ${result.activation?.name ?? input}`,
        `Revision ${result.activation?.revision ?? "?"}`,
      );

      // If there's a user message, we need to return it as unhandled so it gets processed
      if (result.userMessage) {
        return { handled: false, prompt: result.userMessage };
      }
    } else {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: result.error || "Failed to activate skill",
      });
    }

    return { handled: true };
  }

  const parsed = parseRuntimeCommandInput(input);
  const cmd = parsed?.id;

  if (!cmd) return { handled: true };

  const handler = COMMAND_HANDLERS[cmd];
  if (!handler) {
    // Phase 2.5 A4: Try TUI slash command registry as fallback
    if (ctx.tuiRegistry) {
      const tuiContext: SlashCommandContext = {
        addMessage: undefined, // Non-TUI mode has no message list
        exit: undefined,
      };
      const result = tryTuiRegistryFallback(input, ctx.tuiRegistry, tuiContext);
      if (result) {
        if (result.exit) return { handled: true, exit: true };
        if (result.message) {
          ctx.renderer.emit({
            type: "info",
            timestamp: Date.now(),
            message: result.message,
          });
        }
        return { handled: true };
      }
    }

    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.unknown", { command: `/${cmd}` }),
    });
    return { handled: true };
  }

  return handler(parsed.args, ctx);
}
