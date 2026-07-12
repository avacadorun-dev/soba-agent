/**
 * Zero-dependency I18n engine for SOBA Agent.
 *
 * Features:
 * - Flat JSON locale files with {var} interpolation
 * - Fallback chain: requested locale → en → key itself
 * - Runtime locale switching
 * - Compile-time key safety via TranslationKey
 */

import { BUILTIN_TRANSLATIONS, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locale-catalog";
import type { Locale, TranslationKey } from "./types";

/** Translations dictionary: flat key → localized string. */
export type Translations = Record<string, string>;
export type TranslationLoader = (locale: Locale) => Translations;

export interface LocaleEnvironment {
  SOBA_LANG?: string;
  LC_ALL?: string;
  LC_MESSAGES?: string;
  LANG?: string;
}

export interface I18nOptions {
  loadTranslations?: TranslationLoader;
  fallbackToBuiltin?: boolean;
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
export function detectLocale(env: LocaleEnvironment = {}): Locale {
  const sobaLang = env.SOBA_LANG;
  if (sobaLang && isLocale(sobaLang)) return sobaLang;

  // Parse LANG / LC_ALL / LC_MESSAGES (e.g., "ru_RU.UTF-8" → "ru")
  const sysLocale = env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "";
  const langPart = sysLocale.split("_")[0]?.split(".")[0]?.toLowerCase();
  if (langPart && isLocale(langPart)) return langPart;

  return DEFAULT_LOCALE;
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
 *   i18n.t("cli.help.title");
 *   i18n.t("tool.write.written", { path: "x.ts" });
 *   i18n.setLocale("en");                            // switch to English
 */
export class I18n {
  private locale: Locale;
  private cache: Map<Locale, Translations> = new Map();
  private readonly loadTranslations: TranslationLoader;
  private readonly fallbackToBuiltin: boolean;

  constructor(locale: Locale, options: I18nOptions = {}) {
    this.loadTranslations = options.loadTranslations ?? loadBuiltinTranslations;
    this.fallbackToBuiltin = options.fallbackToBuiltin ?? options.loadTranslations === undefined;
    this.locale = locale;
    // Pre-load en (fallback) and current locale
    this.loadLocale(DEFAULT_LOCALE);
    if (locale !== DEFAULT_LOCALE) {
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
    const enTranslations = this.cache.get(DEFAULT_LOCALE);
    if (enTranslations) {
      const value = enTranslations[key];
      if (value !== undefined) {
        return interpolate(value, vars);
      }
    }

    // Ultimate fallback: return the key itself
    return key;
  }

  /** Load a locale and cache it. */
  private loadLocale(locale: Locale): void {
    const loadedTranslations = this.loadTranslations(locale);
    const translations =
      Object.keys(loadedTranslations).length > 0 || !this.fallbackToBuiltin
        ? loadedTranslations
        : BUILTIN_TRANSLATIONS[locale];
    this.cache.set(locale, translations);
  }

  /** Reload all cached locales from disk (useful for development). */
  reload(): void {
    this.cache.clear();
    this.loadLocale(DEFAULT_LOCALE);
    if (this.locale !== DEFAULT_LOCALE) {
      this.loadLocale(this.locale);
    }
  }
}

/** Reset the I18n singleton (no-op; kept for test compatibility). */
export function resetI18n(): void {
  // Singleton factory was removed — no state to reset.
}

function loadBuiltinTranslations(locale: Locale): Translations {
  return BUILTIN_TRANSLATIONS[locale];
}
