/**
 * Message block layout constants and helpers.
 *
 * Centralizes paddings, radii and border styles for the redesigned
 * message list so every block (user, assistant, reasoning, tool)
 * keeps the same shape, alignment and rhythm regardless of theme.
 */


/** Block shape tokens used by every message panel. */
export const BLOCK = {
  /** Horizontal padding inside a bordered message panel. */
  paddingX: 1,
  /** Vertical padding inside a bordered message panel. */
  paddingY: 0,
  /** Space between the panel border and the inner content row. */
  gap: 0,
  /** Vertical space between consecutive message blocks. */
  marginBottom: 1,
  /** Vertical space between a tool-start and its matching tool-result. */
  toolPairGap: 0,
  /** Left indent for lightweight (no-border) message rows. */
  indentX: 2,
  /** Border style applied to tool panels. */
  borderStyle: "heavy" as const,
} as const;

/** Per-tool icon and color tokens for the tool panel header. */
export const TOOL_META: Record<
  string,
  { icon: string; color: "primary" | "secondary" | "warning" | "success" | "muted" | "error" }
> = {
  read: { icon: "◈", color: "secondary" },
  write: { icon: "◉", color: "warning" },
  edit: { icon: "✎", color: "warning" },
  bash: { icon: "$", color: "primary" },
  ls: { icon: "▤", color: "secondary" },
  checkpoint: { icon: "◆", color: "success" },
  activate_skill: { icon: "⚡", color: "success" },
} as const;

/** Resolve icon/color for a tool, falling back to a generic arrow. */
export function getToolMeta(toolName: string) {
  return TOOL_META[toolName] ?? { icon: "→", color: "warning" as const };
}


