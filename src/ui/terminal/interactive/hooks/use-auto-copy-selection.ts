import type { CliRenderer, Selection } from "@opentui/core";
import { useSelectionHandler } from "@opentui/solid";

type CompletedSelection = Pick<Selection, "anchor" | "focus" | "getSelectedText">;
type ClipboardRenderer = Pick<CliRenderer, "copyToClipboardOSC52">;

export function copyCompletedSelection(
  selection: CompletedSelection,
  renderer: ClipboardRenderer,
  onCopied: () => void,
): boolean {
  const { anchor, focus } = selection;
  if (anchor.x === focus.x && anchor.y === focus.y) return false;

  const text = selection.getSelectedText();
  if (text.length === 0 || !renderer.copyToClipboardOSC52(text)) return false;

  onCopied();
  return true;
}

export function useAutoCopySelection(renderer: CliRenderer, onCopied: () => void): void {
  useSelectionHandler((selection) => {
    copyCompletedSelection(selection, renderer, onCopied);
  });
}
