import type { I18n } from "../../../../core/i18n/i18n";

function formatArg(value: unknown): string {
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  return JSON.stringify(value) ?? String(value);
}

/** Capitalize the first letter of a tool name for display. */
function capitalizeTool(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Truncate a string to maxLen, appending "…" if truncated. */
function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Generate a concise one-liner summary for a tool call.
 * Examples: "Read package.json", "Write src/cli.ts", "Bash bun test"
 */
export function formatToolSummary(toolName: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : undefined;

  switch (toolName) {
    case "read": {
      if (!path) return "Read";
      const range = [args.offset ? `:${String(args.offset)}` : "", args.limit ? `+${String(args.limit)}` : ""]
        .filter(Boolean)
        .join("");
      return `Read ${path}${range}`;
    }
    case "write":
      return path ? `Write ${path}` : "Write";
    case "edit": {
      if (!path) return "Edit";
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const count = edits.length || 1;
      return `Edit ${path} (${count} ${count === 1 ? "change" : "changes"})`;
    }
    case "bash": {
      const command = typeof args.command === "string" ? args.command : "";
      return command ? `Bash ${truncate(command, 80)}` : "Bash";
    }
    case "ls":
      return path ? `Ls ${path}` : "Ls";
    case "checkpoint": {
      const kind = typeof args.kind === "string" ? args.kind : "milestone";
      const reason = typeof args.reason === "string" ? truncate(args.reason, 60) : "";
      const completed = Array.isArray(args.completed) ? args.completed.length : 0;
      const pending = Array.isArray(args.pending) ? args.pending.length : 0;
      const parts = [kind];
      if (reason) parts.push(reason);
      if (completed > 0 || pending > 0) parts.push(`[${completed}✓ ${pending}⏳]`);
      return `Checkpoint ${parts.join(" · ")}`;
    }
    case "activate_skill": {
      const name = typeof args.name === "string" ? args.name : "";
      return name ? `Activate skill: ${name}` : "Activate skill";
    }
    default:
      return capitalizeTool(toolName);
  }
}

export function formatToolArgs(toolName: string, args: Record<string, unknown>): string[] {
  const path = typeof args.path === "string" ? args.path : undefined;
  if (toolName === "read" && path) {
    const range = [args.offset ? `offset=${String(args.offset)}` : "", args.limit ? `limit=${String(args.limit)}` : ""]
      .filter(Boolean)
      .join(", ");
    return [`path: ${path}${range ? `  ${range}` : ""}`];
  }
  if (toolName === "write" && path) {
    const content = typeof args.content === "string" ? args.content : "";
    return [`path: ${path}`, `content: ${content.split("\n").length} lines, ${content.length} chars`];
  }
  if (toolName === "edit" && path) {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    return [`path: ${path}`, `edits: ${edits.length || 1}`];
  }
  if (toolName === "bash") {
    return [`command: ${typeof args.command === "string" ? args.command : JSON.stringify(args)}`];
  }
  return Object.entries(args).map(([key, value]) => `${key}: ${formatArg(value)}`);
}

export function formatToolResult(result: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}, i18n?: I18n): string {
  return (
    result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") || (result.isError ? i18n?.t("tui.tool.noOutputError") ?? "Tool failed without output" : i18n?.t("tui.tool.done") ?? "Done")
  );
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/**
 * Shorten a filesystem path to fit within maxLength by truncating the middle.
 * Examples:
 *   projects/soba-agent → …/soba-agent
 *   internal-design-notes → docs/phase-2.5…/plan.md
 */
export function shortenPath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  const segments = path.split("/");
  if (segments.length <= 1) return path.length > maxLength ? `…${path.slice(-(maxLength - 1))}` : path;
  const last = segments[segments.length - 1];
  const prefix = segments.slice(0, -1).join("/");
  const minPrefix = 3;
  const available = maxLength - last.length - 1; // -1 for the / separator
  if (available <= minPrefix) return `…/${last}`;
  const half = Math.floor((available - 1) / 2); // -1 for the …
  const start = prefix.slice(0, half);
  const end = prefix.slice(-half);
  return `${start}…${end}/${last}`;
}
