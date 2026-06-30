import type {
  DetectProjectCommandsOptions,
  ProjectCommand,
  ProjectCommandKind,
  ProjectCommandSet,
  ProjectCommandSource,
  SkippedProjectCommand,
} from "./types";

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
}

type ProjectCommandBuckets = Omit<ProjectCommandSet, "skipped">;

const COMMAND_KINDS: ProjectCommandKind[] = ["test", "lint", "typecheck", "build", "run", "deadCode"];

export async function detectProjectCommands(options: DetectProjectCommandsOptions): Promise<ProjectCommandSet> {
  const commandSet = emptyCommandSet();
  const packageJson = await readPackageJson(options);
  const scripts = packageJson?.scripts ?? {};
  const packageScriptRunner = await detectPackageScriptRunner(options, packageJson);
  const instructions = options.projectInstructions ?? [];
  const shouldIncludeDeadCode = Boolean(options.includeFullGate || options.includeReleaseGate);
  const hasSobaInstructions = instructions.some((instruction) => /SOBA Agent|soba-agent/i.test(instruction));
  const isSobaProject = hasSobaInstructions;

  addInstructionCommands(commandSet, instructions, shouldIncludeDeadCode);
  addPackageCommands(commandSet, scripts, isSobaProject, packageScriptRunner);
  await addKnownConfigCommands(commandSet, options);
  addSobaDefaults(commandSet, isSobaProject);
  addMissingReasons(commandSet);

  return commandSet;
}

function addInstructionCommands(
  commandSet: ProjectCommandSet,
  instructions: string[],
  shouldIncludeDeadCode: boolean,
): void {
  for (const instruction of instructions) {
    for (const command of extractCommands(instruction)) {
      const kind = classifyCommand(command);
      if (!kind) continue;
      if (kind === "deadCode" && !shouldIncludeDeadCode) {
        addSkipped(commandSet, {
          kind,
          source: "project-instructions",
          command,
          reason: "Dead-code command is only selected for full gate or release policy.",
        });
        continue;
      }

      addCommand(commandSet, {
        kind,
        command: normalizeInstructionCommand(command, kind),
        source: "project-instructions",
        reason: "Detected from project instructions.",
      });
    }
  }
}

function addPackageCommands(
  commandSet: ProjectCommandSet,
  scripts: Record<string, string>,
  isSobaProject: boolean,
  scriptRunner: string,
): void {
  addPackageScriptCommand(commandSet, scripts, "test", "test", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "lint", "lint", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "typecheck", "typecheck", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "build", "build", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "verify", "run", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "check", "run", isSobaProject, scriptRunner);
  addPackageScriptCommand(commandSet, scripts, "ci", "run", isSobaProject, scriptRunner);
}

function addPackageScriptCommand(
  commandSet: ProjectCommandSet,
  scripts: Record<string, string>,
  scriptName: string,
  kind: ProjectCommandKind,
  isSobaProject: boolean,
  scriptRunner: string,
): void {
  const script = scripts[scriptName];
  if (!script) return;

  if (isSobaProject && kind === "lint" && /(?:^|\s)(?:eslint|prettier)(?:\s|$)/i.test(script)) {
    addSkipped(commandSet, {
      kind,
      source: "package-json",
      command: script,
      reason: "Rejected ESLint/Prettier package script for this SOBA project.",
    });
    return;
  }

  addCommand(commandSet, {
    kind,
    command: commandForPackageScript(scriptName, script, kind, scriptRunner),
    source: "package-json",
    reason: `Detected from package.json script "${scriptName}".`,
  });
}

async function addKnownConfigCommands(
  commandSet: ProjectCommandSet,
  options: DetectProjectCommandsOptions,
): Promise<void> {
  if (commandSet.lint.length === 0 && (await exists(options, "biome.json"))) {
    addCommand(commandSet, {
      kind: "lint",
      command: "bunx biome check .",
      source: "known-config",
      reason: "Detected Biome config without a lint script.",
    });
  }

  if (commandSet.typecheck.length === 0 && (await exists(options, "tsconfig.json"))) {
    addCommand(commandSet, {
      kind: "typecheck",
      command: "bunx tsc --noEmit",
      source: "known-config",
      reason: "Detected TypeScript config.",
    });
  }
}

function addSobaDefaults(commandSet: ProjectCommandSet, isSobaProject: boolean): void {
  if (!isSobaProject) return;

  addDefaultIfMissing(commandSet, "test", "bun test", "SOBA default test gate.");
  addDefaultIfMissing(commandSet, "lint", "bun run lint", "SOBA default Biome lint gate.");
  addDefaultIfMissing(commandSet, "typecheck", "bunx tsc --noEmit", "SOBA default typecheck gate.");
  addDefaultIfMissing(commandSet, "build", "bun run build", "SOBA default build gate.");
}

function addDefaultIfMissing(
  commandSet: ProjectCommandSet,
  kind: ProjectCommandKind,
  command: string,
  reason: string,
): void {
  addCommand(commandSet, {
    kind,
    command,
    source: "soba-default",
    reason,
  });
}

function addMissingReasons(commandSet: ProjectCommandSet): void {
  for (const kind of COMMAND_KINDS) {
    if (commandSet[kind].length > 0) continue;
    addSkipped(commandSet, {
      kind,
      source: "package-json",
      reason: `No ${kind} command discovered in project instructions, package scripts, known configs, or SOBA defaults.`,
    });
  }
}

function addCommand(commandSet: ProjectCommandSet, command: ProjectCommand): void {
  const bucket = commandSet[command.kind];
  const existingIndex = bucket.findIndex((existing) => existing.command === command.command);
  if (existingIndex !== -1) return;

  if (bucket.length === 0) {
    bucket.push(command);
    return;
  }

  const current = bucket[0];
  if (current && commandPriority(command) < commandPriority(current)) {
    bucket.splice(0, 1, command);
  }
}

function addSkipped(commandSet: ProjectCommandSet, skipped: SkippedProjectCommand): void {
  commandSet.skipped.push(skipped);
}

function commandForPackageScript(
  scriptName: string,
  script: string,
  kind: ProjectCommandKind,
  scriptRunner: string,
): string {
  const normalizedScript = normalizeWhitespace(script);
  if (scriptRunner === "bun run" && kind === "test" && /\bbun\s+test\b/i.test(normalizedScript)) {
    return normalizedScript;
  }
  return `${scriptRunner} ${scriptName}`;
}

function normalizeInstructionCommand(command: string, kind: ProjectCommandKind): string {
  const normalized = normalizeWhitespace(command);
  if (kind === "lint" && /^biome\s+check\b/i.test(normalized)) return "bunx biome check .";
  return normalized;
}

function classifyCommand(command: string): ProjectCommandKind | null {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (isNonVerificationInstructionCommand(normalized)) return null;
  if (/\b(?:typecheck|type-check|type\s+check|tsc|mypy|pyright)\b/.test(normalized)) return "typecheck";
  if (/\b(?:lint|eslint|prettier|biome|ruff|fmt|format)\b/.test(normalized)) return "lint";
  if (/\b(?:test|tests|spec|check)\b/.test(normalized)) return "test";
  if (/\b(?:verify|ci)\b/.test(normalized)) return "run";
  if (/\b(?:build|compile|make)\b/.test(normalized)) return "build";
  return "run";
}

function extractCommands(instruction: string): string[] {
  const commands: string[] = [];
  const backtickPattern = /`([^`]+)`/g;
  let match = backtickPattern.exec(instruction);
  while (match) {
    const command = cleanExtractedCommand(match[1] ?? "");
    if (looksLikeBacktickShellCommand(command) && !commands.includes(command)) commands.push(command);
    match = backtickPattern.exec(instruction);
  }

  for (const command of extractLabeledInstructionCommands(instruction)) {
    if (!commands.includes(command)) commands.push(command);
  }

  const linePatterns = [
    /\b(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+(?:lint|build|test|typecheck|verify|check|ci))(?:\s+[^\n\r`]*)?/gi,
    /\b(?:make|cmake|zig|cargo|go|dotnet|mvn|gradle|swift|xcodebuild)\s+(?:test|check|verify|build|compile)(?:\s+[^\n\r`]*)?/gi,
  ];

  for (const pattern of linePatterns) {
    let lineMatch = pattern.exec(instruction);
    while (lineMatch) {
      const command = lineMatch[0];
      if (!commands.includes(command)) commands.push(command);
      lineMatch = pattern.exec(instruction);
    }
  }

  return commands.map(cleanExtractedCommand).filter(Boolean);
}

function extractLabeledInstructionCommands(instruction: string): string[] {
  const commands: string[] = [];
  for (const rawLine of instruction.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s+/, "");
    const labeled = /^(?:run|command|commands|verify|verification|check|test|tests|build|lint|typecheck|type-check|ci)\s*[:=-]\s*(?<command>.+)$/i.exec(
      line,
    )?.groups?.command;
    const imperative = /^(?:before\s+finishing,?\s*)?(?:run|execute|use)\s+(?<command>.+)$/i.exec(line)?.groups
      ?.command;
    const command = labeled ?? imperative;
    if (!command) continue;
    const cleaned = cleanExtractedCommand(command);
    if (looksLikeShellInstructionCommand(cleaned) && !commands.includes(cleaned)) {
      commands.push(cleaned);
    }
  }
  return commands;
}

function cleanExtractedCommand(command: string): string {
  let trimmed = command.trim().replace(/[;:,]+$/g, "").trim();
  trimmed = trimmed.replace(/^["']|["']$/g, "");
  trimmed = trimmed.replace(/\s+(?:before finishing|before you finish|before finalizing)\.?$/i, "").trim();
  if (trimmed.endsWith(".") && !trimmed.endsWith(" .")) {
    trimmed = trimmed.slice(0, -1).trim();
  }
  return trimmed;
}

function looksLikeShellInstructionCommand(command: string): boolean {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (!normalized || isNonVerificationInstructionCommand(normalized)) return false;
  const firstToken = normalized.split(/\s+/)[0] ?? "";
  if (/^(?:the|a|an|all|standard|project|current|appropriate|whatever|recommended)\b/.test(firstToken)) return false;
  if (/^(?:\.{0,2}\/|~\/|[a-z]:\\)/i.test(command)) return true;
  if (/(?:&&|\|\|)/.test(command)) return true;
  if (/\b(?:test|tests|verify|check|build|compile|lint|typecheck|type-check|ci)\b/.test(normalized)) return true;
  if (/\s-{1,2}[A-Za-z0-9][\w-]*/.test(command)) return true;
  if (/\s\/[A-Za-z][\w:-]*/.test(command)) return true;
  if (/(?:^|\s)[^\s]+\.[A-Za-z0-9]{1,8}(?:\s|$)/.test(command)) return true;
  return false;
}

function looksLikeBacktickShellCommand(command: string): boolean {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (!normalized || isNonVerificationInstructionCommand(normalized)) return false;
  if (normalized.includes("\n")) return false;
  if (/[\u2500-\u257f]/u.test(command)) return false;
  if (/^(?:\.{0,2}\/|~\/|[a-z]:\\)/i.test(command)) return true;
  if (/(?:&&|\|\|)/.test(command)) return true;

  const firstToken = normalized.split(/\s+/)[0] ?? "";
  if (!isKnownShellExecutable(firstToken)) return false;

  return (
    /\b(?:test|tests|verify|check|build|compile|lint|typecheck|type-check|ci)\b/.test(normalized) ||
    /\s-{1,2}[A-Za-z0-9][\w-]*/.test(command) ||
    /\s\/[A-Za-z][\w:-]*/.test(command) ||
    /\s\.(?:\s|$)/.test(command)
  );
}

function isKnownShellExecutable(name: string): boolean {
  return (
    [
      "bun",
      "bunx",
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "make",
      "cmake",
      "zig",
      "cargo",
      "go",
      "dotnet",
      "mvn",
      "gradle",
      "swift",
      "xcodebuild",
      "biome",
      "eslint",
      "prettier",
      "ruff",
      "pytest",
      "vitest",
      "jest",
      "mocha",
      "ava",
      "tsc",
      "pyright",
      "mypy",
    ].includes(name)
  );
}

function commandPriority(command: ProjectCommand): number {
  return sourcePriority(command.source) * 100 + commandPreference(command);
}

function sourcePriority(source: ProjectCommandSource): number {
  switch (source) {
    case "project-instructions":
      return 0;
    case "package-json":
      return 1;
    case "known-config":
      return 2;
    case "soba-default":
      return 3;
  }
}

function commandPreference(command: ProjectCommand): number {
  if (command.kind === "lint" && command.command === "bun run lint") return 0;
  if (command.kind === "test" && command.command.startsWith("bun test")) return 0;
  if (command.kind === "typecheck" && command.command === "bunx tsc --noEmit") return 0;
  if (command.kind === "build" && command.command === "bun run build") return 0;
  return 10;
}

async function detectPackageScriptRunner(options: DetectProjectCommandsOptions, packageJson: PackageJson | null): Promise<string> {
  const declared = packageJson?.packageManager?.toLowerCase();
  if (declared?.startsWith("pnpm@")) return "pnpm run";
  if (declared?.startsWith("yarn@")) return "yarn run";
  if (declared?.startsWith("npm@")) return "npm run";
  if (declared?.startsWith("bun@")) return "bun run";

  if (await exists(options, "pnpm-lock.yaml")) return "pnpm run";
  if (await exists(options, "yarn.lock")) return "yarn run";
  if (await exists(options, "package-lock.json")) return "npm run";
  if (await exists(options, "npm-shrinkwrap.json")) return "npm run";
  return "bun run";
}

function isNonVerificationInstructionCommand(command: string): boolean {
  if (/(?:^|\s)(?:--help|--version|-h|-v)(?:\s|$)/.test(command)) return true;
  if (/(?:^|[;&|]\s*)(?:which|command\s+-v|type|man)\s+/.test(command)) return true;
  if (/\|\s*&?\s*(?:head|tail)\b/.test(command)) return true;
  if (/(?:^|[;&|]\s*)(?:pwd|ls|find|grep|rg|sed|cat|head|tail)\b/.test(command)) return true;
  if (/(?:^|[;&|]\s*)[^\s;&|]+\s+(?:add|create|generate|init|install|new|scaffold)\b/.test(command)) return true;
  return false;
}

async function readPackageJson(options: DetectProjectCommandsOptions): Promise<PackageJson | null> {
  if (!(await exists(options, "package.json"))) return null;

  const raw = await options.projectFiles?.readText("package.json");
  if (!raw) return null;
  return JSON.parse(raw) as PackageJson;
}

async function exists(options: DetectProjectCommandsOptions, relativePath: string): Promise<boolean> {
  return (await options.projectFiles?.exists(relativePath)) ?? false;
}

function emptyCommandSet(): ProjectCommandSet {
  const buckets: ProjectCommandBuckets = {
    test: [],
    lint: [],
    typecheck: [],
    build: [],
    run: [],
    deadCode: [],
  };
  return {
    ...buckets,
    skipped: [],
  };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
