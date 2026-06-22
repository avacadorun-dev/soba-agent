import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(locale?: string): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="site-logo" aria-label="SOBA Agent Docs">
          <img className="site-logo-light" src="/brand/soba-wordmark-alpha-light.png" alt="" />
          <img className="site-logo-dark" src="/brand/soba-wordmark-alpha-dark.png" alt="" />
        </span>
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
