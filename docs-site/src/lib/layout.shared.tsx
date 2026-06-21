import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(locale?: string): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="font-bold text-fd-primary">SOBA</span>
          <span className="ml-1 text-fd-muted-foreground">Agent Docs</span>
        </>
      ),
    },
    links: [
      {
        text: locale === "ru" ? "Документация" : locale === "zh" ? "文档" : "Documentation",
        url: `/${locale ?? "en"}/docs`,
        active: "url",
      },
      {
        text: locale === "ru" ? "Дорожная карта" : locale === "zh" ? "路线图" : "Roadmap",
        url: `/${locale ?? "en"}/roadmap`,
        active: "url",
      },
      {
        text: "GitHub",
        url: "https://github.com/avacadorun-dev/soba-agent",
        active: "none",
        external: true,
      },
    ],
  };
}
