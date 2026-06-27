/**
 * Fixed-width agent status line for the full-screen TUI.
 *
 * The animated area always occupies the same number of terminal columns so
 * animation frames and status changes never move the keyboard hints.
 */

export const AGENT_STATUS_SLOT_WIDTH = 30;
export const AGENT_STATUS_HINTS = "Shift+drag Select  Ctrl+Y Copy  Ctrl+C Quit";

export const SYNTHWAVE_NOODLE_FRAMES = [
  "╲≋≋≋╱  ",
  " ╲≋≋≋╱ ",
  "  ╲≋≋≋╱",
  "╱  ╲≋≋≋",
  "≋╱  ╲≋≋",
  "≋≋╱  ╲≋",
  "≋≋≋╱  ╲",
  " ╲≋≋≋╱ ",
] as const;

const SYNTHWAVE_PULSE_FRAMES = ["·  ", "∙  ", "●  ", "∙  ", " · ", "  ·", " · ", "∙  "] as const;
const NOODLE_COLORS = ["magenta", "magenta", "cyan", "cyan"] as const;

function clipToWidth(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text;
  return `${chars.slice(0, Math.max(0, width - 1)).join("")}…`;
}

function color(text: string, colorName: string): string {
  return `{${colorName}-fg}${text}{/${colorName}-fg}`;
}

function colorizeNoodle(frame: string, frameIndex: number): string {
  return [...frame]
    .map((char, charIndex) => {
      if (char === " ") return char;
      const colorName = NOODLE_COLORS[(frameIndex + charIndex) % NOODLE_COLORS.length];
      return color(char, colorName);
    })
    .join("");
}

function fillStatusSlot(styledText: string, plainText: string): string {
  return `${styledText}${" ".repeat(Math.max(0, AGENT_STATUS_SLOT_WIDTH - [...plainText].length))}`;
}

/** Render a static status while preserving the fixed status slot width. */
export function renderAgentStatus(status: string, isIdle: boolean): string {
  const plainText = clipToWidth(`${isIdle ? "∿" : "∼"} ${status}`, AGENT_STATUS_SLOT_WIDTH);
  const icon = color(plainText[0] ?? "", isIdle ? "green" : "yellow");
  const styledText = `${icon}${plainText.slice(1)}`;
  return `${fillStatusSlot(styledText, plainText)}${AGENT_STATUS_HINTS}`;
}

/** Render one synthwave noodle animation frame inside the same fixed status slot. */
export function renderThinkingStatus(frameIndex: number): string {
  const normalizedIndex = Math.abs(frameIndex) % SYNTHWAVE_NOODLE_FRAMES.length;
  const noodle = SYNTHWAVE_NOODLE_FRAMES[normalizedIndex];
  const pulse = SYNTHWAVE_PULSE_FRAMES[normalizedIndex % SYNTHWAVE_PULSE_FRAMES.length];
  const plainText = `${noodle} thinking ${pulse}`;
  const labelColor = normalizedIndex % 4 < 2 ? "magenta" : "cyan";
  const styledText = `${colorizeNoodle(noodle, normalizedIndex)} ${color("thinking", labelColor)} ${color(pulse, labelColor)}`;
  return `${fillStatusSlot(styledText, plainText)}${AGENT_STATUS_HINTS}`;
}
