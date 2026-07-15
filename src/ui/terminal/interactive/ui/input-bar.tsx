import type { KeyEvent, PasteEvent, TextareaRenderable } from "@opentui/core";
import { usePaste, useRenderer } from "@opentui/solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { handleInputEditingShortcut } from "../lib/input-editing";
import { isShellInput, parseTuiInput } from "../lib/input-mode";
import {
  applyInputSuggestion,
  formatInputSuggestion,
  getInputSuggestions,
  getVisibleInputSuggestions,
  type InputSuggestion,
  VISIBLE_INPUT_SUGGESTIONS,
} from "../lib/input-suggestions";
import { blockFromPasteBytes, classifyPastedText, readClipboardImageBlock } from "../lib/rich-paste";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";

const TEXTAREA_HEIGHT = 5;

/**
 * Override default textarea keybindings:
 *   Enter → submit,  Ctrl+Enter → newline
 * Default textarea behaviour maps Enter → newline (no submit).
 */
const INPUT_BAR_KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "kpenter", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
  { name: "kpenter", shift: true, action: "newline" as const },
];

export function InputBar(props: { store: TuiStore }) {
  const renderer = useRenderer();
  const theme = () => getTuiTheme(props.store.themeName());
  const queued = () => props.store.queuedMessages();
  const composerBlocks = () => props.store.composerBlocks();
  const inputMode = () => (composerBlocks().length === 0 ? parseTuiInput(props.store.inputValue()).mode : "message");
  const shellMode = () => inputMode() === "shell" || inputMode() === "shell-silent";
  const [suggestions, setSuggestions] = createSignal<InputSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = createSignal(0);
  const visibleSuggestions = () => getVisibleInputSuggestions(suggestions(), selectedSuggestion());
  let textareaRef: TextareaRenderable | null = null;

  const refreshSuggestions = (value: string): void => {
    const next = getInputSuggestions(
      value,
      textareaRef?.cursorOffset ?? value.length,
      props.store.options.cwd,
      props.store.options.i18n,
    );
    setSuggestions(next);
    setSelectedSuggestion(0);
  };

  createEffect(() => {
    props.store.localeRevision();
    refreshSuggestions(textareaRef?.plainText ?? props.store.inputValue());
  });

  const chooseSuggestion = (): void => {
    const suggestion = suggestions()[selectedSuggestion()];
    if (!suggestion || !textareaRef) return;
    const result = applyInputSuggestion(textareaRef.plainText, suggestion);
    textareaRef.setText(result.value);
    textareaRef.cursorOffset = result.cursor;
    props.store.setInput(result.value);
    setSuggestions([]);
  };

  const submit = (value: string) => {
    if (!props.store.hasSubmittableInput(value)) return;
    void props.store.submit(value);
    // Clear the textarea’s internal buffer — the signal alone only sets a JS
    // property on the node, it does not update the native text buffer.
    textareaRef?.setText("");
    textareaRef?.focus();
  };

  const handlePaste = (event: PasteEvent): void => {
    if (!textareaRef || props.store.activePane() !== "input") return;
    const block = blockFromPasteBytes(event.bytes, event.metadata);
    if (!block) return;
    if (block.type === "text" && (classifyPastedText(block.text) === "inline" || isShellInput(block.text))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (props.store.addComposerBlock(block)) {
      setSuggestions([]);
    }
  };

  usePaste(handlePaste);

  const navigateHistory = (direction: "older" | "newer"): void => {
    if (!textareaRef) return;
    const historyValue = props.store.historyNavigate(direction === "older" ? 1 : -1);
    if (historyValue !== null) {
      props.store.setInput(historyValue);
      textareaRef.setText(historyValue);
    } else if (direction === "newer") {
      // At newest — restore empty input
      props.store.setInput("");
      textareaRef.setText("");
    }
  };

  const handleKeyDown = (key: KeyEvent) => {
    if (!textareaRef) return;
    props.store.setActiveUiPane("input");

    if (handleInputEditingShortcut(key, textareaRef, () => renderer.clearSelection())) {
      setSuggestions([]);
      return;
    }

    if (suggestions().length > 0) {
      if (key.name === "up" || key.name === "down") {
        key.preventDefault();
        const delta = key.name === "up" ? -1 : 1;
        setSelectedSuggestion((index) => (index + delta + suggestions().length) % suggestions().length);
        return;
      }
      if (key.name === "tab" || key.name === "return" || key.name === "kpenter") {
        key.preventDefault();
        chooseSuggestion();
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        setSuggestions([]);
        return;
      }
    }

    // Up arrow → history older (only if at first line of input)
    if (key.name === "up") {
      const cursor = textareaRef.logicalCursor;
      if (cursor && cursor.row === 0) {
        key.preventDefault();
        navigateHistory("older");
        return;
      }
    }

    // Down arrow → history newer (only if at last line)
    if (key.name === "down") {
      const lineCount = textareaRef.lineCount;
      const cursor = textareaRef.logicalCursor;
      if (cursor && lineCount > 0 && cursor.row >= lineCount - 1) {
        key.preventDefault();
        navigateHistory("newer");
        return;
      }
    }

    // Ctrl+Y — copy last assistant (for convenience in textarea)
    if (key.ctrl && key.name === "y") {
      key.preventDefault();
      props.store.copyLastAssistant();
      return;
    }

    if (key.name === "backspace" && textareaRef.plainText.length === 0 && props.store.removeLastComposerBlock()) {
      key.preventDefault();
      setSuggestions([]);
      return;
    }

    if (key.ctrl && key.name === "v") {
      void readClipboardImageBlock().then((block) => {
        if (block) props.store.addComposerBlock(block);
      });
    }
  };

  return (
    <box
      height={
        TEXTAREA_HEIGHT +
        composerBlocks().length +
        Math.min(suggestions().length, VISIBLE_INPUT_SUGGESTIONS) +
        (queued().length > 0 ? 2 : 1)
      }
      backgroundColor={theme().background}
      border={["bottom"]}
      borderColor={shellMode() ? theme().warning : theme().border}
      borderStyle={shellMode() ? "heavy" : "single"}
      bottomTitle={shellMode() ? (inputMode() === "shell-silent" ? " !! shell · silent " : " ! shell ") : undefined}
      bottomTitleAlignment="right"
      style={{ flexDirection: "column" }}
    >
      <Show when={queued().length > 0}>
        <box
          height={1}
          backgroundColor={theme().panel}
          style={{ flexDirection: "row", paddingLeft: 3 }}
        >
          <text fg={theme().primary} wrapMode="none" truncate>
            {props.store.l("tui.queue.count", { count: queued().length })}
          </text>
          <text> </text>
          <text fg={theme().dim} wrapMode="none" truncate>
            {props.store.l("tui.queue.hint")}
          </text>
        </box>
      </Show>
      <Show when={composerBlocks().length > 0}>
        <box backgroundColor={theme().background} style={{ flexDirection: "column", paddingLeft: 3 }}>
          <For each={composerBlocks()}>
            {(block) => (
              <box height={1} backgroundColor={theme().background}>
                <text fg={theme().primary} wrapMode="none" truncate>
                  {props.store.formatComposerBlock(block)}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <box backgroundColor={theme().background} style={{ flexDirection: "column", paddingLeft: 3 }}>
        <For each={visibleSuggestions().suggestions}>
          {(suggestion, index) => (
            <box height={1} backgroundColor={theme().background}>
              <text
                fg={visibleSuggestions().startIndex + index() === selectedSuggestion() ? theme().primary : theme().muted}
                wrapMode="none"
                truncate
              >
                {formatInputSuggestion(suggestion, visibleSuggestions().startIndex + index() === selectedSuggestion())}
              </text>
            </box>
          )}
        </For>
      </box>
      <box height={TEXTAREA_HEIGHT} backgroundColor={theme().background} style={{ flexDirection: "row", paddingLeft: 1 }}>
        <text
          fg={props.store.confirmation() || shellMode() ? theme().warning : theme().secondary}
          style={{ paddingTop: 1 }}
        >
          <b>{shellMode() ? "$" : "›"}</b>{" "}
        </text>
        <textarea
          ref={(ref: TextareaRenderable) => {
            textareaRef = ref;
          }}
          initialValue={props.store.inputValue()}
          placeholder={props.store.getInputPlaceholder()}
          textColor={theme().text}
          focusedTextColor={theme().text}
          cursorColor={shellMode() ? theme().warning : theme().secondary}
          focused
          keyBindings={INPUT_BAR_KEY_BINDINGS}
          style={{ flexGrow: 1, minHeight: 1, maxHeight: TEXTAREA_HEIGHT - 1 }}
          onContentChange={() => {
            const value = textareaRef?.plainText ?? "";
            props.store.setActiveUiPane("input");
            props.store.setInput(value);
            refreshSuggestions(value);
          }}
          onCursorChange={() => {
            props.store.setActiveUiPane("input");
            refreshSuggestions(textareaRef?.plainText ?? "");
          }}
          onKeyDown={handleKeyDown}
          onSubmit={() => {
            const text = textareaRef?.plainText ?? "";
            submit(text);
          }}
        />
      </box>
    </box>
  );
}
