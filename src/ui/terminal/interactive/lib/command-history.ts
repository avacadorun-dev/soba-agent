/**
 * Command History — persistent command history for TUI InputBar.
 *
 * Stores commands in ~/.soba/history file (one per line).
 * Supports up/down navigation, cyclic wrapping, and dedup with recent entries.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_HISTORY = 500;

export class CommandHistory {
  private items: string[] = [];
  private index = -1; // -1 = new input, 0 = newest, length-1 = oldest
  private readonly filePath: string;

  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = filePath;
    } else {
      const dir = join(homedir(), ".soba");
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch {
          // Ignore — history just won't persist
        }
      }
      this.filePath = join(dir, "history");
    }
    this.load();
  }

  /** Get the current history item (for up/down navigation). */
  get current(): string | null {
    if (this.index < 0 || this.index >= this.items.length) return null;
    return this.items[this.index];
  }

  /** Get the current index. -1 means "new input" position. */
  get currentIndex(): number {
    return this.index;
  }

  /** Navigate to older history entry. Returns the entry or null if at oldest. */
  older(): string | null {
    if (this.items.length === 0) return null;
    if (this.index < this.items.length - 1) {
      this.index++;
    }
    return this.current;
  }

  /** Navigate to newer history entry. Returns the entry or null if at newest. */
  newer(): string | null {
    if (this.index >= 0) {
      this.index--;
    }
    return this.current;
  }

  /** Reset to new input position. */
  reset(): void {
    this.index = -1;
  }

  /** Add a command to history. Dedup if same as last entry. */
  add(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Dedup: don't add if same as last entry
    if (this.items[0] === trimmed) return;
    // Also don't add if same as the entry we just submitted (handles re-submit of history item)
    if (this.items.length > 0 && this.items[0] === trimmed) return;

    this.items.unshift(trimmed);

    // Keep within max size
    if (this.items.length > MAX_HISTORY) {
      this.items = this.items.slice(0, MAX_HISTORY);
    }

    this.index = -1;
    this.save();
  }

  /** Load history from disk. */
  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const data = readFileSync(this.filePath, "utf-8");
      const lines = data.split("\n").filter(Boolean).reverse();
      this.items = lines.slice(0, MAX_HISTORY);
    } catch {
      this.items = [];
    }
  }

  /** Save history to disk. */
  private save(): void {
    try {
      const data = [...this.items].reverse().join("\n") + "\n";
      writeFileSync(this.filePath, data, "utf-8");
    } catch {
      // Silent fail — history is non-critical
    }
  }
}
