import { Link } from "@tanstack/react-router";
import { APP_VERSION_LABEL } from "@/lib/version";

const versions = [
  { label: APP_VERSION_LABEL, value: APP_VERSION_LABEL, latest: true },
];

export function VersionSwitcher({ lang }: { lang: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fd-muted-foreground px-1 font-medium">Version</span>
      <div className="lang-switcher inline-flex">
        {versions.map((v) => (
          <Link key={v.value} to="/$lang/docs/$" params={{ lang, _splat: "" }} className={v.latest ? "active" : ""}>
            {v.label}
            {v.latest && <span className="ml-1 text-fd-primary text-[10px]">latest</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
