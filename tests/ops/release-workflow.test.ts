import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const releaseWorkflowPath = join(projectRoot, ".github/workflows/release.yml");

function readReleaseWorkflow(): string {
  return readFileSync(releaseWorkflowPath, "utf8");
}

describe("Release workflow", () => {
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
});
