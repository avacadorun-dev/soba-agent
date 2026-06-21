/**
 * Status bar — clean single-line status.
 *
 *   soba · gpt-4o · ~/project                🔵 4.2K / 128K
 *
 * Shown once at session start and after each turn in interactive mode.
 */

import { bold } from "./colors";
import { tBg, tFg } from "./theme";

// ─── Status Bar ───

export interface StatusBarData {
  model: string;
  cwd: string;
  usedTokens: number;
  totalBudget: number;
}

function formatTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}K`;
  return String(t);
}

/**
 * Render a compact status line.
 *
 *   soba · model · cwd                🔵 tokens / budget
 */
export function renderStatusBar(data: StatusBarData): string {
  const width = process.stdout.columns ?? 80;
  const divider = tFg("dim", "·");

  // Left: model + cwd
  const shortCwd = data.cwd.replace(process.env.HOME ?? "", "~");
  const leftText = `${bold("soba")} ${divider} ${data.model} ${divider} ${shortCwd}`;

  // Right: token usage
  let rightText: string;
  if (data.totalBudget > 0) {
    const pct = Math.round((data.usedTokens / data.totalBudget) * 100);
    const indicator = pct >= 90 ? "🔴" : pct >= 70 ? "🟡" : "🔵";
    rightText = `${indicator} ${formatTokens(data.usedTokens)} / ${formatTokens(data.totalBudget)}`;
  } else {
    rightText = `🔵 ${formatTokens(data.usedTokens)} tokens`;
  }

  // Calculate visible widths (strip ANSI for measurement)
  const visLen = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
  const leftLen = visLen(leftText);
  const rightLen = visLen(rightText);
  const padding = Math.max(1, width - leftLen - rightLen - 4);

  const fullLine = ` ${leftText}${" ".repeat(padding)}${rightText} `;
  return tBg("statusBarBg", tFg("statusBarFg", fullLine));
}
