/**
 * HelpMode — sidebar help panel with hotkeys and CLI commands.
 *
 * Shows all keyboard shortcuts and interactive commands
 * with compact descriptions that wrap within the sidebar.
 * Styled with sections, separators, and airy spacing.
 * Uses only <text> elements — no nested <box> inside scrollbox.
 */

import { For } from "solid-js";
import { RUNTIME_COMMANDS } from "../../../../application/ui/public";
import { slashCommandRegistry } from "../commands/registry";
import { formatKeyBindings } from "../lib/keymap";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";

// ─── Hotkey definitions ───

interface HotkeyEntry {
  key: string;
  action: string;
}

const HOTKEYS: HotkeyEntry[] = [
  { key: "Enter", action: "Submit prompt" },
  { key: "Shift+Enter", action: "Insert newline" },
  { key: "Mouse drag", action: "Select and copy text" },
  { key: "Cmd+A / Ctrl+Shift+A", action: "Select input text" },
  { key: "Ctrl+A / Ctrl+E", action: "Start / end of input line" },
  { key: formatKeyBindings("cancelOrQuit"), action: "Stop agent / Quit" },
  { key: formatKeyBindings("copyLastAssistant"), action: "Copy last assistant" },
  { key: `${formatKeyBindings("clearMessages")} / /clear`, action: "Clear messages" },
  { key: `${formatKeyBindings("openModelSelector")} / /model`, action: "Model selector" },
  { key: `${formatKeyBindings("openSearch")} / /search`, action: "Search conversation" },
  { key: formatKeyBindings("nextSidebarMode"), action: "Next sidebar mode" },
  { key: formatKeyBindings("previousSidebarMode"), action: "Previous mode" },
  { key: formatKeyBindings("toggleSidebar"), action: "Toggle sidebar" },
  { key: formatKeyBindings("copyTranscript"), action: "Copy transcript" },
  { key: "PgUp / PgDn", action: "Scroll page" },
  { key: "Home / End", action: "Scroll top / bottom" },
  { key: "↑ / ↓ in input", action: "Navigate history" },
  { key: "Esc", action: "Dismiss notification" },
  { key: "Tab", action: "Accept suggestion" },
  { key: formatKeyBindings("openHelp"), action: "This help panel" },
];

// ─── All commands (CLI + TUI) ───

function getAllCommands(store: TuiStore) {
  // Shared runtime slash commands advertised to TUI.
  const cliCommands = RUNTIME_COMMANDS.filter((command) => command.surfaces.includes("tui")).map((cmd) => ({
    name: cmd.name,
    description: store.l(cmd.descriptionKey),
  }));

  // TUI-specific commands from the in-app registry
  const tuiCommands = slashCommandRegistry
    .getAll()
    // Avoid duplicate /clear and /notifications which exist in both
    .filter((cmd) => !cliCommands.some((c) => c.name === `/${cmd.name}`))
    .map((cmd) => ({
      name: `/${cmd.name}`,
      description: cmd.description,
    }));

  return [...cliCommands, ...tuiCommands];
}

// ─── Main HelpMode ───

export function HelpMode(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());

  return (
    <>
      {/* ── Hotkeys section ── */}
      <text fg={theme().secondary} wrapMode="none" truncate>
        <b>▾ {props.store.l("tui.help.hotkeys")}</b>
      </text>
      <text> </text>

      <For each={HOTKEYS}>
        {(entry) => (
          <>
            <text fg={theme().primary} wrapMode="none" truncate>
              {entry.key}
            </text>
            <text fg={theme().muted} wrapMode="word">
              {entry.action}
            </text>
            <text fg={theme().dim}> </text>
          </>
        )}
      </For>

      {/* ── Separator ── */}
      <text fg={theme().dim} wrapMode="none" truncate>
        {"· ".repeat(8)}
      </text>
      <text> </text>

      {/* ── Commands section ── */}
      <text fg={theme().secondary} wrapMode="none" truncate>
        <b>▾ {props.store.l("tui.help.commands")}</b>
      </text>
      <text> </text>

      <For each={getAllCommands(props.store)}>
        {(cmd) => (
          <>
            <text fg={theme().primary} wrapMode="none" truncate>
              {cmd.name}
            </text>
            <text fg={theme().muted} wrapMode="word">
              {cmd.description}
            </text>
            <text fg={theme().dim}> </text>
          </>
        )}
      </For>
    </>
  );
}
