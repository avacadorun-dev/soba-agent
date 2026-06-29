import { APP_MINOR_VERSION, APP_VERSION_LABEL } from "@/lib/version";

export type DocsVersionSlug = `v${number}.${number}`;

export type DocsVersion = {
  slug: DocsVersionSlug;
  label: string;
  latest: boolean;
};

export const LATEST_DOCS_VERSION = APP_MINOR_VERSION;

export const DOCS_VERSIONS: DocsVersion[] = [
  {
    slug: APP_MINOR_VERSION,
    label: APP_VERSION_LABEL,
    latest: true,
  },
];

export function isDocsVersionSlug(value: string): value is DocsVersionSlug {
  return DOCS_VERSIONS.some((version) => version.slug === value);
}

