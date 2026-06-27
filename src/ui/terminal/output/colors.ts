/**
 * ANSI escape code helpers for the SOBA TUI.
 *
 * Zero-dependency — pure ANSI escape sequences.
 * Supports: SGR (bold/dim/italic), truecolor, text measurement, and environment detection.
 */

// ─── Types ───

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

// ─── Color conversion ───

/** Parse a hex color string to RGB. Supports #RGB and #RRGGBB. */
export function hexToRgb(hex: string): RgbColor {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = Number.parseInt(h, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

// ─── SGR (Select Graphic Rendition) ───

const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
};

/** Apply SGR bold — no-ops when colors are disabled */
export function bold(text: string): string {
  if (isColorDisabled()) return text;
  return `${SGR.bold}${text}${SGR.reset}`;
}

/** Apply SGR dim — no-ops when colors are disabled */
export function dim(text: string): string {
  if (isColorDisabled()) return text;
  return `${SGR.dim}${text}${SGR.reset}`;
}

/** Apply SGR italic — no-ops when colors are disabled */
export function italic(text: string): string {
  if (isColorDisabled()) return text;
  return `${SGR.italic}${text}${SGR.reset}`;
}

// ─── Foreground / Background colors ───

/** Truecolor foreground */
export function fgTrueColor(hex: string, text: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}${SGR.reset}`;
}

/** Truecolor background */
export function bgTrueColor(hex: string, text: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m${text}${SGR.reset}`;
}

// ─── Text measurement ───

/** Strip ANSI codes and return visible character width */
export function visibleWidth(text: string): number {
  // Strip ANSI escape sequences
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;.*?\x1b\\/g, "");
  // Count characters (approximate — doesn't handle wide CJK chars)
  return [...stripped].length;
}

/** Truncate text to a maximum visible width, adding "…" if truncated */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text;

  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;.*?\x1b\\/g, "");
  const chars = [...stripped];

  if (chars.length <= 3) return text;
  return `${chars.slice(0, maxWidth - 1).join("")}…`;
}

/** Pad text to a minimum visible width with spaces */
export function padToWidth(text: string, minWidth: number): string {
  const width = visibleWidth(text);
  if (width >= minWidth) return text;
  return text + " ".repeat(minWidth - width);
}

/**
 * Wrap text to a maximum width, breaking at word boundaries.
 * Preserves existing newlines and ANSI escape codes.
 * Each output line re-opens any active SGR styles from the previous line.
 */
export function wrapText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return text;

  const lines = text.split("\n");
  const result: string[] = [];

  // Pattern to extract ANSI SGR sequences: \x1b[...m
  const ansiRe = /\x1b\[[0-9;]*m/g;

  for (const line of lines) {
    if (line.length === 0) {
      result.push("");
      continue;
    }

    // Collect active SGR codes at start of line
    const activeCodes: string[] = [];
    let match: RegExpExecArray | null;
    ansiRe.lastIndex = 0;
    while ((match = ansiRe.exec(line)) !== null) {
      // Only collect codes before any visible content
      const visibleBefore = line.slice(0, match.index).replace(ansiRe, "");
      if (visibleBefore.length === 0) {
        activeCodes.push(match[0]);
      } else {
        break;
      }
    }
    const sgrPrefix = activeCodes.join("");

    // Split line into visible characters and track ANSI positions
    const segments = splitWithAnsi(line);
    const visibleChars = segments.filter((s) => !s.isAnsi);

    if (visibleChars.length <= maxWidth) {
      result.push(line);
      continue;
    }

    // Wrap at word boundaries when possible
    let pos = 0;
    while (pos < segments.length) {
      const remaining = segments.length - pos;
      if (remaining <= maxWidth) {
        result.push(reassembleSegments(segments.slice(pos)));
        break;
      }

      // Look for a word break within maxWidth
      let breakAt = pos + maxWidth;
      let foundBreak = false;
      for (let i = pos + maxWidth - 1; i > pos; i--) {
        const seg = segments[i];
        if (!seg.isAnsi && (seg.text === " " || seg.text === "\t")) {
          breakAt = i + 1; // break after the space
          foundBreak = true;
          break;
        }
      }

      if (!foundBreak) {
        // No word break found — hard break at maxWidth
        breakAt = pos + maxWidth;
      }

      // Trim trailing whitespace from the wrapped line
      while (breakAt > pos) {
        const last = segments[breakAt - 1];
        if (!last.isAnsi && (last.text === " " || last.text === "\t")) {
          breakAt--;
        } else {
          break;
        }
      }

      if (breakAt === pos) breakAt = pos + maxWidth; // safety

      result.push(reassembleSegments(segments.slice(pos, breakAt)));

      // Re-open SGR codes for continuation line
      if (sgrPrefix && breakAt < segments.length) {
        // Insert SGR prefix at start of next segment if there's visible content
        const nextVisible = segments.slice(breakAt).find((s) => !s.isAnsi);
        if (nextVisible) {
          segments.splice(breakAt, 0, { text: sgrPrefix, isAnsi: true });
        }
      }
      pos = breakAt;
    }
    // Add SGR reset after each wrapped line to prevent style bleeding
    // The SGR prefix at the start handles re-opening
  }

  return result.join("\n");
}

interface AnsiSegment {
  text: string;
  isAnsi: boolean;
}

function splitWithAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const re = /\x1b\[[0-9;]*m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      // Split the text before this ANSI code into individual chars
      for (const ch of text.slice(lastIndex, match.index)) {
        segments.push({ text: ch, isAnsi: false });
      }
    }
    segments.push({ text: match[0], isAnsi: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    for (const ch of text.slice(lastIndex)) {
      segments.push({ text: ch, isAnsi: false });
    }
  }
  return segments;
}

function reassembleSegments(segments: AnsiSegment[]): string {
  return segments.map((s) => s.text).join("");
}

// ─── Environment detection ───

/** Check if terminal supports truecolor (approximate) */
export function supportsTruecolor(): boolean {
  const term = process.env.TERM ?? "";
  const colorterm = process.env.COLORTERM ?? "";
  return colorterm === "truecolor" || colorterm === "24bit" || term.includes("256color");
}

/** Check if colors are disabled (NO_COLOR env var or --no-color flag) */
let colorDisabled: boolean | null = null;
export function isColorDisabled(): boolean {
  return colorDisabled ?? Boolean(process.env.NO_COLOR);
}
export function setColorDisabled(disabled: boolean): void {
  colorDisabled = disabled;
}

