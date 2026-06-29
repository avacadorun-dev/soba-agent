import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = process.cwd();

interface LayerRule {
  root: string;
  forbiddenTargets: string[];
}

interface ControllerCoverage {
  implementation: string;
  testFile: string;
  symbol: string;
}

const layerRules: LayerRule[] = [
  {
    root: "src/kernel",
    forbiddenTargets: ["src/application/", "src/engine/", "src/infrastructure/", "src/apps/", "src/adapters/", "src/ui/"],
  },
  {
    root: "src/engine",
    forbiddenTargets: ["src/infrastructure/", "src/apps/", "src/adapters/", "src/ui/"],
  },
  {
    root: "src/application",
    forbiddenTargets: ["src/engine/", "src/composition/", "src/infrastructure/", "src/apps/", "src/adapters/", "src/ui/"],
  },
  {
    root: "src/infrastructure",
    forbiddenTargets: ["src/engine/", "src/composition/", "src/apps/", "src/ui/"],
  },
  {
    root: "src/adapters",
    forbiddenTargets: ["src/engine/", "src/infrastructure/", "src/composition/", "src/apps/", "src/ui/"],
  },
  {
    root: "src/ui",
    forbiddenTargets: ["src/apps/cli/"],
  },
];

const controllerCoverage: ControllerCoverage[] = [
  {
    implementation: "src/engine/turn/agent-loop.ts",
    testFile: "tests/agent-loop.test.ts",
    symbol: "AgentLoop",
  },
  {
    implementation: "src/engine/model-turn/model-turn-runner.ts",
    testFile: "tests/core/model-turn/model-turn-runner.test.ts",
    symbol: "ModelTurnRunner",
  },
  {
    implementation: "src/engine/tool-calls/tool-call-executor.ts",
    testFile: "tests/core/tool-execution/tool-call-executor.test.ts",
    symbol: "ToolCallExecutor",
  },
  {
    implementation: "src/engine/permissions/permission-broker.ts",
    testFile: "tests/core/permissions/permission-broker.test.ts",
    symbol: "PermissionBroker",
  },
  {
    implementation: "src/engine/completion/completion-controller.ts",
    testFile: "tests/core/completion/completion-controller.test.ts",
    symbol: "CompletionController",
  },
  {
    implementation: "src/engine/verification/verification-controller.ts",
    testFile: "tests/core/verification/verification-controller.test.ts",
    symbol: "VerificationController",
  },
  {
    implementation: "src/engine/context/context-controller.ts",
    testFile: "tests/core/context/context-controller.test.ts",
    symbol: "ContextController",
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

describe("clean architecture pre-gate", () => {
  test("enforces layer direction before ACP adapters are allowed", () => {
    const violations: string[] = [];

    for (const rule of layerRules) {
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

  test("root application public facade stays retired", () => {
    expect(existsSync(join(projectRoot, "src/application/public.ts"))).toBe(false);
  });

  test("print and TUI entrypoints execute user turns through SobaRuntime", () => {
    const cli = readProjectFile("src/apps/cli/main.ts");
    const tuiTypes = readProjectFile("src/ui/terminal/interactive/model/types.ts");
    const tuiStore = readProjectFile("src/ui/terminal/interactive/model/tui-store.ts");

    expect(cli).toContain("const runtimeComposition = await createSobaRuntime");
    expect(cli).toContain("runtime.onEvent");
    expect(cli).toContain('source: "print"');
    expect(cli).not.toContain("await loop.runTurn(prompt)");
    expect(tuiTypes).toContain("runtime?: SobaRuntime");
    expect(tuiStore).toContain("this.options.runtime.runTurn");
    expect(tuiStore).toContain('source: "tui"');
  });

  test("extracted workflow controllers have direct tests", () => {
    const missingCoverage = controllerCoverage.flatMap(({ implementation, testFile, symbol }) => {
      const failures: string[] = [];
      if (!existsSync(join(projectRoot, implementation))) failures.push(`${implementation} is missing`);
      if (!existsSync(join(projectRoot, testFile))) {
        failures.push(`${testFile} is missing for ${implementation}`);
        return failures;
      }
      const testSource = readProjectFile(testFile);
      if (!testSource.includes(symbol)) failures.push(`${testFile} does not exercise ${symbol}`);
      return failures;
    });

    expect(missingCoverage).toEqual([]);
  });

  test("legacy AgentLoop remains a transition shell over extracted services", () => {
    const source = readProjectFile("src/engine/turn/agent-loop.ts");
    const turnRunnerSource = readProjectFile("src/engine/turn/agent-turn-runner.ts");
    const turnStageSource = [
      "src/engine/turn/agent-turn-begin.ts",
      "src/engine/turn/agent-turn-completion-stage.ts",
      "src/engine/turn/agent-turn-prompt-context.ts",
      "src/engine/turn/agent-turn-response-stage.ts",
      "src/engine/turn/agent-turn-runner-events.ts",
      "src/engine/turn/agent-turn-tool-stage.ts",
      "src/engine/turn/agent-turn-verification-stage.ts",
    ]
      .map(readProjectFile)
      .join("\n");
    const runtimeSource = readProjectFile("src/engine/turn/agent-loop-runtime.ts");
    const requiredShellSignals = [
      "./agent-turn-runner",
      "return runAgentTurn",
    ];
    const requiredTurnRunnerSignals = [
      "../model-turn/model-turn-runner",
      "../completion/completion-controller",
      "../verification/verification-controller",
      "./model-turn-execution",
      "new CompletionController",
      "new VerificationController",
      "executeModelTurn",
    ];
    const requiredRuntimeSignals = [
      "../tool-calls/tool-call-executor",
      "../permissions/permission-broker",
      "../context/context-controller",
      "new ContextController",
      "new PermissionBroker",
      "new ToolCallExecutor",
      "createAgentLoopRuntime",
    ];
    const forbiddenOwnershipImports = [
      "../../infrastructure/llm/providers/registry",
      "../../infrastructure/llm/providers/client-proxy",
      "../../infrastructure/mcp/config",
      "../../infrastructure/mcp/tool-registry-sync",
      "../memory/memory-tools",
      "../../infrastructure/tools/local/bash",
      "../../infrastructure/tools/local/edit",
      "../../infrastructure/tools/local/inspect-file",
      "../../infrastructure/tools/local/ls",
      "../../infrastructure/tools/local/read",
      "../../infrastructure/tools/local/search-files",
      "../../infrastructure/tools/local/write",
    ];

    const missingRuntimeSignals = requiredRuntimeSignals.filter((signal) => !runtimeSource.includes(signal));
    const ownershipLeaks = [
      ...importSpecifiers(source),
      ...importSpecifiers(turnRunnerSource),
      ...importSpecifiers(turnStageSource),
      ...importSpecifiers(runtimeSource),
    ].filter((specifier) => forbiddenOwnershipImports.includes(specifier));

    const missingShellSignals = requiredShellSignals.filter((signal) => !source.includes(signal));
    const turnPipelineSource = `${turnRunnerSource}\n${turnStageSource}`;
    const missingTurnRunnerSignals = requiredTurnRunnerSignals.filter((signal) => !turnPipelineSource.includes(signal));

    expect(missingShellSignals).toEqual([]);
    expect(missingTurnRunnerSignals).toEqual([]);
    expect(missingRuntimeSignals).toEqual([]);
    expect(ownershipLeaks).toEqual([]);
    expect(source.split("\n").length).toBeLessThanOrEqual(300);
    expect(turnRunnerSource.split("\n").length).toBeLessThanOrEqual(400);
    expect(source).toContain("return this.runtime.toolExecutor.abortActiveTool()");
    expect(source).toContain("return this.runtime.toolExecutor.runDirectShellCommand(command, silent)");
  });
});
