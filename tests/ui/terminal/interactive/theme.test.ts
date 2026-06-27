import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, TUI_THEME_NAMES } from "../../../../src/core/config/types";
import { getMarkdownStyle, getTuiTheme, TUI_THEMES } from "../../../../src/ui/terminal/interactive/lib/theme";

describe("OpenTUI themes", () => {
  test("graphite — спокойная тема по умолчанию", () => {
    expect(DEFAULT_CONFIG.theme).toBe("graphite");
    expect(getTuiTheme("graphite").background).toBe("#0F1115");
    expect(getTuiTheme("graphite").primary).not.toBe(TUI_THEMES.synthwave.primary);
  });

  test("каждый пресет содержит цвета и markdown-стиль", () => {
    for (const name of TUI_THEME_NAMES) {
      const theme = getTuiTheme(name);
      for (const color of Object.values(theme)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(getMarkdownStyle(name)).toBe(getMarkdownStyle(name));
    }
  });
});
