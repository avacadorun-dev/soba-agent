import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Lang = "en" | "ru" | "zh";

type Commit = {
  fullHash: string;
  shortHash: string;
  subject: string;
};

type ChangelogSection = {
  title: string;
  date?: string;
  previousTag?: string;
  tag?: string;
  linkCommits: boolean;
  commits: Commit[];
};

type Category = "added" | "fixed" | "changed" | "docs" | "tests" | "maintenance";

type Copy = {
  title: string;
  description: string;
  intro: string;
  generated: string;
  unreleasedTitle: string;
  unreleasedDescription(latestTag?: string): string;
  releaseDescription(tag: string, date?: string): string;
  compareLabel: string;
  localRangeLabel: string;
  noChanges: string;
  categories: Record<Category, string>;
};

const projectRoot = process.cwd();
const outputFiles: Record<Lang, string> = {
  en: "docs-site/content/docs/changelog.en.mdx",
  ru: "docs-site/content/docs/changelog.ru.mdx",
  zh: "docs-site/content/docs/changelog.zh.mdx",
};

const categoryOrder: Category[] = [
  "added",
  "fixed",
  "changed",
  "docs",
  "tests",
  "maintenance",
];

const copy: Record<Lang, Copy> = {
  en: {
    title: "Changelog",
    description: "Version history generated from SOBA Agent git tags and commit subjects.",
    intro:
      "This page is generated from repository tags and commit subjects. Run `bun run docs:changelog` before cutting a release, and `bun run docs:changelog:check` in CI.",
    generated: "Generated file. Do not edit by hand.",
    unreleasedTitle: "Unreleased",
    unreleasedDescription: (latestTag) =>
      latestTag
        ? `Changes after \`${latestTag}\`. Cut a release by updating versions and tagging the release commit.`
        : "Changes that are not attached to a version tag yet.",
    releaseDescription: (tag, date) => `Released ${date ?? "with the recorded git tag"} as \`${tag}\`.`,
    compareLabel: "Compare",
    localRangeLabel: "Local range",
    noChanges: "No commits in this range.",
    categories: {
      added: "Added",
      fixed: "Fixed",
      changed: "Changed",
      docs: "Documentation",
      tests: "Tests",
      maintenance: "Maintenance",
    },
  },
  ru: {
    title: "Changelog",
    description: "История версий SOBA Agent, собранная из git-тегов и commit subjects.",
    intro:
      "Эта страница генерируется из тегов репозитория и commit subjects. Перед релизом запускайте `bun run docs:changelog`, а в CI проверяйте `bun run docs:changelog:check`.",
    generated: "Сгенерированный файл. Не редактировать вручную.",
    unreleasedTitle: "Unreleased",
    unreleasedDescription: (latestTag) =>
      latestTag
        ? `Изменения после \`${latestTag}\`. Для релиза обновите версии и поставьте тег на release commit.`
        : "Изменения, которые пока не привязаны к version tag.",
    releaseDescription: (tag, date) => `Релиз ${date ?? "по recorded git tag"}: \`${tag}\`.`,
    compareLabel: "Compare",
    localRangeLabel: "Local range",
    noChanges: "В этом диапазоне нет коммитов.",
    categories: {
      added: "Added",
      fixed: "Fixed",
      changed: "Changed",
      docs: "Documentation",
      tests: "Tests",
      maintenance: "Maintenance",
    },
  },
  zh: {
    title: "Changelog",
    description: "从 SOBA Agent git 标签和提交主题生成的版本历史。",
    intro:
      "此页面由仓库标签和提交主题生成。发布前运行 `bun run docs:changelog`，并在 CI 中运行 `bun run docs:changelog:check`。",
    generated: "生成文件。不要手动编辑。",
    unreleasedTitle: "Unreleased",
    unreleasedDescription: (latestTag) =>
      latestTag
        ? `\`${latestTag}\` 之后的更改。发布时请更新版本并为 release commit 打 tag。`
        : "尚未归入版本标签的更改。",
    releaseDescription: (tag, date) => `${date ?? "记录的 git tag"} 发布为 \`${tag}\`。`,
    compareLabel: "Compare",
    localRangeLabel: "Local range",
    noChanges: "此范围内没有提交。",
    categories: {
      added: "Added",
      fixed: "Fixed",
      changed: "Changed",
      docs: "Documentation",
      tests: "Tests",
      maintenance: "Maintenance",
    },
  },
};

const args = process.argv.slice(2);
const shouldCheck = args.includes("--check");
const releaseNotesIndex = args.indexOf("--release-notes");
const releaseNotesTag = releaseNotesIndex >= 0 ? args[releaseNotesIndex + 1] : undefined;
const nextTagIndex = args.indexOf("--next-tag");
const nextTag = nextTagIndex >= 0 ? args[nextTagIndex + 1] : undefined;

if (releaseNotesIndex >= 0 && !releaseNotesTag) {
  throw new Error("Missing tag after --release-notes.");
}

if (nextTagIndex >= 0 && !nextTag) {
  throw new Error("Missing tag after --next-tag.");
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.stdout.trim();
}

function repositoryUrl(): string {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
    repository?: { url?: string };
  };
  const rawUrl = packageJson.repository?.url ?? "";
  const withoutGitSuffix = rawUrl.replace(/^git\+/, "").replace(/\.git$/, "");
  const match = withoutGitSuffix.match(/github\.com[:/]([^/]+\/[^/]+)$/);

  return match ? `https://github.com/${match[1]}` : "https://github.com/avacadorun-dev/soba-agent";
}

function releaseTags(): string[] {
  const output = runGit(["tag", "--list", "v[0-9]*", "--sort=v:refname"]);

  return output ? output.split("\n").filter(Boolean) : [];
}

function commitDate(ref: string): string {
  return runGit(["log", "-1", "--format=%cs", ref]);
}

function commitsForRange(range: string): Commit[] {
  const output = runGit(["log", "--no-merges", "--format=%H%x09%h%x09%s", range]);

  if (!output) return [];

  return output
    .split("\n")
    .map((line) => {
      const [fullHash, shortHash, ...subjectParts] = line.split("\t");

      return {
        fullHash,
        shortHash,
        subject: subjectParts.join("\t"),
      };
    })
    .filter((commit) => !isReleaseCommit(commit.subject));
}

function isReleaseCommit(subject: string): boolean {
  return /^(chore:\s*)?release:? v?\d+\.\d+\.\d+$/i.test(subject);
}

function buildSections(options: { nextTag?: string } = {}): ChangelogSection[] {
  const tags = releaseTags();
  const sections: ChangelogSection[] = [];
  const latestTag = tags.at(-1);

  if (latestTag) {
    const unreleasedCommits = commitsForRange(`${latestTag}..HEAD`);

    if (unreleasedCommits.length > 0) {
      sections.push({
        title: options.nextTag ?? "Unreleased",
        tag: options.nextTag,
        previousTag: latestTag,
        date: options.nextTag ? commitDate("HEAD") : undefined,
        linkCommits: Boolean(options.nextTag),
        commits: unreleasedCommits,
      });
    }
  }

  for (let index = tags.length - 1; index >= 0; index--) {
    const tag = tags[index];
    const previousTag = tags[index - 1];

    sections.push({
      title: tag,
      tag,
      previousTag,
      date: commitDate(tag),
      linkCommits: true,
      commits: commitsForRange(previousTag ? `${previousTag}..${tag}` : tag),
    });
  }

  return sections;
}

function classify(subject: string): Category {
  const normalized = subject.toLowerCase();

  if (/^feat(\(.+\))?!?:/.test(normalized)) return "added";
  if (/^fix(\(.+\))?!?:/.test(normalized)) return "fixed";
  if (/^docs(\(.+\))?!?:/.test(normalized)) return "docs";
  if (/^test(\(.+\))?!?:/.test(normalized)) return "tests";
  if (/^(chore|build|ci)(\(.+\))?!?:/.test(normalized)) return "maintenance";
  if (/^(refactor|perf)(\(.+\))?!?:/.test(normalized)) return "changed";

  return "changed";
}

function stripConventionalPrefix(subject: string): string {
  return subject.replace(
    /^(feat|fix|docs|refactor|test|chore|build|ci|perf)(\([^)]+\))?!?:\s*/i,
    "",
  );
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function compareUrl(section: ChangelogSection, repoUrl: string): string {
  if (section.tag && section.previousTag) {
    return `${repoUrl}/compare/${section.previousTag}...${section.tag}`;
  }
  if (section.tag) {
    return `${repoUrl}/releases/tag/${section.tag}`;
  }
  if (section.previousTag) {
    return `${repoUrl}/compare/${section.previousTag}...HEAD`;
  }

  return repoUrl;
}

function groupedCommits(section: ChangelogSection): Map<Category, Commit[]> {
  const groups = new Map<Category, Commit[]>();

  for (const commit of section.commits) {
    const category = classify(commit.subject);
    groups.set(category, [...(groups.get(category) ?? []), commit]);
  }

  return groups;
}

function renderSectionBody(section: ChangelogSection, lang: Lang, repoUrl: string): string[] {
  const labels = copy[lang];
  const groups = groupedCommits(section);
  const lines: string[] = [];

  if (section.tag) {
    lines.push(`[${labels.compareLabel}](${compareUrl(section, repoUrl)})`, "");
  } else if (section.previousTag) {
    lines.push(`${labels.localRangeLabel}: \`${section.previousTag}..HEAD\``, "");
  }

  if (section.commits.length === 0) {
    lines.push(labels.noChanges, "");
    return lines;
  }

  for (const category of categoryOrder) {
    const commits = groups.get(category);
    if (!commits?.length) continue;

    lines.push(`### ${labels.categories[category]}`, "");
    for (const commit of commits) {
      const subject = escapeMarkdown(stripConventionalPrefix(commit.subject));
      const hash = section.linkCommits
        ? `[${commit.shortHash}](${repoUrl}/commit/${commit.fullHash})`
        : `\`${commit.shortHash}\``;
      lines.push(`- ${subject} (${hash})`);
    }
    lines.push("");
  }

  return lines;
}

function renderDoc(lang: Lang, sections: ChangelogSection[], repoUrl: string): string {
  const labels = copy[lang];
  const latestTag = sections.find((section) => section.tag)?.tag;
  const lines: string[] = [
    "---",
    `title: ${labels.title}`,
    `description: ${labels.description}`,
    "---",
    "",
    `{/* ${labels.generated} */}`,
    "",
    labels.intro,
    "",
  ];

  for (const section of sections) {
    const title = section.tag ?? labels.unreleasedTitle;
    lines.push(`## ${title}`, "");
    lines.push(
      section.tag
        ? labels.releaseDescription(section.tag, section.date)
        : labels.unreleasedDescription(latestTag),
      "",
    );
    lines.push(...renderSectionBody(section, lang, repoUrl));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderReleaseNotes(tag: string, sections: ChangelogSection[], repoUrl: string): string {
  const section = sections.find((item) => item.tag === tag);

  if (!section) {
    throw new Error(`Cannot generate release notes: tag ${tag} is not present in git history.`);
  }

  const lines = [
    `SOBA Agent ${tag}`,
    "",
    ...renderSectionBody(section, "en", repoUrl),
    "Install from npm:",
    "",
    "```bash",
    "npm install -g soba-agent",
    "```",
    "",
    "Install with Bun:",
    "",
    "```bash",
    "bun add -g soba-agent",
    "```",
    "",
    "Standalone binaries and SHA256SUMS are attached to this release.",
    "",
  ];

  return lines.join("\n");
}

function assertGeneratedFiles(expected: Record<string, string>): void {
  const mismatches: string[] = [];

  for (const [relativePath, content] of Object.entries(expected)) {
    const absolutePath = join(projectRoot, relativePath);
    const actual = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";

    if (actual !== content) {
      mismatches.push(relativePath);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Generated changelog files are out of date:\n${mismatches
        .map((path) => `- ${path}`)
        .join("\n")}\nRun: bun run docs:changelog`,
    );
  }
}

function writeGeneratedFiles(expected: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(expected)) {
    writeFileSync(join(projectRoot, relativePath), content);
  }
}

const repoUrl = repositoryUrl();
const sections = buildSections({ nextTag });

if (releaseNotesTag) {
  process.stdout.write(renderReleaseNotes(releaseNotesTag, sections, repoUrl));
} else {
  const expected = Object.fromEntries(
    Object.entries(outputFiles).map(([lang, path]) => [
      path,
      renderDoc(lang as Lang, sections, repoUrl),
    ]),
  );

  if (shouldCheck) {
    assertGeneratedFiles(expected);
  } else {
    writeGeneratedFiles(expected);
    console.log(`Generated ${Object.keys(expected).length} changelog docs.`);
  }
}
