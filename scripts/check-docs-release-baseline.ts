import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const scanRoots = [
  "docs-site/content/docs",
  "docs-site/src/lib",
  "docs-site/src/routes",
  ".github/workflows/release.yml",
];

const legacyReleasePattern = /\bv0\.[0-5](?:\.(?:\d+|x))?\b|\b0\.[45]\.(?:\d+|x)\b/g;

function collectFiles(relativePath: string): string[] {
  const absolutePath = join(projectRoot, relativePath);
  const stats = statSync(absolutePath);

  if (stats.isFile()) {
    return [relativePath];
  }

  const files: string[] = [];
  for (const entry of readdirSync(absolutePath).sort()) {
    const childPath = `${relativePath}/${entry}`;
    const childStats = statSync(join(projectRoot, childPath));

    if (childStats.isDirectory()) {
      files.push(...collectFiles(childPath));
    } else if (/\.(mdx?|tsx?|ya?ml)$/.test(entry)) {
      files.push(childPath);
    }
  }

  return files;
}

const violations: string[] = [];

for (const file of scanRoots.flatMap(collectFiles)) {
  const content = readFileSync(join(projectRoot, file), "utf8");
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    const matches = [...line.matchAll(legacyReleasePattern)].map((match) => match[0]);
    if (matches.length > 0) {
      violations.push(`${file}:${index + 1}: ${[...new Set(matches)].join(", ")}`);
    }
  });
}

if (violations.length > 0) {
  throw new Error(
    `Legacy docs release references found. v0.6.0 is the documentation baseline:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`,
  );
}

console.log("Docs release baseline check passed.");
