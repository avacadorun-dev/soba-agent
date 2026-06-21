/**
 * TUI (Terminal User Interface) module.
 *
 * Public API for the SOBA Agent TUI.
 * Zero pi-tui dependencies — pure ANSI rendering for streaming + non-streaming output.
 */

export { bold, dim, italic, visibleWidth, wrapText } from "./colors";
export type { RendererConfig, RenderMode } from "./renderer";
export { createRenderer, TuiRenderer } from "./renderer";
export { Spinner } from "./spinner";
export type { StatusBarData } from "./status-bar";
export { renderStatusBar } from "./status-bar";
export { StreamingMarkdown } from "./streaming-markdown";
export type { Theme, ThemeMode, ThemeTokens } from "./theme";
export { getTheme, initTheme, setTheme, tBg, tFg } from "./theme";
