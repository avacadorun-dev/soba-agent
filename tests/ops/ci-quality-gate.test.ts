import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  scripts?: Record<string, string>;
}

const projectRoot = process.cwd();
const workflowPath = join(projectRoot, ".github/workflows/ci.yml");
const packageJsonPath = join(projectRoot, "package.json");

function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function extractRunCommands(workflow: string): string[] {
  return workflow
    .split("\n")
    .map((line) => line.match(/^\s+run:\s+(.+)$/)?.[1]?.trim())
    .filter((command): command is string => Boolean(command));
}

describe("CI quality gate", () => {
  test("workflow exists and is wired to push and pull_request", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("on:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("quality-gate:");
    expect(workflow).toContain("runs-on: ubuntu-latest");
  });

  test("workflow uses Bun setup and Bun-only quality commands", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("actions/checkout@v4");
    expect(workflow).toContain("oven-sh/setup-bun@v2");
    expect(extractRunCommands(workflow)).toEqual([
      "bun install --frozen-lockfile",
      "bun run lint",
      "bunx tsc --noEmit",
      "bun run build",
      "bun test",
    ]);
  });

  test("workflow does not introduce ESLint, Prettier or non-Bun package managers", () => {
    const workflow = readWorkflow().toLowerCase();

    expect(workflow).not.toContain("eslint");
    expect(workflow).not.toContain("prettier");
    expect(workflow).not.toContain("npm ");
    expect(workflow).not.toContain("npx ");
    expect(workflow).not.toContain("yarn");
    expect(workflow).not.toContain("pnpm");
  });

  test("workflow commands match actual package scripts", () => {
    const packageJson = readPackageJson();

    expect(packageJson.scripts?.lint).toBe("biome check .");
    expect(packageJson.scripts?.test).toBe("bun test");
    expect(packageJson.scripts?.build).toBe("bun run scripts/build.ts");
  });
});
