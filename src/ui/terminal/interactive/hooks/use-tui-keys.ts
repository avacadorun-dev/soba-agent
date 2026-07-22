import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { ClarificationDialogManager } from "../lib/clarification-dialog-manager";
import { keyMatchesAction } from "../lib/keymap";
import type { TrustDialogManager } from "../lib/trust-dialog-manager";
import type { NotificationStore } from "../model/notification-store";
import type { ProviderStore } from "../model/provider-store";
import type { TuiStore } from "../model/tui-store";
import type { ToolResultFocusRef } from "../ui/message-list";

interface TuiKeysOptions {
  store: TuiStore;
  providerStore?: ProviderStore;
  notificationStore?: NotificationStore;
  getScrollbox: () => ScrollBoxRenderable | null;
  getToolFocus: () => ToolResultFocusRef | null;
  shutdown: () => void;
  renderer: CliRenderer;
  trustDialogManager?: TrustDialogManager;
  clarificationDialogManager?: ClarificationDialogManager;
  openSearch?: () => void;
}

export function useTuiKeys(options: TuiKeysOptions): void {
  useKeyboard((key) => {
    if (options.store.clarification() && options.clarificationDialogManager) {
      if (key.ctrl && key.name === "c") {
        key.preventDefault();
        options.store.cancel();
        return;
      }
      const handled = options.clarificationDialogManager.handleKey(
        key,
        (index) => {
          const option = options.store.clarification()?.request.options[index];
          if (option) options.store.answerClarification(option.id);
        },
        () => options.store.declineClarification(),
      );
      if (handled) {
        key.preventDefault();
        return;
      }
      // Printable keys continue to the input editor so allowOther can accept text.
    }

    // When trust dialog is open, route all keys through the dialog manager.
    if (options.store.confirmation() && options.trustDialogManager) {
      if (key.ctrl && key.name === "c") {
        key.preventDefault();
        options.store.confirmDecision("deny");
        return;
      }
      // Delegate to the dialog manager (handles y/s/r/n, Tab, Enter, Escape, arrows).
      const handled = options.trustDialogManager.handleKey(key, (decision) => {
        options.store.confirmDecision(decision);
      });
      if (handled) {
        key.preventDefault();
      }
      return;
    }

    if (keyMatchesAction(key, "copyTranscript")) {
      key.preventDefault();
      const editorText = options.renderer.currentFocusedEditor?.getSelectedText();
      const terminalSelection = options.renderer.getSelection();
      const text = editorText?.trim() ? editorText : terminalSelection?.getSelectedText();
      if (text?.trim() && options.renderer.copyToClipboardOSC52(text)) {
        options.store.notifyCopied();
        if (!editorText?.trim()) options.renderer.clearSelection();
      } else {
        options.store.copyTranscript();
      }
      return;
    }
    if (keyMatchesAction(key, "cancelOrQuit")) {
      key.preventDefault();
      if (options.providerStore?.isOpen()) {
        options.providerStore.close();
        return;
      }
      if (options.store.isProcessing()) {
        options.store.cancel();
      } else {
        options.shutdown();
      }
      return;
    }
    if (keyMatchesAction(key, "copyLastAssistant")) {
      key.preventDefault();
      options.store.copyLastAssistant();
      return;
    }
    if (keyMatchesAction(key, "openSearch") && !options.store.isProcessing()) {
      key.preventDefault();
      if (options.openSearch) {
        options.openSearch();
      }
      return;
    }
    if (keyMatchesAction(key, "clearMessages")) {
      key.preventDefault();
      options.store.clearMessages();
      return;
    }
    if (keyMatchesAction(key, "openModelSelector") && options.providerStore) {
      key.preventDefault();
      options.providerStore.open();
      return;
    }
    if (
      keyMatchesAction(key, "cycleReasoning") &&
      !options.providerStore?.isOpen() &&
      !options.store.isSearchOpen()
    ) {
      key.preventDefault();
      void options.store.cycleReasoning();
      return;
    }
    if (keyMatchesAction(key, "toggleSidebar")) {
      key.preventDefault();
      options.store.toggleSidebar();
      return;
    }
    if (keyMatchesAction(key, "previousSidebarMode")) {
      key.preventDefault();
      options.store.cycleSidebarMode(-1);
      return;
    }
    if (keyMatchesAction(key, "nextSidebarMode")) {
      key.preventDefault();
      options.store.cycleSidebarMode(1);
      return;
    }
    if (keyMatchesAction(key, "openHelp")) {
      key.preventDefault();
      options.store.openHelpSidebar();
      return;
    }
    // Escape dismisses the oldest visible notification when no other modal is active.
    if (key.name === "escape" && options.notificationStore) {
      if (!options.providerStore?.isOpen()) {
        const dismissed = options.notificationStore.dismissOldest();
        if (dismissed) {
          key.preventDefault();
          return;
        }
      }
    }

  // === Tool-result focus navigation (Phase 2.5 B2) ===
  // When a tool-result is focused, arrow keys navigate between results
  // and Enter toggles the focused result.
  const toolFocus = options.getToolFocus();
  if (toolFocus) {
    // Enter toggles the focused tool-result — only when a result is focused
    if (key.name === "return" && toolFocus.isFocused() && !key.ctrl && !key.meta && !options.store.isProcessing()) {
      key.preventDefault();
      toolFocus.toggleFocused();
      return;
    }
    // Escape defocuses the tool-result (before notification dismissal)
    if (key.name === "escape" && toolFocus.isFocused() && !options.store.isProcessing()) {
      key.preventDefault();
      toolFocus.defocus();
      options.store.setActiveUiPane("input");
      return;
    }
  }

  if (keyMatchesAction(key, "focusNextToolResult") && !options.store.isProcessing()) {
    key.preventDefault();
    const tf = options.getToolFocus();
    if (tf) {
      tf.focusNext();
    }
    return;
  }
  if (keyMatchesAction(key, "focusPreviousToolResult") && !options.store.isProcessing()) {
    key.preventDefault();
    const tf = options.getToolFocus();
    if (tf) {
      tf.focusPrev();
    }
    return;
  }

    const scrollbox = options.getScrollbox();
    if (!scrollbox) return;
    const page = Math.max(1, scrollbox.height - 2);
    if (key.name === "pageup") {
      key.preventDefault();
      scrollbox.scrollBy(-page);
    } else if (key.name === "pagedown") {
      key.preventDefault();
      scrollbox.scrollBy(page);
    } else if (key.name === "home") {
      key.preventDefault();
      scrollbox.scrollTo(0);
    } else if (key.name === "end") {
      key.preventDefault();
      scrollbox.scrollTo(scrollbox.scrollHeight);
    }
  });
}
