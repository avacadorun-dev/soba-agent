/**
 * TrustDialog — Phase 2.5 A3.
 *
 * Inline dialog rendered between the message list and input bar when a
 * dangerous tool call requires user confirmation. Renders in normal flow,
 * stretched to full content width, with generous horizontal padding.
 *
 * Keyboard input is handled by the global useTuiKeys hook (no textarea).
 *
 * Layout (full content width, padded):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                                                                 │
 * │   ⚠  Dangerous Command                                         │
 * │                                                                 │
 * │   rm -rf node_modules && rm -rf .git                            │
 * │   This may cause data loss                                      │
 * │                                                                 │
 * │   ▶ Deny    Allow Once    Allow Session    Allow Repo    Full   │
 * │   Tab/Enter · y/s/r/f/n · Esc to deny                          │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { Show, createEffect, createMemo } from "solid-js";
import type { TuiThemeName } from "../../../../application/ui/public";
import { getTuiTheme } from "../lib/theme";
import type { TrustDecision } from "../lib/trust-dialog-manager";
import type { TuiStore } from "../model/tui-store";

export { TrustDialogManager } from "../lib/trust-dialog-manager";

interface ButtonDef {
  decision: TrustDecision;
  labelKey: string;
}

const BUTTONS: ButtonDef[] = [
  { decision: "deny", labelKey: "tui.trust.deny" },
  { decision: "once", labelKey: "tui.trust.allowOnce" },
  { decision: "session", labelKey: "tui.trust.allowSession" },
  { decision: "repo", labelKey: "tui.trust.allowRepo" },
  { decision: "full", labelKey: "tui.trust.allowFull" },
];

export function TrustDialog(props: {
  store: TuiStore;
  themeName: () => TuiThemeName;
  manager: import("../lib/trust-dialog-manager").TrustDialogManager;
}) {
  const theme = () => getTuiTheme(props.themeName());
  const confirmation = () => props.store.confirmation();

  const isOpen = () => confirmation() !== null;

  // Reset highlight position each time the dialog opens.
  createEffect(() => {
    if (isOpen()) props.manager.reset();
  });

  const highlightIndex = props.manager.highlightedIndex;

  // Build the single button row with highlight.
  const buttonRow = createMemo(() => {
    const hl = highlightIndex();
    const t = (key: string) => props.store.l(key as Parameters<TuiStore["l"]>[0]);
    const th = theme();

    const parts: Array<{ text: string; fg: string; bold: boolean }> = [];

    for (let i = 0; i < BUTTONS.length; i++) {
      const btn = BUTTONS[i];
      const isHl = i === hl;

      parts.push({
        text: isHl ? "▶ " : "  ",
        fg: isHl ? th.primary : th.muted,
        bold: isHl,
      });

      parts.push({
        text: t(btn.labelKey),
        fg: isHl ? th.primary : th.text,
        bold: isHl,
      });

      if (i < BUTTONS.length - 1) {
        parts.push({ text: "    ", fg: th.muted, bold: false });
      }
    }

    return parts;
  });

  const commandText = () => confirmation()?.description ?? "";
  const reasonText = () => confirmation()?.reason ?? "";

  return (
    <Show when={isOpen()}>
      <box
        backgroundColor={theme().panel}
        border
        borderColor={theme().primary}
        style={{ flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, flexShrink: 0 }}
      >
        {/* Title */}
        <box height={1} style={{ flexDirection: "row", alignItems: "center", paddingLeft: 2, paddingRight: 2 }}>
          <text fg={theme().warning} wrapMode="none">
            ⚠{"  "}
          </text>
          <text fg={theme().primary} wrapMode="none" truncate>
            <b>{props.store.l("tui.trust.title")}</b>
          </text>
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Command (can wrap to 2 lines) */}
        <box height={2} style={{ paddingLeft: 2, paddingRight: 2, flexDirection: "column" }}>
          <text fg={theme().muted} wrapMode="word">
            {commandText()}
          </text>
        </box>

        {/* Reason (single line, truncated) */}
        <box height={1} style={{ paddingLeft: 2, paddingRight: 2 }}>
          <text fg={theme().secondary} wrapMode="none" truncate>
            {reasonText()}
          </text>
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Buttons (single row, 5 options) */}
        <box height={1} style={{ flexDirection: "row", alignItems: "center", paddingLeft: 2, paddingRight: 2 }}>
          {buttonRow().map((part) => (
            <text fg={part.fg} wrapMode="none">
              {part.bold ? <b>{part.text}</b> : part.text}
            </text>
          ))}
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Hint */}
        <box height={1} style={{ paddingLeft: 2, paddingRight: 2 }}>
          <text fg={theme().muted} wrapMode="none" truncate>
            {props.store.l("tui.trust.hint")}
          </text>
        </box>
      </box>
    </Show>
  );
}
