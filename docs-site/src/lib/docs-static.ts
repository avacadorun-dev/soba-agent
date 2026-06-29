import type { Root } from "fumadocs-core/page-tree";

type SupportedLang = "en" | "ru" | "zh";

type DocsPage = {
  slug: string;
  path: string;
  title: string;
};

const pagesByLang: Record<SupportedLang, DocsPage[]> = {
  en: [
    { slug: "", path: "index.en.mdx", title: "Documentation" },
    { slug: "changelog", path: "changelog.en.mdx", title: "Changelog" },
    { slug: "cli-reference", path: "cli-reference.en.mdx", title: "CLI reference" },
    { slug: "configuration", path: "configuration.en.mdx", title: "Configuration" },
    { slug: "notifications", path: "notifications.en.mdx", title: "Sound notifications" },
    { slug: "portable-capsules", path: "portable-capsules.en.mdx", title: "Portable Capsules" },
    { slug: "providers", path: "providers.en.mdx", title: "Providers and models" },
    { slug: "quick-start", path: "quick-start.en.mdx", title: "Quick start" },
    { slug: "security", path: "security.en.mdx", title: "Security" },
    { slug: "themes", path: "themes.en.mdx", title: "Themes" },
    { slug: "tools", path: "tools.en.mdx", title: "Agent tools" },
    { slug: "usage", path: "usage.en.mdx", title: "Interface and commands" },
  ],
  ru: [
    { slug: "", path: "index.ru.mdx", title: "Руководство пользователя SOBA" },
    { slug: "acp", path: "acp.ru.mdx", title: "ACP и Zed" },
    { slug: "changelog", path: "changelog.ru.mdx", title: "Changelog" },
    { slug: "cli-reference", path: "cli-reference.ru.mdx", title: "CLI reference" },
    { slug: "compaction", path: "compaction.ru.mdx", title: "Compaction и Context Capsules" },
    { slug: "configuration", path: "configuration.ru.mdx", title: "Конфигурация" },
    { slug: "mcp", path: "mcp.ru.mdx", title: "MCP-серверы" },
    { slug: "notifications", path: "notifications.ru.mdx", title: "Звуковые уведомления" },
    { slug: "portable-capsules", path: "portable-capsules.ru.mdx", title: "Portable Capsules" },
    { slug: "project-memory", path: "project-memory.ru.mdx", title: "Project Memory" },
    { slug: "providers", path: "providers.ru.mdx", title: "Провайдеры и модели" },
    { slug: "quick-start", path: "quick-start.ru.mdx", title: "Быстрый старт" },
    { slug: "remote-mcp-guide", path: "remote-mcp-guide.ru.mdx", title: "Remote MCP: пошаговый гайд" },
    { slug: "security", path: "security.ru.mdx", title: "Безопасность" },
    { slug: "sessions", path: "sessions.ru.mdx", title: "Сессии" },
    { slug: "skills", path: "skills.ru.mdx", title: "Skills" },
    { slug: "themes", path: "themes.ru.mdx", title: "Темы" },
    { slug: "tools", path: "tools.ru.mdx", title: "Инструменты агента" },
    { slug: "usage", path: "usage.ru.mdx", title: "Интерфейс и команды" },
    {
      slug: "walkthrough-building-a-project",
      path: "walkthrough-building-a-project.ru.mdx",
      title: "Проект шаг за шагом: v0.5 workflow",
    },
  ],
  zh: [
    { slug: "", path: "index.zh.mdx", title: "文档" },
    { slug: "changelog", path: "changelog.zh.mdx", title: "Changelog" },
    { slug: "cli-reference", path: "cli-reference.zh.mdx", title: "CLI 参考" },
    { slug: "configuration", path: "configuration.zh.mdx", title: "配置" },
    { slug: "notifications", path: "notifications.zh.mdx", title: "声音通知" },
    { slug: "portable-capsules", path: "portable-capsules.zh.mdx", title: "Portable Capsules" },
    { slug: "providers", path: "providers.zh.mdx", title: "Provider 与模型" },
    { slug: "quick-start", path: "quick-start.zh.mdx", title: "快速开始" },
    { slug: "security", path: "security.zh.mdx", title: "安全" },
    { slug: "themes", path: "themes.zh.mdx", title: "主题" },
    { slug: "tools", path: "tools.zh.mdx", title: "代理工具" },
    { slug: "usage", path: "usage.zh.mdx", title: "界面与命令" },
  ],
};

function normalizeLang(lang: string): SupportedLang | undefined {
  if (lang === "en" || lang === "ru" || lang === "zh") return lang;
}

export function getStaticDocsPage(slugs: string[], lang: string) {
  const normalizedLang = normalizeLang(lang);
  if (!normalizedLang) return;

  const slug = slugs.filter(Boolean).join("/");
  return pagesByLang[normalizedLang].find((page) => page.slug === slug);
}

export function getStaticDocsTree(lang: string): Root {
  const normalizedLang = normalizeLang(lang) ?? "en";
  const pages = pagesByLang[normalizedLang];

  return {
    type: "root",
    name: "docs",
    children: pages.map((page) => ({
      type: "page",
      name: page.title,
      url: `/${normalizedLang}/docs${page.slug ? `/${page.slug}` : ""}`,
    })),
  };
}
