import { describe, expect, test } from "bun:test";
import { maskSensitiveFields } from "../src/application/config/config-loader";
import { DEFAULT_CONFIG, type SobaConfig } from "../src/application/config/types";

describe("maskSensitiveFields", () => {
  test("маскирует apiKey показывая только первые 4 и последние 4 символа", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      apiKey: "fake-openrouter-key-0000000000000000000000000000000000006425",
    };

    const masked = maskSensitiveFields(config);

    // Первые 4 + звёздочки + последние 4
    expect(masked.apiKey.startsWith("fake")).toBe(true);
    expect(masked.apiKey.endsWith("6425")).toBe(true);
    expect(masked.apiKey.length).toBe(config.apiKey.length);
    expect(masked.apiKey).not.toContain("000000000000000000000000000000000000");
  });

  test("маскирует короткий apiKey как ****", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      apiKey: "fake",
    };

    const masked = maskSensitiveFields(config);

    expect(masked.apiKey).toBe("****");
  });

  test("оставляет пустой apiKey пустым", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      apiKey: "",
    };

    const masked = maskSensitiveFields(config);

    expect(masked.apiKey).toBe("");
  });

  test("не изменяет остальные поля конфига", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      apiKey: "fake-test-key-12345678",
      baseUrl: "https://api.example.com",
      model: "gpt-4",
      contextWindow: 128000,
    };

    const masked = maskSensitiveFields(config);

    expect(masked.baseUrl).toBe("https://api.example.com");
    expect(masked.model).toBe("gpt-4");
    expect(masked.contextWindow).toBe(128000);
    expect(masked.apiKey).not.toBe("fake-test-key-12345678");
  });

  test("возвращает копию, не изменяя оригинал", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      apiKey: "fake-test-key-12345678",
    };

    const masked = maskSensitiveFields(config);

    expect(config.apiKey).toBe("fake-test-key-12345678");
    expect(masked.apiKey).not.toBe("fake-test-key-12345678");
  });
});
