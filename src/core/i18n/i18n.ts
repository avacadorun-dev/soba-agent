/**
 * Zero-dependency I18n engine for SOBA Agent.
 *
 * Features:
 * - Flat JSON locale files with {var} interpolation
 * - Fallback chain: requested locale → en → key itself
 * - Runtime locale switching
 * - Compile-time key safety via TranslationKey
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import enTranslations from "../../../locales/en.json";
import ruTranslations from "../../../locales/ru.json";
import zhTranslations from "../../../locales/zh.json";
import type { Locale, TranslationKey } from "./types";
import { SUPPORTED_LOCALES } from "./types";

/** Translations dictionary: flat key → localized string. */
type Translations = Record<string, string>;

const BUILTIN_TRANSLATIONS: Record<Locale, Translations> = {
  en: enTranslations,
  ru: ruTranslations,
  zh: zhTranslations,
};

/**
 * Resolve the path to locale files.
 * Priority: SOBA_LOCALES_DIR env → <package_root>/locales → <cwd>/locales
 */
function resolveLocalesDir(): string {
  if (process.env.SOBA_LOCALES_DIR) {
    return process.env.SOBA_LOCALES_DIR;
  }

  const candidates = [
    // Bundled CLI: <package_root>/dist/cli.js
    join(import.meta.dir, "..", "locales"),
    // Source execution: <package_root>/src/core/i18n/i18n.ts
    join(import.meta.dir, "..", "..", "..", "locales"),
    // Development fallbacks
    join(process.cwd(), "locales"),
    join(process.cwd(), "..", "locales"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "en.json"))) {
      return candidate;
    }
  }

  return candidates[0];
}

/** Load translations from a JSON file. Returns empty object on failure. */
function loadTranslations(path: string): Translations {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Translations;
    }
    return {};
  } catch {
    return {};
  }
}

/** Interpolate {var} placeholders in a template string. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * Detect user's preferred locale from environment.
 *
 * Priority:
 * 1. SOBA_LANG environment variable
 * 2. LANG / LC_ALL / LC_MESSAGES system locale
 * 3. Fallback to "en"
 */
export function detectLocale(): Locale {
  const sobaLang = process.env.SOBA_LANG;
  if (sobaLang && isLocale(sobaLang)) return sobaLang;

  // Parse LANG / LC_ALL / LC_MESSAGES (e.g., "ru_RU.UTF-8" → "ru")
  const sysLocale = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? "";
  const langPart = sysLocale.split("_")[0]?.split(".")[0]?.toLowerCase();
  if (langPart && isLocale(langPart)) return langPart;

  return "en";
}

/** Type guard: check if a string is a valid Locale. */
export function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * Main I18n class.
 *
 * Usage:
 *   const i18n = new I18n("ru");
 *   i18n.t("cli.help.title");                       // "SOBA Agent — консольный..."
 *   i18n.t("tool.write.written", { path: "x.ts" });  // "Файл x.ts записан"
 *   i18n.setLocale("en");                            // switch to English
 */
export class I18n {
  private locale: Locale;
  private cache: Map<Locale, Translations> = new Map();
  private readonly localesDir: string;
  private readonly useBuiltinTranslations: boolean;

  constructor(locale: Locale, localesDir?: string) {
    this.localesDir = localesDir ?? resolveLocalesDir();
    this.useBuiltinTranslations = localesDir === undefined;
    this.locale = locale;
    // Pre-load en (fallback) and current locale
    this.loadLocale("en");
    if (locale !== "en") {
      this.loadLocale(locale);
    }
  }

  /** Get the current locale. */
  getLocale(): Locale {
    return this.locale;
  }

  /** Switch to a new locale at runtime. */
  setLocale(locale: Locale): void {
    if (locale !== this.locale) {
      this.locale = locale;
      if (!this.cache.has(locale)) {
        this.loadLocale(locale);
      }
    }
  }

  /**
   * Translate a key.
   *
   * Fallback chain:
   * 1. Current locale translation
   * 2. English translation (always loaded)
   * 3. The key itself (never throws)
   *
   * @param key - Translation key (dot-separated, flat)
   * @param vars - Optional {var} interpolation values
   */
  t(key: TranslationKey | string, vars?: Record<string, string | number>): string {
    // Try current locale
    const currentTranslations = this.cache.get(this.locale);
    if (currentTranslations) {
      const value = currentTranslations[key];
      if (value !== undefined) {
        return interpolate(value, vars);
      }
    }

    // Fallback to English
    const enTranslations = this.cache.get("en");
    if (enTranslations) {
      const value = enTranslations[key];
      if (value !== undefined) {
        return interpolate(value, vars);
      }
    }

    // Ultimate fallback: return the key itself
    return key;
  }

  /** Load a locale from disk and cache it. */
  private loadLocale(locale: Locale): void {
    const path = join(this.localesDir, `${locale}.json`);
    const diskTranslations = loadTranslations(path);
    const translations =
      Object.keys(diskTranslations).length > 0 || !this.useBuiltinTranslations
        ? diskTranslations
        : BUILTIN_TRANSLATIONS[locale];
    this.cache.set(locale, translations);
  }

  /** Reload all cached locales from disk (useful for development). */
  reload(): void {
    this.cache.clear();
    this.loadLocale("en");
    if (this.locale !== "en") {
      this.loadLocale(this.locale);
    }
  }
}

/** Reset the I18n singleton (no-op; kept for test compatibility). */
export function resetI18n(): void {
  // Singleton factory was removed — no state to reset.
}
