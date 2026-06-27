/**
 * TrustDialogManager — Phase 2.5 A3.
 *
 * Manages the state and keyboard navigation for the TrustDialog overlay.
 * Uses Solid signals for reactive highlight tracking.
 *
 * Buttons layout (2x2 grid):
 *   [Allow Once]    [Allow Session]
 *   [Deny (default)] [Allow Repo]
 *
 * Keyboard shortcuts:
 *   Tab / SHIFT+Tab — navigate between buttons
 *   Enter — select highlighted button
 *   Escape / n — Deny
 *   y — Allow Once
 *   s — Allow Session
 *   r — Allow Repo (repo trust)
 *   f — Allow Full (session-wide dangerous operations)
 */

import { type Accessor, createSignal, type Setter } from "solid-js";

export type TrustDecision = "deny" | "once" | "session" | "repo" | "full";

/** Index-to-decision mapping for the dialog button row. */
const BUTTON_ORDER: TrustDecision[] = ["deny", "once", "session", "repo", "full"];

/** Keyboard shortcut → decision mapping (backward compatible with y/s/r/n, plus f=full). */
const KEY_DECISIONS: Record<string, TrustDecision> = {
  y: "once",
  s: "session",
  r: "repo",
  f: "full",
  n: "deny",
};

export class TrustDialogManager {
  private readonly _highlightedIndex: Accessor<number>;
  private readonly _setHighlightedIndex: Setter<number>;

  constructor() {
    [this._highlightedIndex, this._setHighlightedIndex] = createSignal(0); // Default: Deny (index 0)
  }

  /** Currently highlighted button index (0=Deny, 1=Once, 2=Session, 3=Repo, 4=Full). */
  get highlightedIndex(): Accessor<number> {
    return this._highlightedIndex;
  }

  /** Currently highlighted decision. */
  get highlightedDecision(): Accessor<TrustDecision> {
    return () => BUTTON_ORDER[this._highlightedIndex()];
  }

  /** Current decision for the highlighted button. */
  currentDecision(): TrustDecision {
    return BUTTON_ORDER[this._highlightedIndex()];
  }

  /**
   * Move keyboard highlight by delta (1 = Tab, -1 = SHIFT+Tab).
   * Wraps around all buttons.
   */
  moveHighlight(delta: number): void {
    this._setHighlightedIndex((prev) => {
      let next = prev + delta;
      if (next < 0) next = BUTTON_ORDER.length - 1;
      if (next >= BUTTON_ORDER.length) next = 0;
      return next;
    });
  }

  /**
   * Set highlight directly to a specific button by decision type.
   */
  setHighlight(decision: TrustDecision): void {
    const index = BUTTON_ORDER.indexOf(decision);
    if (index >= 0) {
      this._setHighlightedIndex(index);
    }
  }

  /**
   * Handle a keyboard keypress. Returns true if the key was handled
   * (i.e., a decision was made or navigation occurred), false otherwise.
   */
  handleKey(key: { name: string; shift?: boolean }, onDecision: (decision: TrustDecision) => void): boolean {
    const keyName = key.name.toLowerCase();

    // Escape → Deny
    if (keyName === "escape") {
      onDecision("deny");
      return true;
    }

    // Enter / numpad Enter → select highlighted
    if (keyName === "return" || keyName === "kpenter") {
      onDecision(this.currentDecision());
      return true;
    }

    // Left/right arrow navigation (mimics Tab / Shift+Tab)
    if (keyName === "left") {
      this.moveHighlight(-1);
      return true;
    }
    if (keyName === "right") {
      this.moveHighlight(1);
      return true;
    }

    // Tab / Shift+Tab navigation
    if (keyName === "tab") {
      this.moveHighlight(key.shift ? -1 : 1);
      return true;
    }

    // Backward-compatible keyboard shortcuts (y/s/r/n), plus f=full.
    const decision = KEY_DECISIONS[keyName];
    if (decision) {
      onDecision(decision);
      return true;
    }

    return false;
  }

  /** Reset highlight to default (Deny). */
  reset(): void {
    this._setHighlightedIndex(0);
  }
}
