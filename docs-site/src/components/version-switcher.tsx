import { Link } from "@tanstack/react-router";
import { DOCS_VERSIONS, type DocsVersionSlug } from "@/lib/docs-versions";
import { APP_VERSION_LABEL } from "@/lib/version";

type VersionEntry = {
  label: string;
  version?: DocsVersionSlug;
  latest: boolean;
};

function targetSlug(currentSlug: string, version?: DocsVersionSlug): string {
  if (!version) return currentSlug;
  return [version, currentSlug].filter(Boolean).join("/");
}

const versionEntries: VersionEntry[] = [
  { label: APP_VERSION_LABEL, latest: true },
  ...DOCS_VERSIONS.map((version) => ({
    label: version.slug,
    version: version.slug,
    latest: false,
  })),
];

export function VersionSwitcher({
  lang,
  currentSlug,
  currentVersion,
}: {
  lang: string;
  currentSlug: string;
  currentVersion?: DocsVersionSlug;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fd-muted-foreground px-1 font-medium">Version</span>
      <div className="lang-switcher inline-flex">
        {versionEntries.map((entry) => {
          const active = entry.latest ? !currentVersion : currentVersion === entry.version;

          return (
            <Link
              key={entry.version ?? "latest"}
              to="/$lang/docs/$"
              params={{ lang, _splat: targetSlug(currentSlug, entry.version) }}
              className={active ? "active" : ""}
            >
              {entry.label}
              {entry.latest && <span className="ml-1 text-fd-primary text-[10px]">latest</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
