const MAX_PREVIEW_LINES = 80;
const HEAD_LINES = 40;
const TAIL_LINES = 40;
const MAX_LINE_CHARS = 240;

const ANSI_ESCAPE_RE = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*(?:\x1b\\)?|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

export interface ToolOutputPreview {
  lines: string[];
  omittedLines: number;
  hadUnsafeControlChars: boolean;
  totalLines: number;
}

export function sanitizeToolOutputForTui(text: string): {
  text: string;
  hadUnsafeControlChars: boolean;
} {
  const withoutAnsi = text.replace(ANSI_ESCAPE_RE, "");
  const hadUnsafeControlChars = CONTROL_CHARS_RE.test(withoutAnsi);
  CONTROL_CHARS_RE.lastIndex = 0;

  return {
    text: withoutAnsi.replace(CONTROL_CHARS_RE, "�"),
    hadUnsafeControlChars,
  };
}

export function buildToolOutputPreview(text: string): ToolOutputPreview {
  const sanitized = sanitizeToolOutputForTui(text);
  const rawLines = sanitized.text.split("\n");
  const totalLines = rawLines.length;
  const omittedLines = Math.max(0, totalLines - HEAD_LINES - TAIL_LINES);
  const visibleLines =
    totalLines > MAX_PREVIEW_LINES
      ? [
          ...rawLines.slice(0, HEAD_LINES),
          `... ${omittedLines} lines omitted from TUI preview ...`,
          ...rawLines.slice(-TAIL_LINES),
        ]
      : rawLines;

  return {
    lines: visibleLines.map(truncateLine),
    omittedLines,
    hadUnsafeControlChars: sanitized.hadUnsafeControlChars,
    totalLines,
  };
}

function truncateLine(line: string): string {
  const chars = [...line];
  if (chars.length <= MAX_LINE_CHARS) return line;
  return `${chars.slice(0, MAX_LINE_CHARS - 1).join("")}…`;
}
