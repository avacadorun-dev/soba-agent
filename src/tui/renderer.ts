/**
 * TUI Renderer — event-driven terminal output with minimal overhead.
 *
 * Streaming text is written directly to stdout with no Markdown parsing.
 * Non-streaming messages print label + raw text.
 * Clean status bar with token usage.
 */

import type { I18n } from "../core/i18n/i18n";
import type { AgentEvent } from "../core/loop/types";
import { formatToolSummary } from "../widgets/tui/lib/format-tool";
import { bold, wrapText } from "./colors";
import { Spinner } from "./spinner";
import { renderStatusBar, type StatusBarData } from "./status-bar";
import { StreamingMarkdown } from "./streaming-markdown";
import { tFg } from "./theme";

// ─── Types ───

export type RenderMode = "print" | "interactive";

export interface RendererConfig {
  mode: RenderMode;
  model: string;
  cwd: string;
  tokenBudget: number;
  maxWidth?: number;
  i18n: I18n;
}

// ─── Renderer ───

export class TuiRenderer {
  private config: RendererConfig;
  private usedTokens = 0;
  private turnCount = 0;
  private showStatusBarFlag = false;

  // Streaming state
  private streaming = new StreamingMarkdown();
  private spinner = new Spinner(["∿", "∼", "≈"], 500);

  constructor(config: RendererConfig) {
    this.config = config;
  }

  getUsedTokens(): number {
    return this.usedTokens;
  }

  updateConfig(partial: Partial<RendererConfig>): void {
    Object.assign(this.config, partial);
  }

  setShowStatusBar(show: boolean): void {
    this.showStatusBarFlag = show;
  }

  /** Render session start header */
  renderSessionStart(sessionId: string): void {
    const shortCwd = this.config.cwd.replace(process.env.HOME ?? "", "~");
    console.log(
      tFg(
        "dim",
        this.config.i18n.t("tui.session.start", { session: sessionId.slice(0, 8), model: this.config.model, cwd: shortCwd }),
      ),
    );
    console.log("");
  }

  /** Render a complete user message — used in print mode */
  renderUserMessage(text: string): void {
    const label = tFg("accent", bold(this.config.i18n.t("tui.label.you")));
    const maxWidth = this.config.maxWidth ?? process.stdout.columns ?? 80;
    const wrapped = wrapText(text, maxWidth);
    console.log(`\n${label}`);
    process.stdout.write(`${wrapped}\n`);
  }

  /** Render a complete assistant message (non-streaming) */
  renderAssistantMessage(text: string, reasoningContent?: string): void {
    const label = tFg("accent", bold(this.config.i18n.t("tui.label.assistant")));
    const maxWidth = this.config.maxWidth ?? process.stdout.columns ?? 80;

    if (reasoningContent) {
      console.log(`\n${tFg("accent", bold(`🍜 ${this.config.i18n.t("tui.thinking")}`))}`);
      process.stdout.write(`${wrapText(reasoningContent, maxWidth)}\n`);
    }

    console.log(`\n${label}`);
    process.stdout.write(`${wrapText(text, maxWidth)}\n`);
    console.log("");
  }

  /** Emit a TUI event */
  emit(event: { type: string; timestamp: number; [key: string]: unknown }): void {
    switch (event.type) {
      case "user_message":
        this.flushStream();
        this.renderUserMessage(event.text as string);
        break;

      case "agent_text_start":
        this.flushStream();
        this.streaming.reset(tFg("accent", bold(this.config.i18n.t("tui.label.assistant"))));
        break;

      case "agent_text_delta":
        this.streaming.feed(event.delta as string);
        break;

      case "agent_text_done": {
        const fullText = event.fullText as string;
        const reasoningContent = event.reasoningContent as string | undefined;

        // If we were streaming, finalize the stream
        if (this.streaming.isActive) {
          this.streaming.done();
          // Show reasoning BEFORE text if present (text was already streamed)
          if (reasoningContent) {
            console.log("");
            console.log(tFg("accent", bold(`🍜 ${this.config.i18n.t("tui.reasoning")}`)));
            process.stdout.write(`${reasoningContent}\n`);
          }
        } else {
          // Render full message (e.g. non-streaming mode)
          this.renderAssistantMessage(fullText, reasoningContent);
        }
        break;
      }

      case "agent_thinking":
        if (event.active as boolean) {
          this.spinner.start(this.config.i18n.t("tui.thinking"));
        } else {
          this.spinner.stop();
        }
        break;

      case "tool_call_start":
        this.flushStream();
        console.log(
          `  ${tFg("warning", `→ ${formatToolSummary(String(event.toolName), (event.args as Record<string, unknown>) ?? {})}`)}`,
        );
        break;

      case "tool_call_result": {
        const result = event.result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
        if (result.isError) {
          const output = result.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n");
          const lines = output.split("\n");
          for (const line of lines.slice(0, 5)) {
            console.log(`    ${tFg("error", line)}`);
          }
          if (lines.length > 5) {
            console.log(`    ${tFg("dim", `… ${lines.length - 5} more lines`)}`);
          }
        }
        break;
      }

      case "tool_call_end":
        console.log("");
        break;

      case "budget_update":
        this.usedTokens = event.usedTokens as number;
        break;

      case "loop_guard":
        this.flushStream();
        console.log(
          tFg(
            event.action === "recover" ? "warning" : "error",
            this.config.i18n.t("tui.label.loopGuard", { action: String(event.action), message: String(event.message) }),
          ),
        );
        break;

      case "compaction_start":
        this.flushStream();
        console.log(tFg("dim", this.config.i18n.t("compact.starting", { tokens: event.tokensBefore as number })));
        break;

      case "compaction_done": {
        const tokensBefore = event.tokensBefore as number;
        const tokensAfter = event.tokensAfter as number;
        console.log(
          tFg(
            "dim",
            this.config.i18n.t("tui.compact.completePercent", {
              before: tokensBefore,
              after: tokensAfter,
              percent: Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100),
            }),
          ),
        );
        console.log("");
        break;
      }

      case "error":
        this.flushStream();
        console.log(tFg("error", `✖ ${this.config.i18n.t("tui.label.error", { message: String(event.message) })}`));
        break;

      case "turn_stop_reason":
        if (event.reason === "completed") break;
        this.flushStream();
        console.log(
          tFg("dim", `⏹ ${this.config.i18n.t("tui.label.stop", { reason: String(event.reason), detail: String(event.detail) })}`),
        );
        break;

      case "info":
      case "language_changed":
        this.flushStream();
        console.log(tFg("muted", `${event.message}`));
        break;

      case "session_end":
        this.flushStream();
        console.log(tFg("dim", this.config.i18n.t("tui.session.end", { turns: event.totalTurns as number })));
        break;
    }
  }

  /** Convert AgentLoop events → TUI events + render tool blocks with output */
  emitAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.turnCount = event.turnIndex;

        if (this.showStatusBarFlag) {
          this.renderStatusLine();
        }

        if (this.turnCount > 1) {
          console.log("");
        }

        this.emit({
          type: "user_message",
          timestamp: event.timestamp,
          text: event.userInput,
        });
        break;

      case "thinking":
        this.emit({
          type: "agent_thinking",
          timestamp: event.timestamp,
          active: event.active,
        });
        break;

      case "assistant_message_start":
        this.emit({
          type: "agent_text_start",
          timestamp: event.timestamp,
          messageId: event.messageId,
        });
        break;

      case "assistant_text_delta":
        this.emit({
          type: "agent_text_delta",
          timestamp: event.timestamp,
          messageId: event.messageId,
          delta: event.delta,
        });
        break;

      case "assistant_text_done":
        this.emit({
          type: "agent_text_done",
          timestamp: event.timestamp,
          messageId: event.messageId,
          fullText: event.fullText,
          reasoningContent: event.reasoningContent,
        });
        break;

      case "assistant_message":
        this.emit({
          type: "agent_text_done",
          timestamp: event.timestamp,
          messageId: event.messageId,
          fullText: event.text,
          reasoningContent: event.reasoningContent,
        });
        break;

      case "function_call_delta":
      case "function_call_done":
        break;

      case "tool_call_start":
        this.emit({
          type: "tool_call_start",
          timestamp: event.timestamp,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
        });
        break;

      case "tool_call_result":
        this.emit({
          type: "tool_call_result",
          timestamp: event.timestamp,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
        });
        break;

      case "tool_call_end": {
        this.emit({
          type: "tool_call_end",
          timestamp: event.timestamp,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          durationMs: event.durationMs,
        });
        break;
      }

      case "budget_update":
        this.emit({
          type: "budget_update",
          timestamp: event.timestamp,
          usedTokens: event.usedTokens,
          totalBudget: event.totalBudget,
          percentage: event.percentage,
        });
        break;

      case "turn_end":
        break;

      case "turn_stop_reason":
        this.emit({
          type: "turn_stop_reason",
          timestamp: event.timestamp,
          turn: event.turn,
          reason: event.reason,
          detail: event.detail,
        });
        break;

      case "turn_error":
        this.emit({
          type: "error",
          timestamp: event.timestamp,
          message: event.error,
        });
        break;

      case "loop_guard":
        this.emit({
          type: "loop_guard",
          timestamp: event.timestamp,
          action: event.action,
          message: event.message,
        });
        break;
    }
  }

  getStatusBarData(): StatusBarData {
    return {
      model: this.config.model,
      cwd: this.config.cwd,
      usedTokens: this.usedTokens,
      totalBudget: this.config.tokenBudget,
    };
  }

  renderStatusLine(): void {
    process.stdout.write(`${renderStatusBar(this.getStatusBarData())}\n`);
  }

  private flushStream(): void {
    if (this.streaming.isActive) {
      this.streaming.done();
    }
  }
}

// ─── Helpers ───



// ─── Factory ───

export function createRenderer(config: RendererConfig): TuiRenderer {
  return new TuiRenderer(config);
}
