import { Link } from "@tanstack/react-router";

const versions = [
  { label: "v0.4.1", value: "v0.4.1", latest: true },
  { label: "v0.3.4", value: "v0.3.4", latest: false },
  { label: "v0.3.0", value: "v0.3.0", latest: false },
  { label: "v0.2.0", value: "v0.2.0", latest: false },
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
