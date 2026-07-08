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
    title: "SOBA Agent - local-first coding agent that leaves receipts",
    description:
      "SOBA Agent is a local-first engineering agent with proof receipts, Project Memory provenance, MCP tools, bounded permissions, and a terminal TUI.",
    locale: "en_US",
  },
  ru: {
    title: "SOBA Agent - local-first агент для разработки",
    description:
      "SOBA Agent помогает работать с кодом локально: сохраняет proof receipts, хранит Project Memory с provenance, подключает MCP и ограничивает рискованные операции.",
    locale: "ru_RU",
  },
  zh: {
    title: "SOBA Agent - 会留下证据的 local-first 编码代理",
    description: "SOBA Agent 是 local-first 工程代理，支持 proof receipts、带来源的项目记忆、MCP 工具、有边界权限和终端 TUI。",
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
