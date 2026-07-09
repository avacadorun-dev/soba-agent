import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const workflowPath = join(projectRoot, ".github/workflows/docs-pages.yml");
const viteConfigPath = join(projectRoot, "docs-site/vite.config.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Docs Pages workflow", () => {
  test("deploys the static docs-site client bundle to GitHub Pages", () => {
    const workflow = read(workflowPath);

    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("uses: actions/configure-pages@v6");
    expect(workflow).toContain("uses: actions/upload-pages-artifact@v5");
    expect(workflow).toContain("path: docs-site/dist/client");
    expect(workflow).toContain("uses: actions/deploy-pages@v5");
  });

  test("prerenders the root route for static hosting", () => {
    const viteConfig = read(viteConfigPath);

    expect(viteConfig).toContain('path: "/"');
    expect(viteConfig).toContain("prerender: { enabled: true }");
  });
});
