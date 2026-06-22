import { zhTW } from "@fumadocs/language/zh-tw";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { i18n } from "@/lib/i18n";
import { canonicalUrl, getLandingSeo, githubUrl, previewImageUrl, siteUrl } from "@/lib/seo";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => {
    const fallback = getLandingSeo(i18n.defaultLanguage);

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: fallback.title },
        { name: "description", content: fallback.description },
        { name: "robots", content: "index, follow" },
        { name: "theme-color", content: "#111111" },
        { property: "og:site_name", content: "SOBA Agent" },
        { property: "og:type", content: "website" },
        { property: "og:title", content: fallback.title },
        { property: "og:description", content: fallback.description },
        { property: "og:url", content: canonicalUrl("/") },
        { property: "og:image", content: previewImageUrl },
        { property: "og:image:alt", content: "SOBA Agent terminal coding assistant preview" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: fallback.title },
        { name: "twitter:description", content: fallback.description },
        { name: "twitter:image", content: previewImageUrl },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", href: "/favicon.ico", sizes: "any" },
        { rel: "icon", type: "image/png", href: "/favicon-32x32.png", sizes: "32x32" },
        { rel: "icon", type: "image/png", href: "/favicon-16x16.png", sizes: "16x16" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
        { rel: "sitemap", type: "application/xml", href: `${siteUrl}/sitemap.xml` },
        { rel: "me", href: githubUrl },
      ],
    };
  },
  component: RootComponent,
});

const translations = i18n
  .translations()
  .extend(uiTranslations())
  .preset("zh", zhTW())
  .add({
    en: {
      displayName: "English",
      "Search(search trigger)": "Search",
    },
    zh: {
      displayName: "中文",
      "Search(search trigger)": "搜索",
    },
    ru: {
      displayName: "Русский",
      "Search(search trigger)": "Поиск",
    },
  });

function isSupportedLanguage(lang: string | undefined): lang is (typeof i18n.languages)[number] {
  return lang === "en" || lang === "ru" || lang === "zh";
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const maybeLang = pathname.split("/").filter(Boolean)[0];
  const lang = isSupportedLanguage(maybeLang) ? maybeLang : i18n.defaultLanguage;

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          key={lang}
          i18n={i18nProvider(translations, lang)}
          search={{
            enabled: true,
            options: {
              type: "static",
            },
          }}
        >
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
