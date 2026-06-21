import { i18n } from "@/lib/i18n";

export const siteUrl = "https://soba-agent.dev";
export const githubUrl = "https://github.com/avacadorun-dev/soba-agent";
export const previewImageUrl = `${siteUrl}/soba-preview.png`;

type SupportedLang = (typeof i18n.languages)[number];

type LocalizedSeo = {
  title: string;
  description: string;
  locale: string;
};

const landingSeo: Record<SupportedLang, LocalizedSeo> = {
  en: {
    title: "SOBA Agent - CLI coding agent with memory, MCP, and cozy TUI",
    description:
      "SOBA Agent is a Bun-first CLI coding agent with project memory, long-lived sessions, MCP tools, and a calm terminal UI.",
    locale: "en_US",
  },
  ru: {
    title: "SOBA Agent - консольный агент для кода с памятью проекта и MCP",
    description:
      "SOBA Agent помогает работать с кодом из консоли: помнит заметки проекта, держит длинные сессии в порядке, подключает MCP и просит подтверждение перед риском.",
    locale: "ru_RU",
  },
  zh: {
    title: "SOBA Agent - 带项目记忆、MCP 和舒适 TUI 的 CLI 编码代理",
    description: "SOBA Agent 是 Bun-first CLI 编码代理，支持项目记忆、长会话、MCP 工具和安静好用的终端界面。",
    locale: "zh_CN",
  },
};

export function getLandingSeo(lang: string): LocalizedSeo {
  return landingSeo[isSupportedLang(lang) ? lang : i18n.defaultLanguage];
}

export function canonicalUrl(pathname: string): string {
  return `${siteUrl}${pathname === "/" ? "" : pathname}`;
}

export function localizedPath(lang: string, suffix = ""): string {
  const normalizedSuffix = suffix ? `/${suffix.replace(/^\/+/, "")}` : "";
  return `/${isSupportedLang(lang) ? lang : i18n.defaultLanguage}${normalizedSuffix}`;
}

export function alternateLanguageLinks(suffix = "") {
  return [
    ...i18n.languages.map((lang) => ({
      rel: "alternate",
      hrefLang: lang,
      href: canonicalUrl(localizedPath(lang, suffix)),
    })),
    {
      rel: "alternate",
      hrefLang: "x-default",
      href: canonicalUrl(localizedPath(i18n.defaultLanguage, suffix)),
    },
  ];
}

function isSupportedLang(lang: string): lang is SupportedLang {
  return i18n.languages.includes(lang as SupportedLang);
}
