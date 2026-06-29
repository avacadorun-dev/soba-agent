import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const docsRoot = join(projectRoot, "docs-site/content/docs");
const args = process.argv.slice(2);
const shouldCheck = args.includes("--check");
const requestedVersion = args.find((arg) => !arg.startsWith("--"));

function currentMinorVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const [major, minor] = packageJson.version.split(".");

  if (!major || !minor) {
    throw new Error(`Invalid package version: ${packageJson.version}`);
  }

  return `v${major}.${minor}`;
}

function snapshotVersion(): string {
  return requestedVersion ?? currentMinorVersion();
}

function assertVersion(value: string): void {
  if (!/^v\d+\.\d+$/.test(value)) {
    throw new Error(`Docs snapshot version must look like vX.Y, got: ${value}`);
  }
}

function sourceFiles(): string[] {
  return readdirSync(docsRoot)
    .filter((entry) => entry.endsWith(".mdx"))
    .sort();
}

function rewriteDocsLinks(content: string, version: string): string {
  return content
    .replaceAll(
      /(\]\(\/(?:en|ru|zh)\/docs)(?!\/v\d+\.\d+)(?=[/#)])/g,
      `$1/${version}`,
    )
    .replaceAll(
      /(href="\/(?:en|ru|zh)\/docs)(?!\/v\d+\.\d+)(?=[/#"])/g,
      `$1/${version}`,
    );
}

function expectedSnapshotFiles(version: string): Map<string, string> {
  const files = new Map<string, string>();

  for (const fileName of sourceFiles()) {
    files.set(fileName, rewriteDocsLinks(readFileSync(join(docsRoot, fileName), "utf8"), version));
  }

  if (files.size === 0) {
    throw new Error(`No top-level MDX docs found in ${docsRoot}`);
  }

  return files;
}

function assertSnapshot(version: string, expectedFiles: Map<string, string>): void {
  const snapshotDir = join(docsRoot, version);
  const mismatches: string[] = [];

  if (!existsSync(snapshotDir)) {
    throw new Error(`Docs snapshot is missing: ${snapshotDir}`);
  }

  const actualFiles = readdirSync(snapshotDir)
    .filter((entry) => entry.endsWith(".mdx"))
    .sort();
  const expectedFileNames = [...expectedFiles.keys()].sort();

  if (actualFiles.join("\n") !== expectedFileNames.join("\n")) {
    mismatches.push(`${version}/ file list`);
  }

  for (const [fileName, expected] of expectedFiles) {
    const snapshotPath = join(snapshotDir, fileName);
    const actual = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : "";

    if (actual !== expected) {
      mismatches.push(`${version}/${fileName}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Docs snapshot ${version} is out of date:\n${mismatches
        .map((item) => `- ${item}`)
        .join("\n")}\nRun: bun run docs:version:snapshot ${version}`,
    );
  }
}

function writeSnapshot(version: string, expectedFiles: Map<string, string>): void {
  const snapshotDir = join(docsRoot, version);
  mkdirSync(snapshotDir, { recursive: true });

  for (const entry of readdirSync(snapshotDir)) {
    if (entry.endsWith(".mdx") && !expectedFiles.has(entry)) {
      rmSync(join(snapshotDir, entry));
    }
  }

  for (const [fileName, content] of expectedFiles) {
    writeFileSync(join(snapshotDir, fileName), content);
  }
}

const version = snapshotVersion();
assertVersion(version);

const expectedFiles = expectedSnapshotFiles(version);

if (shouldCheck) {
  assertSnapshot(version, expectedFiles);
} else {
  writeSnapshot(version, expectedFiles);
  console.log(`Generated docs snapshot ${version} with ${expectedFiles.size} pages.`);
}
