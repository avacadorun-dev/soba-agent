import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, TUI_THEME_NAMES } from "../../../../src/application/config/types";
import { getMarkdownStyle, getTuiTheme, TUI_THEMES } from "../../../../src/ui/terminal/interactive/lib/theme";

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("OpenTUI themes", () => {
  test("graphite — спокойная тема по умолчанию", () => {
    expect(DEFAULT_CONFIG.theme).toBe("graphite");
    expect(getTuiTheme("graphite").background).toBe("#0E0F11");
    expect(getTuiTheme("graphite").primary).toBe("#70D6A0");
    expect(getTuiTheme("graphite").primary).not.toBe(TUI_THEMES.synthwave.primary);
  });

  test("clay остаётся единственной тёплой земляной темой", () => {
    expect([...TUI_THEME_NAMES]).toContain("clay");
    expect([...TUI_THEME_NAMES]).not.toContain("ember");
  });

  test("каждый пресет содержит цвета и markdown-стиль", () => {
    for (const name of TUI_THEME_NAMES) {
      const theme = getTuiTheme(name);
      for (const color of Object.values(theme)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(getMarkdownStyle(name)).toBe(getMarkdownStyle(name));
    }
  });

  test("рабочий текст и акценты сохраняют доступный контраст", () => {
    for (const name of TUI_THEME_NAMES) {
      const theme = getTuiTheme(name);
      expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, theme.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
