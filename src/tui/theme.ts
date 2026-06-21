/**
 * Theme system for SOBA TUI.
 *
 * Provides semantic color tokens with dark/light variants.
 * Tokens are high-level (accent, text, error, border) rather than
 * low-level colors, making them easy to configure.
 */

import { bgTrueColor, fgTrueColor, isColorDisabled, setColorDisabled } from "./colors";

// ─── Theme Types ───

export type ThemeMode = "dark" | "light" | "forest";

export interface Theme {
  name: string;
  mode: ThemeMode;
  tokens: ThemeTokens;
}

export interface ThemeTokens {
  accent: string;
  text: string;
  muted: string;
  dim: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  userBg: string;
  agentBg: string;
  toolBg: string;
  toolPending: string;
  diffAdded: string;
  diffRemoved: string;
  border: string;
  statusBarBg: string;
  statusBarFg: string;
  thinkingBg: string;
  thinkingFg: string;
  // New tokens for the redesigned TUI
  panelBg: string;
  sidebarBg: string;
  headerBg: string;
  sectionTitle: string;
  thinkingTitle: string;
  toolsTitle: string;
  summaryTitle: string;
  inputBg: string;
  inputBorder: string;
  keyHint: string;
  activeDot: string;
  idleDot: string;
}

// ─── Predefined Themes ───

const FOREST_THEME_TOKENS = {
  name: "forest",
  mode: "forest" as ThemeMode,
  accent: "#6AAC7D", // Living moss green
  text: "#C2CBB8", // Soft sage — warm, not harsh white
  muted: "#6C7B66", // Earthy muted — dried moss
  dim: "#41503E", // Deep forest shadow
  success: "#5A9E60", // Natural green — not neon
  error: "#C5615A", // Warm muted red — forest berries
  warning: "#C3A14E", // Warm amber — autumn leaf
  info: "#6E9EB8", // Soft sky blue through canopy
  userBg: "#121A14", // User message — mossy ground
  agentBg: "#0D130F", // Deep forest floor
  toolBg: "#121A14",
  toolPending: "#1A261D",
  diffAdded: "#5A9E60",
  diffRemoved: "#C5615A",
  border: "#1A261D", // Nearly invisible — tree shadows
  statusBarBg: "#0D130F",
  statusBarFg: "#6C7B66",
  thinkingBg: "#121A14",
  thinkingFg: "#8BA877", // Soft sage for thoughts
  // New tokens
  panelBg: "#121A14",
  sidebarBg: "#0D130F",
  headerBg: "#0D130F",
  sectionTitle: "#6AAC7D",
  thinkingTitle: "#8BA877",
  toolsTitle: "#C3A14E",
  summaryTitle: "#6AAC7D",
  inputBg: "#0D130F",
  inputBorder: "#1A261D",
  keyHint: "#4A5A45",
  activeDot: "#6AAC7D",
  idleDot: "#5A9E60",
};

export const DARK_THEME_TOKENS: ThemeTokens = {
  accent: "#7ee787", // Green — SOBA AGENT branding
  text: "#c9d1d9", // Primary text (GitHub dark-like)
  muted: "#8b949e", // Secondary text
  dim: "#6e7681", // Tertiary text / placeholders
  success: "#3fb950", // Success states
  error: "#f85149", // Error states
  warning: "#e3b341", // Warning / TOOLS title
  info: "#58a6ff", // Info / section titles
  userBg: "#161b22", // User message background
  agentBg: "#0d1117", // Main background (near black)
  toolBg: "#161b22", // Tool block background
  toolPending: "#30363d",
  diffAdded: "#3fb950",
  diffRemoved: "#f85149",
  border: "#30363d", // Borders and dividers
  statusBarBg: "#0d1117",
  statusBarFg: "#8b949e",
  thinkingBg: "#161b22",
  thinkingFg: "#a371f7", // Purple for thinking text
  // New tokens
  panelBg: "#161b22", // Panel backgrounds
  sidebarBg: "#0d1117", // Sidebar background
  headerBg: "#0d1117", // Header background
  sectionTitle: "#58a6ff", // PROJECT, AGENT, CONTEXT, etc.
  thinkingTitle: "#a371f7", // THINKING label
  toolsTitle: "#e3b341", // TOOLS label
  summaryTitle: "#7ee787", // SUMMARY label
  inputBg: "#0d1117", // Input background
  inputBorder: "#30363d", // Input border
  keyHint: "#6e7681", // Keyboard hint text
  activeDot: "#3fb950", // Green dot for active/idle
  idleDot: "#3fb950", // Green dot for idle status
};

export const LIGHT_THEME_TOKENS: ThemeTokens = {
  accent: "#2e6edf",
  text: "#1a1a2e",
  muted: "#6b7280",
  dim: "#9ca3af",
  success: "#16a34a",
  error: "#dc2626",
  warning: "#d97706",
  info: "#0284c7",
  userBg: "#f3f4f6",
  agentBg: "#ffffff",
  toolBg: "#f9fafb",
  toolPending: "#e5e7eb",
  diffAdded: "#16a34a",
  diffRemoved: "#dc2626",
  border: "#d1d5db",
  statusBarBg: "#1f2937",
  statusBarFg: "#f9fafb",
  thinkingBg: "#e5e7eb",
  thinkingFg: "#2e6edf",
  // New tokens
  panelBg: "#f6f8fa",
  sidebarBg: "#ffffff",
  headerBg: "#ffffff",
  sectionTitle: "#0969da",
  thinkingTitle: "#8250df",
  toolsTitle: "#9a6700",
  summaryTitle: "#1a7f37",
  inputBg: "#f6f8fa",
  inputBorder: "#d1d5db",
  keyHint: "#8c959f",
  activeDot: "#1a7f37",
  idleDot: "#1a7f37",
};

// ─── Theme Manager ───

let currentTheme = DARK_THEME_TOKENS;

export function initTheme(mode: ThemeMode = "dark"): void {
  if (mode === "light") {
    currentTheme = LIGHT_THEME_TOKENS;
  } else if (mode === "forest") {
    currentTheme = FOREST_THEME_TOKENS;
  } else {
    currentTheme = DARK_THEME_TOKENS;
  }
}

export function getTheme(): ThemeTokens {
  return currentTheme;
}

export function setTheme(mode: ThemeMode): void {
  currentTheme = mode === "light" ? LIGHT_THEME_TOKENS : mode === "forest" ? FOREST_THEME_TOKENS : DARK_THEME_TOKENS;
}

// ─── Style Helpers ───

/** Apply foreground color from a theme token */
export function tFg(token: keyof ThemeTokens, text: string): string {
  if (isColorDisabled()) return text;
  const color = currentTheme[token];
  return fgTrueColor(color, text);
}

/** Apply background color from a theme token */
export function tBg(token: keyof ThemeTokens, text: string): string {
  if (isColorDisabled()) return text;
  const color = currentTheme[token];
  return bgTrueColor(color, text);
}
export { isColorDisabled, setColorDisabled };
