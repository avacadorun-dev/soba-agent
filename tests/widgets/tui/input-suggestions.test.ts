import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { I18n } from "../../../src/core/i18n/i18n";
import {
  applyInputSuggestion,
  formatInputSuggestion,
  getInputSuggestions,
  getVisibleInputSuggestions,
  VISIBLE_INPUT_SUGGESTIONS,
} from "../../../src/widgets/tui/lib/input-suggestions";

describe("TUI input suggestions", () => {
  test("показывает и фильтрует slash-команды", () => {
    const suggestions = getInputSuggestions("/co", 3, process.cwd());

    expect(suggestions.map((suggestion) => suggestion.label)).toEqual(["/compact", "/config"]);
    expect(applyInputSuggestion("/co", suggestions[0])).toEqual({ value: "/compact ", cursor: 9 });
  });

  test("возвращает все slash-команды, чтобы список мог прокручиваться", () => {
    const suggestions = getInputSuggestions("/", 1, process.cwd());

    expect(suggestions.length).toBeGreaterThan(VISIBLE_INPUT_SUGGESTIONS);
    expect(suggestions.map((suggestion) => suggestion.label)).toContain("/exit");
  });

  test("считает видимое окно подсказок вокруг выбранного пункта", () => {
    const suggestions = getInputSuggestions("/", 1, process.cwd());
    const visible = getVisibleInputSuggestions(suggestions, VISIBLE_INPUT_SUGGESTIONS);

    expect(visible.startIndex).toBe(1);
    expect(visible.suggestions).toHaveLength(VISIBLE_INPUT_SUGGESTIONS);
    expect(visible.suggestions[VISIBLE_INPUT_SUGGESTIONS - 1]).toBe(suggestions[VISIBLE_INPUT_SUGGESTIONS]);
  });

  test("показывает файлы проекта после @ и подставляет выбранный путь", () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-suggestions-"));
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "cli.ts"), "");
    writeFileSync(join(cwd, "README.md"), "");

    const input = "проверь @cli";
    const suggestions = getInputSuggestions(input, input.length, cwd);

    expect(suggestions.map((suggestion) => suggestion.label)).toEqual(["@src/cli.ts"]);
    expect(applyInputSuggestion(input, suggestions[0])).toEqual({
      value: "проверь @src/cli.ts ",
      cursor: "проверь @src/cli.ts ".length,
    });
  });

  test("не показывает slash-команды внутри обычного запроса", () => {
    expect(getInputSuggestions("объясни /compact", 16, process.cwd())).toEqual([]);
  });

  test("не падает при некорректном значении события OpenTUI", () => {
    expect(getInputSuggestions({} as unknown as string, 0, process.cwd())).toEqual([]);
  });

  test("форматирует выбранную подсказку одной читаемой строкой", () => {
    const suggestion = getInputSuggestions("/co", 3, process.cwd(), new I18n("en"))[0];

    expect(formatInputSuggestion(suggestion, true)).toBe("› /compact  Compact conversation context");
    expect(formatInputSuggestion(suggestion, false)).toBe("  /compact  Compact conversation context");
  });

  test("локализует описания команд и файлов", () => {
    const i18n = new I18n("ru");
    expect(getInputSuggestions("/co", 3, process.cwd(), i18n)[0]?.description).toBe("Сжать контекст разговора");
  });
});
