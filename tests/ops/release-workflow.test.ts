import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const releaseWorkflowPath = join(projectRoot, ".github/workflows/release.yml");
const packageJsonPath = join(projectRoot, "package.json");

function readReleaseWorkflow(): string {
  return readFileSync(releaseWorkflowPath, "utf8");
}

describe("Release workflow", () => {
  test("keeps standalone binaries out of the npm package", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      files?: string[];
    };

    expect(packageJson.files).toContain("dist/cli.js");
    expect(packageJson.files).not.toContain("dist/");
  });

  test("builds OpenTUI binaries on native platform runners", () => {
    const workflow = readReleaseWorkflow();

    expect(workflow).toContain("runs-on: ${{ matrix.runner }}");
    expect(workflow).toContain("target: bun-darwin-arm64");
    expect(workflow).toContain("runner: macos-15");
    expect(workflow).toContain("target: bun-darwin-x64");
    expect(workflow).toContain("runner: macos-15-intel");
    expect(workflow).toContain("target: bun-linux-arm64");
    expect(workflow).toContain("runner: ubuntu-24.04-arm");
    expect(workflow).toContain("target: bun-linux-x64");
    expect(workflow).toContain("runner: ubuntu-24.04");
  });

  test("passes repository context to GitHub CLI release publishing", () => {
    const workflow = readReleaseWorkflow();

    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("GH_REPO: ${{ github.repository }}");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("gh release create");
  });

  test("generates release notes from the changelog script", () => {
    const workflow = readReleaseWorkflow();

    expect(workflow).toContain(
      "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref }}",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("bun run docs:changelog:check");
    expect(workflow).toContain("bun run docs:version:check");
    expect(workflow).toContain(
      'bun run scripts/generate-changelog.ts --release-notes "$RELEASE_TAG" > "$RUNNER_TEMP/release-notes.md"',
    );
  });
});
