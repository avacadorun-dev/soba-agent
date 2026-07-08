import type { Root } from "fumadocs-core/page-tree";
import { type DocsVersionSlug, isDocsVersionSlug } from "@/lib/docs-versions";

type SupportedLang = "en" | "ru" | "zh";
type DocsGroup = "start" | "workflow" | "capabilities" | "integrations" | "reference";

type DocsPage = {
  slug: string;
  path: string;
  title: string;
  group?: DocsGroup;
  versioned?: boolean;
};

type VisibleDocsPage = DocsPage & {
  version?: DocsVersionSlug;
};

const groupOrder: DocsGroup[] = ["start", "workflow", "capabilities", "integrations", "reference"];

const groupNames: Record<SupportedLang, Record<DocsGroup, string>> = {
  en: {
    start: "Start here",
    workflow: "Workflow",
    capabilities: "Core capabilities",
    integrations: "Integrations",
    reference: "Reference",
  },
  ru: {
    start: "Начало",
    workflow: "Workflow",
    capabilities: "Ключевые возможности",
    integrations: "Интеграции",
    reference: "Справочник",
  },
  zh: {
    start: "开始",
    workflow: "Workflow",
    capabilities: "核心能力",
    integrations: "集成",
    reference: "参考",
  },
};

const pagesByLang: Record<SupportedLang, DocsPage[]> = {
  en: [
    { slug: "", path: "index.en.mdx", title: "Documentation" },
    { slug: "quick-start", path: "quick-start.en.mdx", title: "Quick start", group: "start" },
    {
      slug: "walkthrough-building-a-project",
      path: "walkthrough-building-a-project.en.mdx",
      title: "Project walkthrough: v0.6 workflow",
      group: "start",
    },
    { slug: "providers", path: "providers.en.mdx", title: "Providers and models", group: "start" },
    { slug: "usage", path: "usage.en.mdx", title: "Interface and commands", group: "workflow" },
    { slug: "tools", path: "tools.en.mdx", title: "Agent tools", group: "workflow" },
    { slug: "proof", path: "proof.en.mdx", title: "Proof receipts", group: "capabilities" },
    { slug: "project-memory", path: "project-memory.en.mdx", title: "Project Memory", group: "capabilities" },
    { slug: "skills", path: "skills.en.mdx", title: "Skills", group: "capabilities" },
    { slug: "portable-capsules", path: "portable-capsules.en.mdx", title: "Portable Capsules", group: "capabilities" },
    { slug: "security", path: "security.en.mdx", title: "Security", group: "reference" },
    { slug: "configuration", path: "configuration.en.mdx", title: "Configuration", group: "reference" },
    { slug: "cli-reference", path: "cli-reference.en.mdx", title: "CLI reference", group: "reference" },
    { slug: "notifications", path: "notifications.en.mdx", title: "Sound notifications", group: "reference" },
    { slug: "themes", path: "themes.en.mdx", title: "Themes", group: "reference" },
    { slug: "changelog", path: "changelog.en.mdx", title: "Changelog", group: "reference" },
  ],
  ru: [
    { slug: "", path: "index.ru.mdx", title: "Руководство пользователя SOBA" },
    { slug: "quick-start", path: "quick-start.ru.mdx", title: "Быстрый старт", group: "start" },
    {
      slug: "walkthrough-building-a-project",
      path: "walkthrough-building-a-project.ru.mdx",
      title: "Проект шаг за шагом: v0.6 workflow",
      group: "start",
    },
    { slug: "providers", path: "providers.ru.mdx", title: "Провайдеры и модели", group: "start" },
    { slug: "usage", path: "usage.ru.mdx", title: "Интерфейс и команды", group: "workflow" },
    { slug: "sessions", path: "sessions.ru.mdx", title: "Сессии", group: "workflow" },
    { slug: "compaction", path: "compaction.ru.mdx", title: "Compaction и Context Capsules", group: "workflow" },
    { slug: "tools", path: "tools.ru.mdx", title: "Инструменты агента", group: "workflow" },
    { slug: "proof", path: "proof.ru.mdx", title: "Proof receipts", group: "capabilities" },
    { slug: "project-memory", path: "project-memory.ru.mdx", title: "Project Memory", group: "capabilities" },
    { slug: "skills", path: "skills.ru.mdx", title: "Skills", group: "capabilities" },
    { slug: "portable-capsules", path: "portable-capsules.ru.mdx", title: "Portable Capsules", group: "capabilities" },
    { slug: "mcp", path: "mcp.ru.mdx", title: "MCP-серверы", group: "integrations" },
    { slug: "remote-mcp-guide", path: "remote-mcp-guide.ru.mdx", title: "Remote MCP: пошаговый гайд", group: "integrations" },
    { slug: "acp", path: "acp.ru.mdx", title: "ACP и Zed", group: "integrations" },
    { slug: "security", path: "security.ru.mdx", title: "Безопасность", group: "reference" },
    { slug: "configuration", path: "configuration.ru.mdx", title: "Конфигурация", group: "reference" },
    { slug: "cli-reference", path: "cli-reference.ru.mdx", title: "CLI reference", group: "reference" },
    { slug: "notifications", path: "notifications.ru.mdx", title: "Звуковые уведомления", group: "reference" },
    { slug: "themes", path: "themes.ru.mdx", title: "Темы", group: "reference" },
    { slug: "changelog", path: "changelog.ru.mdx", title: "Changelog", group: "reference" },
  ],
  zh: [
    { slug: "", path: "index.zh.mdx", title: "文档" },
    { slug: "quick-start", path: "quick-start.zh.mdx", title: "快速开始", group: "start" },
    {
      slug: "walkthrough-building-a-project",
      path: "walkthrough-building-a-project.zh.mdx",
      title: "Project walkthrough: v0.6 workflow",
      group: "start",
    },
    { slug: "providers", path: "providers.zh.mdx", title: "Provider 与模型", group: "start" },
    { slug: "usage", path: "usage.zh.mdx", title: "界面与命令", group: "workflow" },
    { slug: "tools", path: "tools.zh.mdx", title: "代理工具", group: "workflow" },
    { slug: "proof", path: "proof.zh.mdx", title: "Proof receipts", group: "capabilities" },
    { slug: "project-memory", path: "project-memory.zh.mdx", title: "Project Memory", group: "capabilities" },
    { slug: "skills", path: "skills.zh.mdx", title: "Skills", group: "capabilities" },
    { slug: "portable-capsules", path: "portable-capsules.zh.mdx", title: "Portable Capsules", group: "capabilities" },
    { slug: "security", path: "security.zh.mdx", title: "安全", group: "reference" },
    { slug: "configuration", path: "configuration.zh.mdx", title: "配置", group: "reference" },
    { slug: "cli-reference", path: "cli-reference.zh.mdx", title: "CLI 参考", group: "reference" },
    { slug: "notifications", path: "notifications.zh.mdx", title: "声音通知", group: "reference" },
    { slug: "themes", path: "themes.zh.mdx", title: "主题", group: "reference" },
    { slug: "changelog", path: "changelog.zh.mdx", title: "Changelog", group: "reference" },
  ],
};

export type StaticDocsPage = DocsPage & {
  version?: DocsVersionSlug;
};

function normalizeLang(lang: string): SupportedLang | undefined {
  if (lang === "en" || lang === "ru" || lang === "zh") return lang;
}

function parseVersionedSlug(slugs: string[]): {
  version?: DocsVersionSlug;
  pageSlug: string;
} {
  const normalizedSlugs = slugs.filter(Boolean);
  const [firstSlug, ...restSlugs] = normalizedSlugs;

  if (firstSlug && isDocsVersionSlug(firstSlug)) {
    return {
      version: firstSlug,
      pageSlug: restSlugs.join("/"),
    };
  }

  return {
    pageSlug: normalizedSlugs.join("/"),
  };
}

function pagePath(page: DocsPage, version?: DocsVersionSlug): string {
  return version ? `${version}/${page.path}` : page.path;
}

function pageUrl(lang: SupportedLang, page: DocsPage, version?: DocsVersionSlug): string {
  const versionPrefix = version ? `/${version}` : "";
  return `/${lang}/docs${versionPrefix}${page.slug ? `/${page.slug}` : ""}`;
}

function visiblePages(lang: SupportedLang, version?: DocsVersionSlug): VisibleDocsPage[] {
  return pagesByLang[lang]
    .filter((page) => !version || page.versioned !== false)
    .map((page) => ({
      ...page,
      version,
    }));
}

function pageTreeItem(lang: SupportedLang, page: VisibleDocsPage) {
  return {
    type: "page" as const,
    name: page.title,
    url: pageUrl(lang, page, page.version),
  };
}

export function getStaticDocsPage(slugs: string[], lang: string): StaticDocsPage | undefined {
  const normalizedLang = normalizeLang(lang);
  if (!normalizedLang) return;

  const { version, pageSlug } = parseVersionedSlug(slugs);
  const page = pagesByLang[normalizedLang].find((candidate) => candidate.slug === pageSlug);

  if (!page) return;
  if (version && page.versioned === false) return;

  return {
    ...page,
    path: pagePath(page, version),
    version,
  };
}

export function getStaticDocsTree(lang: string, version?: DocsVersionSlug): Root {
  const normalizedLang = normalizeLang(lang) ?? "en";
  const pages = visiblePages(normalizedLang, version);
  const indexPage = pages.find((page) => page.slug === "");
  const groupedPages = pages.filter((page) => page.slug !== "");

  return {
    type: "root",
    name: "docs",
    children: [
      ...(indexPage ? [pageTreeItem(normalizedLang, indexPage)] : []),
      ...groupOrder.flatMap((group) => {
        const children = groupedPages.filter((page) => page.group === group).map((page) => pageTreeItem(normalizedLang, page));
        if (children.length === 0) return [];

        return [{
          type: "folder" as const,
          name: groupNames[normalizedLang][group],
          defaultOpen: group === "start" || group === "workflow",
          collapsible: true,
          children,
        }];
      }),
    ],
  };
}

export function docsPageExists(slug: string, lang: string, version?: DocsVersionSlug): boolean {
  const normalizedLang = normalizeLang(lang);
  if (!normalizedLang) return false;

  return pagesByLang[normalizedLang].some((page) => page.slug === slug && (!version || page.versioned !== false));
}
