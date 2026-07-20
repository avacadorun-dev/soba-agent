import { type Accessor, createSignal, type Setter } from "solid-js";

/** Keyboard state for the structured clarification barrier. */
export class ClarificationDialogManager {
  private readonly _highlightedIndex: Accessor<number>;
  private readonly _setHighlightedIndex: Setter<number>;
  private optionCount = 0;

  constructor() {
    [this._highlightedIndex, this._setHighlightedIndex] = createSignal(0);
  }

  get highlightedIndex(): Accessor<number> {
    return this._highlightedIndex;
  }

  reset(optionCount: number): void {
    this.optionCount = Math.max(0, optionCount);
    this._setHighlightedIndex(0);
  }

  setHighlight(index: number): void {
    if (index >= 0 && index < this.optionCount) this._setHighlightedIndex(index);
  }

  moveHighlight(delta: number): void {
    if (this.optionCount === 0) return;
    this._setHighlightedIndex((current) => (current + delta + this.optionCount) % this.optionCount);
  }

  handleKey(
    key: { name: string; shift?: boolean },
    onSelect: (index: number) => void,
    onDecline: () => void,
  ): boolean {
    const name = key.name.toLowerCase();
    if (name === "escape") {
      onDecline();
      return true;
    }
    if (name === "return" || name === "kpenter") {
      onSelect(this._highlightedIndex());
      return true;
    }
    if (name === "left" || name === "up" || (name === "tab" && key.shift)) {
      this.moveHighlight(-1);
      return true;
    }
    if (name === "right" || name === "down" || name === "tab") {
      this.moveHighlight(1);
      return true;
    }
    if (/^[1-5]$/.test(name)) {
      const index = Number(name) - 1;
      if (index < this.optionCount) onSelect(index);
      return index < this.optionCount;
    }
    return false;
  }
}
