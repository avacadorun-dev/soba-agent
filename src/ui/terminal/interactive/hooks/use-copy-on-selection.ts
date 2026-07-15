import type { CliRenderer } from "@opentui/core";
import { useSelectionHandler } from "@opentui/solid";

interface SelectionClipboard {
  copyToClipboardOSC52(text: string): boolean;
}

/** Copy a completed, non-empty terminal selection without changing its contents. */
export function copySelectedText(
  text: string,
  clipboard: SelectionClipboard,
  onCopied: () => void,
): boolean {
  if (!text.trim()) return false;
  if (!clipboard.copyToClipboardOSC52(text)) return false;

  onCopied();
  return true;
}

/**
 * OpenTUI emits `selection` when the mouse drag finishes, so copying here
 * keeps the selected text highlighted after the user releases the button.
 */
export function useCopyOnSelection(
  renderer: CliRenderer,
  onCopied: () => void,
): void {
  useSelectionHandler((selection) => {
    copySelectedText(selection.getSelectedText(), renderer, onCopied);
  });
}
