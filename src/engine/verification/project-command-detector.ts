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
}

type ProjectCommandBuckets = Omit<ProjectCommandSet, "skipped">;

const COMMAND_KINDS: ProjectCommandKind[] = ["test", "lint", "typecheck", "build", "deadCode"];

export async function detectProjectCommands(options: DetectProjectCommandsOptions): Promise<ProjectCommandSet> {
  const commandSet = emptyCommandSet();
  const packageJson = await readPackageJson(options);
  const scripts = packageJson?.scripts ?? {};
  const instructions = options.projectInstructions ?? [];
  const shouldIncludeDeadCode = Boolean(options.includeFullGate || options.includeReleaseGate);
  const hasSobaInstructions = instructions.some((instruction) => /SOBA Agent|soba-agent/i.test(instruction));
  const isSobaProject = hasSobaInstructions;

  addInstructionCommands(commandSet, instructions, shouldIncludeDeadCode);
  addPackageCommands(commandSet, scripts, isSobaProject);
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
      const forbiddenKind = forbiddenCommandKind(command);
      if (forbiddenKind) {
        addSkipped(commandSet, {
          kind: forbiddenKind,
          source: "project-instructions",
          command,
          reason: "Rejected forbidden npm/eslint/prettier command from project instructions.",
        });
        continue;
      }

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

function addPackageCommands(commandSet: ProjectCommandSet, scripts: Record<string, string>, isSobaProject: boolean): void {
  addPackageScriptCommand(commandSet, scripts, "test", "test", isSobaProject);
  addPackageScriptCommand(commandSet, scripts, "lint", "lint", isSobaProject);
  addPackageScriptCommand(commandSet, scripts, "typecheck", "typecheck", isSobaProject);
  addPackageScriptCommand(commandSet, scripts, "build", "build", isSobaProject);
}

function addPackageScriptCommand(
  commandSet: ProjectCommandSet,
  scripts: Record<string, string>,
  scriptName: string,
  kind: ProjectCommandKind,
  isSobaProject: boolean,
): void {
  const script = scripts[scriptName];
  if (!script) return;

  const forbiddenKind = forbiddenCommandKind(script);
  if (forbiddenKind || (isSobaProject && kind === "lint" && /(?:^|\s)(?:eslint|prettier)(?:\s|$)/i.test(script))) {
    addSkipped(commandSet, {
      kind,
      source: "package-json",
      command: script,
      reason: "Rejected forbidden npm/eslint/prettier package script.",
    });
    return;
  }

  addCommand(commandSet, {
    kind,
    command: commandForPackageScript(scriptName, script, kind),
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

function commandForPackageScript(scriptName: string, script: string, kind: ProjectCommandKind): string {
  const normalizedScript = normalizeWhitespace(script);
  if (kind === "test" && /\bbun\s+test\b/i.test(normalizedScript)) return normalizedScript;
  return `bun run ${scriptName}`;
}

function normalizeInstructionCommand(command: string, kind: ProjectCommandKind): string {
  const normalized = normalizeWhitespace(command);
  if (kind === "lint" && /^biome\s+check\b/i.test(normalized)) return "bunx biome check .";
  return normalized;
}

function classifyCommand(command: string): ProjectCommandKind | null {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (/\bbunx\s+tsc\b/.test(normalized) || /\bbun\s+run\s+typecheck\b/.test(normalized)) return "typecheck";
  if (/\bbun\s+run\s+build\b/.test(normalized)) return "build";
  if (/\bbun\s+test\b/.test(normalized) || /\bbun\s+run\s+test\b/.test(normalized)) return "test";
  if (/\bbun\s+run\s+lint\b/.test(normalized) || /\bbiome\s+check\b/.test(normalized)) return "lint";
  return null;
}

function forbiddenCommandKind(command: string): ProjectCommandKind | null {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (/(?:^|\s)(?:npm|yarn|pnpm)(?:\s|$)/.test(normalized)) return kindFromForbiddenCommand(normalized);
  if (/(?:^|\s)(?:eslint|prettier)(?:\s|$)/.test(normalized)) return "lint";
  return null;
}

function kindFromForbiddenCommand(command: string): ProjectCommandKind {
  if (/\btest\b/.test(command)) return "test";
  if (/\b(?:lint|eslint|prettier)\b/.test(command)) return "lint";
  if (/\b(?:typecheck|tsc)\b/.test(command)) return "typecheck";
  if (/\bbuild\b/.test(command)) return "build";
  return "test";
}

function extractCommands(instruction: string): string[] {
  const commands: string[] = [];
  const backtickPattern = /`([^`]+)`/g;
  let match = backtickPattern.exec(instruction);
  while (match) {
    const command = match[1];
    if (command) commands.push(command);
    match = backtickPattern.exec(instruction);
  }

  const linePatterns = [
    /\bbun\s+test(?:\s+[^\n\r`]*)?/gi,
    /\bbun\s+run\s+(?:lint|build|test|typecheck)(?:\s+[^\n\r`]*)?/gi,
    /\bbunx\s+tsc\s+--noEmit(?:\s+[^\n\r`]*)?/gi,
    /\bbiome\s+check(?:\s+[^\n\r`]*)?/gi,
    /\b(?:npm|yarn|pnpm)\s+run\s+(?:test|lint|build|typecheck)(?:\s+[^\n\r`]*)?/gi,
    /\b(?:eslint|prettier)(?:\s+[^\n\r`]*)?/gi,
  ];

  for (const pattern of linePatterns) {
    let lineMatch = pattern.exec(instruction);
    while (lineMatch) {
      const command = lineMatch[0];
      if (!commands.includes(command)) commands.push(command);
      lineMatch = pattern.exec(instruction);
    }
  }

  return commands.map((command) => command.replace(/[.,;:]+$/g, "").trim()).filter(Boolean);
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
