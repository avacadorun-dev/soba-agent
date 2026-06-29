import { createFileRoute, notFound } from "@tanstack/react-router";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { VersionSwitcher } from "@/components/version-switcher";
import { getStaticDocsPage, getStaticDocsTree } from "@/lib/docs-static";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/$lang/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const page = getStaticDocsPage(params._splat?.split("/") ?? [], params.lang);

    if (!page?.path) {
      throw notFound();
    }

    await clientLoader.preload(page.path);

    return {
      path: page.path,
      pageSlug: page.slug,
      pageTree: getStaticDocsTree(params.lang, page.version),
      version: page.version,
    };
  },
});

const clientLoader = browserCollections.docs.createClientLoader({
  component({ toc, frontmatter, default: MDX }) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX
            components={{
              ...defaultMdxComponents,
            }}
          />
        </DocsBody>
      </DocsPage>
    );
  },
});

function Page() {
  const { lang } = Route.useParams();
  const data = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout
      key={`${lang}:${data.path}`}
      {...baseOptions(lang)}
      tree={data.pageTree}
      sidebar={{
        banner: (
          <div className="flex flex-col gap-2 p-2">
            <VersionSwitcher lang={lang} currentSlug={data.pageSlug} currentVersion={data.version} />
            <LanguageSwitcher lang={lang} docs />
          </div>
        ),
      }}
    >
      <Suspense>{clientLoader.useContent(data.path)}</Suspense>
    </DocsLayout>
  );
}
