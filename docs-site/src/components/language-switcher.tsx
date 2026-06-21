import { Link } from "@tanstack/react-router";
import { i18n } from "@/lib/i18n";

const langNames: Record<string, string> = {
  en: "EN",
  ru: "RU",
  zh: "中文",
};

export function LanguageSwitcher({ lang }: { lang: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fd-muted-foreground px-1 font-medium">Language</span>
      <div className="lang-switcher inline-flex">
        {i18n.languages.map((l) => (
          <Link key={l} to="/$lang" params={{ lang: l }} className={lang === l ? "active" : ""}>
            {langNames[l]}
          </Link>
        ))}
      </div>
    </div>
  );
}
