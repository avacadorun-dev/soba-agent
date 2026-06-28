import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = process.cwd();

interface BoundaryRule {
  root: string;
  forbiddenTargets: string[];
}

const acpBoundaryRules: BoundaryRule[] = [
  {
    root: "src/adapters/acp",
    forbiddenTargets: ["src/apps/", "src/engine/", "src/infrastructure/", "src/kernel/", "src/ui/"],
  },
  {
    root: "src/apps/acp",
    forbiddenTargets: ["src/apps/cli/", "src/engine/", "src/infrastructure/", "src/kernel/", "src/ui/"],
  },
  {
    root: "src/ui",
    forbiddenTargets: [
      "src/apps/acp",
      "src/adapters/acp",
    ],
  },
];

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), "utf8");
}

function walkTypescriptFiles(root: string): string[] {
  const absoluteRoot = join(projectRoot, root);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(path);
      }
    }
  };
  visit(absoluteRoot);
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(importRe)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImportRe)) specifiers.push(match[1]);
  return specifiers;
}

function resolveProjectImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) {
    const resolved = relative(projectRoot, join(file, "..", specifier)).replaceAll("\\", "/");
    return resolved.startsWith("src/") ? resolved : undefined;
  }
  return specifier.startsWith("src/") ? specifier : undefined;
}

describe("post-ACP architecture gate", () => {
  test("keeps ACP protocol code outside core and UI layers", () => {
    const violations: string[] = [];

    for (const rule of acpBoundaryRules) {
      for (const file of walkTypescriptFiles(rule.root)) {
        const source = readFileSync(file, "utf8");
        for (const specifier of importSpecifiers(source)) {
          const resolved = resolveProjectImport(file, specifier);
          if (!resolved) continue;
          const forbidden = rule.forbiddenTargets.find((target) => resolved.startsWith(target));
          if (forbidden) {
            violations.push(`${relative(projectRoot, file)} -> ${specifier} (${forbidden})`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("ACP adapter depends only on runtime contracts and delegation ports", () => {
    const adapterFiles = walkTypescriptFiles("src/adapters/acp");
    const adapterImports = adapterFiles.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8")).flatMap((specifier) => {
        const resolved = resolveProjectImport(file, specifier);
        return resolved ? [`${relative(projectRoot, file)} -> ${resolved}`] : [];
      }),
    );

    const forbiddenImports = adapterImports.filter((entry) =>
      /src\/(core|cli|tui|widgets|apps)\//.test(entry),
    );
    expect(forbiddenImports).toEqual([]);
    expect(adapterImports).toContain("src/adapters/acp/dispatcher.ts -> src/application/acp/public");
    expect(adapterImports).toContain("src/adapters/acp/client-delegation.ts -> src/application/tool-delegation");
  });

  test("ACP config, mode and permission paths delegate to runtime/application ports", () => {
    const dispatcher = readProjectFile("src/adapters/acp/dispatcher.ts");
    const server = readProjectFile("src/apps/acp/server.ts");
    const runtimeTypes = readProjectFile("src/application/types.ts");

    expect(runtimeTypes).toContain("setSessionConfig(input: SetSessionConfigInput)");
    expect(runtimeTypes).toContain("setSessionMode(input: SetSessionModeInput)");
    expect(dispatcher).toContain("this.runtime.setSessionConfig");
    expect(dispatcher).toContain("this.runtime.setSessionMode");
    expect(dispatcher).toContain('this.requestClient("session/request_permission"');
    expect(dispatcher).toContain("this.clientCapabilities.requestPermission");
    expect(server).toContain("requestClient");
  });

  test("print and TUI smoke coverage remains present after ACP wiring", () => {
    const cli = readProjectFile("src/apps/cli/main.ts");
    const runtimeFactoryTest = readProjectFile("tests/application/runtime-factory.test.ts");
    const tuiStoreTest = readProjectFile("tests/ui/terminal/interactive/tui-store.test.ts");

    expect(cli).toContain('source: "print"');
    expect(cli).toContain("const runtimeComposition = await createSobaRuntime");
    expect(cli).toContain("if (cliArgs.acp)");
    expect(runtimeFactoryTest).toContain("builds one shared runtime composition over the legacy AgentLoop");
    expect(tuiStoreTest).toContain("uses SobaRuntime for TUI user turns when runtime is available");
  });

  test("post-ACP runtime and protocol regression tests exist", () => {
    const requiredTests = [
      "tests/application/runtime-factory.test.ts",
      "tests/ui/terminal/interactive/tui-store.test.ts",
      "tests/adapters/acp/acp-server.test.ts",
      "tests/adapters/acp/client-delegation.test.ts",
      "tests/core/permissions/permission-broker.test.ts",
      "tests/core/completion/completion-controller.test.ts",
      "tests/core/verification/verification-controller.test.ts",
      "tests/core/context/context-controller.test.ts",
    ];

    const missing = requiredTests.filter((path) => !existsSync(join(projectRoot, path)));
    expect(missing).toEqual([]);
  });
});
