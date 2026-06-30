import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectLocale, I18n, isLocale, resetI18n, type TranslationLoader } from "../src/shared/i18n/i18n";
import { type Locale, SUPPORTED_LOCALES } from "../src/shared/i18n/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LOCALES_DIR = join(import.meta.dir, "..", "locales");

function loadJsonKeys(path: string): string[] {
  const raw = readFileSync(path, "utf-8");
  const obj = JSON.parse(raw);
  return Object.keys(obj).sort();
}

function loadJson(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
}

function createFilesystemTranslationLoader(localesDir: string): TranslationLoader {
  return (locale) => {
    try {
      const raw = readFileSync(join(localesDir, `${locale}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      /* fall through */
    }
    return {};
  };
}

function createFilesystemI18n(locale: Locale, localesDir: string): I18n {
  return new I18n(locale, {
    loadTranslations: createFilesystemTranslationLoader(localesDir),
    fallbackToBuiltin: false,
  });
}

function currentLocaleEnvironment() {
  return {
    SOBA_LANG: process.env.SOBA_LANG,
    LC_ALL: process.env.LC_ALL,
    LC_MESSAGES: process.env.LC_MESSAGES,
    LANG: process.env.LANG,
  };
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

/** Create a temp directory for custom locale files. Returns the path. */
function createTempLocalesDir(label: string): string {
  const dir = join(import.meta.dir, "..", `locales-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Clean up temp locale dirs from previous runs. */
function cleanupTempDirs(): void {
  try {
    const parent = join(import.meta.dir, "..");
    for (const entry of readdirSync(parent)) {
      if (entry.startsWith("locales-") && entry.includes(`-${"temp"}-`)) {
        try {
          rmSync(join(parent, entry), { recursive: true });
        } catch {
          /* ok */
        }
      }
    }
  } catch {
    /* ok */
  }
}

// Run once before all tests
cleanupTempDirs();

// Reset singleton between tests
afterEach(() => {
  resetI18n();
});

// ─── UC-9: Locale detection ──────────────────────────────────────────────────

describe("detectLocale()", () => {
  test("UC-9: SOBA_LANG env var has highest priority", () => {
    expect(detectLocale({ SOBA_LANG: "ru" })).toBe("ru");
  });

  test("UC-9: LC_ALL parsed for language code", () => {
    expect(detectLocale({ LC_ALL: "ru_RU.UTF-8" })).toBe("ru");
  });

  test("UC-9: LC_MESSAGES parsed for language code", () => {
    expect(detectLocale({ LC_MESSAGES: "zh_CN.UTF-8" })).toBe("zh");
  });

  test("UC-9: LANG parsed for language code", () => {
    expect(detectLocale({ LANG: "en_US.UTF-8" })).toBe("en");
  });

  test("UC-9: fallback to en for unsupported locale", () => {
    expect(detectLocale({ LANG: "fr_FR.UTF-8" })).toBe("en");
  });

  test("UC-9: fallback to en when no env vars set", () => {
    expect(detectLocale()).toBe("en");
  });
});

// ─── isLocale() ──────────────────────────────────────────────────────────────

describe("isLocale()", () => {
  test("en is a valid locale", () => expect(isLocale("en")).toBe(true));
  test("ru is a valid locale", () => expect(isLocale("ru")).toBe(true));
  test("zh is a valid locale", () => expect(isLocale("zh")).toBe(true));
  test("fr is not a valid locale", () => expect(isLocale("fr")).toBe(false));
  test("empty string is not valid", () => expect(isLocale("")).toBe(false));
});

// ─── I18n class: basic translation ──────────────────────────────────────────

describe("I18n translation", () => {
  test("UC-9: переводы загружаются независимо от текущей рабочей директории", () => {
    const tempDir = createTempLocalesDir("cwd-independent");
    const modulePath = join(import.meta.dir, "..", "src", "shared", "i18n", "i18n.ts");
    const script = `import { I18n } from ${JSON.stringify(modulePath)}; console.log(new I18n("ru").t("cli.help.title"));`;
    const result = Bun.spawnSync(["bun", "-e", script], { cwd: tempDir });

    try {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("консольный AI-ассистент");
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("UC-9: простой ключ без переменных", () => {
    const i18n = new I18n("en");
    const result = i18n.t("repl.goodbye");
    expect(result).toBe("Goodbye!");
  });

  test("UC-9: ключ с одной переменной", () => {
    const i18n = new I18n("en");
    const result = i18n.t("tool.write.written", { path: "src/index.ts", size: 1024 });
    expect(result).toBe("File src/index.ts written (1024 bytes).");
  });

  test("UC-9: ключ с несколькими переменными", () => {
    const i18n = new I18n("en");
    const result = i18n.t("compact.complete", { before: 50000, after: 12000, id: "abc123" });
    expect(result).toBe("Context compacted: 50000 → 12000 tokens. Checkpoint: abc123");
  });

  test("UC-9: переменная отсутствует — оставляем {var} как есть", () => {
    const i18n = new I18n("en");
    const result = i18n.t("tool.write.written", { path: "x.ts" });
    expect(result).toBe("File x.ts written ({size} bytes).");
  });

  test("UC-9: нет переменных — возвращаем шаблон как есть", () => {
    const i18n = new I18n("en");
    const result = i18n.t("tool.write.written");
    expect(result).toBe("File {path} written ({size} bytes).");
  });

  test("UC-9: перевод на русском", () => {
    const i18n = new I18n("ru");
    expect(i18n.getLocale()).toBe("ru");
    const result = i18n.t("repl.goodbye");
    expect(result).toBe("До встречи!");
  });

  test("UC-9: перевод на китайском", () => {
    const i18n = new I18n("zh");
    expect(i18n.getLocale()).toBe("zh");
    const result = i18n.t("repl.goodbye");
    expect(result).toBe("再见！");
  });
});

// ─── I18n: fallback chain ───────────────────────────────────────────────────

describe("I18n fallback", () => {
  test("UC-9: ключ отсутствует в ru → fallback на en", () => {
    const tempDir = createTempLocalesDir("fallback");

    try {
      writeFileSync(
        join(tempDir, "en.json"),
        JSON.stringify({
          "test.key": "English value",
          "test.onlyEn": "Only in English",
        }),
      );
      writeFileSync(
        join(tempDir, "ru.json"),
        JSON.stringify({
          "test.key": "Русское значение",
        }),
      );

      const i18n = createFilesystemI18n("ru", tempDir);

      expect(i18n.t("test.key")).toBe("Русское значение");
      expect(i18n.t("test.onlyEn")).toBe("Only in English");
    } finally {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        /* ok */
      }
    }
  });

  test("UC-9: ключ отсутствует во всех языках → возвращаем сам ключ", () => {
    const i18n = new I18n("en");
    const result = i18n.t("this.key.does.not.exist.anywhere");
    expect(result).toBe("this.key.does.not.exist.anywhere");
  });

  test("UC-9: fallback ключ с интерполяцией через en", () => {
    const tempDir = createTempLocalesDir("fallback2");

    try {
      writeFileSync(
        join(tempDir, "en.json"),
        JSON.stringify({
          "test.interp": "Hello {name}!",
        }),
      );
      writeFileSync(join(tempDir, "ru.json"), JSON.stringify({}));

      const i18n = createFilesystemI18n("ru", tempDir);
      const result = i18n.t("test.interp", { name: "World" });
      expect(result).toBe("Hello World!");
    } finally {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        /* ok */
      }
    }
  });
});

// ─── I18n: locale switching ─────────────────────────────────────────────────

describe("I18n locale switching", () => {
  test("UC-9: переключение языка на лету", () => {
    const i18n = new I18n("en");

    expect(i18n.t("repl.goodbye")).toBe("Goodbye!");

    i18n.setLocale("ru");
    expect(i18n.getLocale()).toBe("ru");
    expect(i18n.t("repl.goodbye")).toBe("До встречи!");

    i18n.setLocale("zh");
    expect(i18n.getLocale()).toBe("zh");
    expect(i18n.t("repl.goodbye")).toBe("再见！");

    i18n.setLocale("en");
    expect(i18n.t("repl.goodbye")).toBe("Goodbye!");
  });

  test("UC-9: setLocale на тот же язык — no-op", () => {
    const i18n = new I18n("en");
    expect(i18n.getLocale()).toBe("en");
    i18n.setLocale("en");
    expect(i18n.getLocale()).toBe("en");
  });
});

// ─── I18n: error handling ───────────────────────────────────────────────────

describe("I18n error handling", () => {
  test("повреждённый JSON в ru — fallback на en работает", () => {
    const tempDir = createTempLocalesDir("broken");

    try {
      writeFileSync(join(tempDir, "en.json"), JSON.stringify({ "test.key": "English" }));
      writeFileSync(join(tempDir, "ru.json"), "not valid {{{");

      const i18n = createFilesystemI18n("ru", tempDir);
      expect(i18n.t("test.key")).toBe("English");
    } finally {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        /* ok */
      }
    }
  });

  test("JSON-файл — массив вместо объекта → fallback на en", () => {
    const tempDir = createTempLocalesDir("array");

    try {
      writeFileSync(join(tempDir, "en.json"), JSON.stringify({ "test.key": "English" }));
      writeFileSync(join(tempDir, "ru.json"), JSON.stringify(["not", "an", "object"]));

      const i18n = createFilesystemI18n("ru", tempDir);
      expect(i18n.t("test.key")).toBe("English");
    } finally {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        /* ok */
      }
    }
  });

  test("несуществующая директория locale → fallback на ключ", () => {
    const i18n = createFilesystemI18n("ru", "/this/path/does/not/exist");
    expect(i18n.t("repl.goodbye")).toBe("repl.goodbye");
  });
});

// ─── Consistency checks ─────────────────────────────────────────────────────

describe("Locale file consistency", () => {
  test("UC-9: все ключи из en.json присутствуют в ru.json", () => {
    const enPath = join(LOCALES_DIR, "en.json");
    const ruPath = join(LOCALES_DIR, "ru.json");

    expect(existsSync(enPath)).toBe(true);
    expect(existsSync(ruPath)).toBe(true);

    const enKeys = loadJsonKeys(enPath);
    const ruKeys = loadJsonKeys(ruPath);

    const missingInRu = enKeys.filter((k) => !ruKeys.includes(k));
    if (missingInRu.length > 0) {
      console.log(`Missing in ru.json: ${missingInRu.join(", ")}`);
    }
    expect(missingInRu).toEqual([]);

    const extraInRu = ruKeys.filter((k) => !enKeys.includes(k));
    if (extraInRu.length > 0) {
      console.log(`Extra in ru.json (not in en.json): ${extraInRu.join(", ")}`);
    }
    expect(extraInRu).toEqual([]);
  });

  test("UC-9: все ключи из en.json присутствуют в zh.json", () => {
    const enPath = join(LOCALES_DIR, "en.json");
    const zhPath = join(LOCALES_DIR, "zh.json");

    expect(existsSync(enPath)).toBe(true);
    expect(existsSync(zhPath)).toBe(true);

    const enKeys = loadJsonKeys(enPath);
    const zhKeys = loadJsonKeys(zhPath);

    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
    if (missingInZh.length > 0) {
      console.log(`Missing in zh.json: ${missingInZh.join(", ")}`);
    }
    expect(missingInZh).toEqual([]);

    const extraInZh = zhKeys.filter((k) => !enKeys.includes(k));
    if (extraInZh.length > 0) {
      console.log(`Extra in zh.json (not in en.json): ${extraInZh.join(", ")}`);
    }
    expect(extraInZh).toEqual([]);
  });

  test("количество ключей в en.json достаточно", () => {
    const enPath = join(LOCALES_DIR, "en.json");
    const enKeys = loadJsonKeys(enPath);
    console.log(`Total keys in en.json: ${enKeys.length}`);
    expect(enKeys.length).toBeGreaterThanOrEqual(50);
    expect(enKeys.length).toBeLessThanOrEqual(450);
  });

  test("UC-9: placeholders совпадают во всех переводах", () => {
    const en = loadJson(join(LOCALES_DIR, "en.json"));
    for (const locale of ["ru", "zh"]) {
      const translated = loadJson(join(LOCALES_DIR, `${locale}.json`));
      for (const [key, value] of Object.entries(en)) {
        expect(placeholders(translated[key] ?? "")).toEqual(placeholders(value));
      }
    }
  });

  test("каждый JSON-файл — валидный JSON объект", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const path = join(LOCALES_DIR, `${locale}.json`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
    }
  });
});

// ─── I18n: edge cases ───────────────────────────────────────────────────────

describe("I18n edge cases", () => {
  test("числовые значения в интерполяции", () => {
    const i18n = new I18n("en");
    const result = i18n.t("budget.usage", { used: 42500, total: 100000, percent: 42.5 });
    expect(result).toContain("42500");
    expect(result).toContain("100000");
    expect(result).toContain("42.5");
  });

  test("спецсимволы в значениях переменных", () => {
    const i18n = new I18n("en");
    const result = i18n.t("general.error", { message: 'file "test.ts" not found' });
    expect(result).toContain('file "test.ts" not found');
  });

  test("переменная содержит фигурные скобки — не ломает интерполяцию", () => {
    const i18n = new I18n("en");
    const result = i18n.t("general.error", { message: "unexpected {" });
    expect(result).toContain("unexpected {");
  });

  test("reload перечитывает файлы с диска", () => {
    const tempDir = createTempLocalesDir("reload");

    try {
      writeFileSync(join(tempDir, "en.json"), JSON.stringify({ "test.reload": "version 1" }));
      writeFileSync(join(tempDir, "ru.json"), JSON.stringify({ "test.reload": "версия 1" }));

      const i18n = createFilesystemI18n("ru", tempDir);
      expect(i18n.t("test.reload")).toBe("версия 1");

      writeFileSync(join(tempDir, "ru.json"), JSON.stringify({ "test.reload": "версия 2" }));
      expect(i18n.t("test.reload")).toBe("версия 1");

      i18n.reload();
      expect(i18n.t("test.reload")).toBe("версия 2");
    } finally {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        /* ok */
      }
    }
  });
});

// ─── Integration: detectLocale with real env ────────────────────────────────

describe("detectLocale integration", () => {
  test("SOBA_LANG=ru → detectLocale returns ru", () => {
    process.env.SOBA_LANG = "ru";
    expect(detectLocale(currentLocaleEnvironment())).toBe("ru");
    delete process.env.SOBA_LANG;
  });

  test("SOBA_LANG=invalid → falls through to LANG", () => {
    process.env.SOBA_LANG = "de";
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    process.env.LANG = "zh_CN.UTF-8";
    expect(detectLocale(currentLocaleEnvironment())).toBe("zh");
    delete process.env.SOBA_LANG;
    delete process.env.LANG;
  });

  test("SOBA_LANG with mixed case falls through to system", () => {
    process.env.SOBA_LANG = "RU";
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    delete process.env.LANG;
    // isLocale requires exact match, "RU" !== "ru"
    expect(detectLocale(currentLocaleEnvironment())).toBe("en");
    delete process.env.SOBA_LANG;
  });
});
