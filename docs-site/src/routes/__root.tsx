import { zhTW } from "@fumadocs/language/zh-tw";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { i18n } from "@/lib/i18n";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: "SOBA Agent — Terminal AI Coding Assistant",
      },
      {
        name: "description",
        content:
          "Next-generation CLI coding agent with proactive context management, self-modifying architecture, and hybrid visual layer.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
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
