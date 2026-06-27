/**
 * StreamingMarkdown — writes streaming text directly to stdout.
 *
 * Deltas are written immediately — no accumulation, no re-parsing, no
 * cursor tricks.  The terminal handles line-wrapping natively and the
 * only work per delta is a single process.stdout.write().
 *
 * This replaces the previous approach that ran pi-tui's full Markdown
 * parser (marked.lexer) on the accumulated buffer every 16ms, which
 * caused severe CPU load and terminal flickering.
 */

// ─── StreamingMarkdown ───

export class StreamingMarkdown {
  private hasOutput = false;
  private label = "";
  private buffer = "";

  constructor(label = "") {
    this.label = label;
  }

  /** Reset for a new message block */
  reset(label = ""): void {
    this.hasOutput = false;
    this.label = label;
    this.buffer = "";
  }

  /** Feed a text delta — writes it directly to stdout */
  feed(delta: string): void {
    this.buffer += delta;

    // First chunk: print the label on its own line
    if (!this.hasOutput) {
      process.stdout.write(`${this.label}\n`);
      this.hasOutput = true;
    }

    // Write the delta immediately — no parsing, no re-rendering
    process.stdout.write(delta);
  }

  /**
   * Finalize the streaming block.
   * Adds a trailing newline for spacing.
   */
  done(): void {
    if (this.hasOutput) {
      process.stdout.write("\n");
    }
    this.buffer = "";
    this.hasOutput = false;
  }

  /** Render a complete text block in one shot (no streaming) */
  renderFull(text: string): void {
    this.reset(this.label);
    if (this.label) {
      process.stdout.write(`${this.label}\n`);
    }
    process.stdout.write(text);
    process.stdout.write("\n");
  }

  /** Whether any content has been output during the current block */
  get isActive(): boolean {
    return this.hasOutput;
  }
}
