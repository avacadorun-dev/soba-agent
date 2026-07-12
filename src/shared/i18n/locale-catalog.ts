import enTranslations from "../../../locales/en.json";
import ruTranslations from "../../../locales/ru.json";
import zhTranslations from "../../../locales/zh.json";

/**
 * Single registration point for built-in locales.
 *
 * Adding a locale requires one catalogue entry and its JSON file; runtime
 * validation, config loading, locale detection, and supported-locale lists
 * derive from these keys instead of repeating language-specific branches.
 */
export const BUILTIN_TRANSLATIONS = {
  en: enTranslations,
  ru: ruTranslations,
  zh: zhTranslations,
} as const satisfies Record<string, Record<string, string>>;

export type Locale = keyof typeof BUILTIN_TRANSLATIONS;

export const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED_LOCALES = Object.freeze(Object.keys(BUILTIN_TRANSLATIONS) as Locale[]);
