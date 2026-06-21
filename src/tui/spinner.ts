/**
 * Braille spinner for TUI.
 *
 * Zero-dependency animated spinner using Braille characters.
 */

import { tFg } from "./theme";

// ─── Spinner frames ───

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ─── Spinner class ───

export class Spinner {
  private frameIndex = 0;
  private frames: string[];
  private intervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message = "";
  private _isRunning = false;

  constructor(frames: string[] = BRAILLE_FRAMES, intervalMs = 80) {
    this.frames = frames;
    this.intervalMs = intervalMs;
  }

  /** Start the spinner with an optional message */
  start(message = ""): void {
    this.message = message;
    this._isRunning = true;
    this.frameIndex = 0;
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.intervalMs);
    this.render();
  }

  /** Update the spinner message */
  update(message: string): void {
    this.message = message;
    if (this._isRunning) this.render();
  }

  /** Stop the spinner and clear the line */
  stop(): void {
    this._isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Clear the spinner line
    process.stdout.write("\r\x1b[2K");
  }

  /** Check if spinner is running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Render the current frame */
  private render(): void {
    const frame = this.frames[this.frameIndex];
    const line = ` ${tFg("accent", frame)} ${this.message}`;
    process.stdout.write(`\r${line}`);
  }
}
