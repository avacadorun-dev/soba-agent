export type TaskKind =
  | "read_only_question"
  | "code_change"
  | "bug_fix"
  | "test_failure"
  | "lint_failure"
  | "feature"
  | "refactor"
  | "docs_change"
  | "review"
  | "release_task"
  | "unknown";

export type VerificationRequirement = "none" | "inspection" | "command" | "full_gate";

export type VerificationKind = "test" | "lint" | "typecheck" | "build" | "run" | "diff_inspection" | "manual_inspection";

export interface VerificationPolicyDecision {
  requirement: VerificationRequirement;
  acceptedKinds: VerificationKind[];
  commands: string[];
  reason: string;
}

export interface VerificationPolicyContext {
  taskKind?: TaskKind;
  hasDocsMutations?: boolean;
  hasCodeMutations?: boolean;
  forceFullGate?: boolean;
}

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);

export function decideVerificationPolicy(taskKind: TaskKind = "unknown"): VerificationPolicyDecision {
  switch (taskKind) {
    case "read_only_question":
      return {
        requirement: "none",
        acceptedKinds: [],
        commands: [],
        reason: "Read-only work does not require mutation verification.",
      };
    case "docs_change":
      return {
        requirement: "inspection",
        acceptedKinds: ["diff_inspection", "manual_inspection"],
        commands: ["git diff -- docs"],
        reason: "Docs-only changes can be verified by reading back the diff or edited docs.",
      };
    case "review":
      return {
        requirement: "inspection",
        acceptedKinds: ["manual_inspection"],
        commands: ["git diff --stat", "git diff"],
        reason: "Review tasks require inspection evidence, not mutation verification.",
      };
    case "lint_failure":
      return {
        requirement: "command",
        acceptedKinds: ["lint", "run"],
        commands: [],
        reason: "Lint-failure work must finish with passing lint evidence discovered from the project.",
      };
    case "test_failure":
      return {
        requirement: "command",
        acceptedKinds: ["test", "run"],
        commands: [],
        reason: "Test-failure work must finish with passing test evidence discovered from the project.",
      };
    case "bug_fix":
    case "code_change":
      return {
        requirement: "command",
        acceptedKinds: ["test", "run", "lint", "typecheck"],
        commands: [],
        reason: "Code-changing work requires passing project command evidence after the mutation.",
      };
    case "feature":
    case "refactor":
      return {
        requirement: "command",
        acceptedKinds: ["test", "lint", "typecheck", "build", "run"],
        commands: [],
        reason: "Feature and refactor work require project command verification.",
      };
    case "release_task":
      return {
        requirement: "full_gate",
        acceptedKinds: ["test", "lint", "typecheck", "build", "run"],
        commands: [],
        reason: "Release work requires the full project verification gate.",
      };
    case "unknown":
      return {
        requirement: "command",
        acceptedKinds: ["test", "lint", "typecheck", "build", "run"],
        commands: [],
        reason: "Unknown task kind uses conservative project command verification after mutation.",
      };
  }
}

export function decideVerificationPolicyForContext(
  context: VerificationPolicyContext,
): VerificationPolicyDecision {
  if (context.forceFullGate || context.taskKind === "release_task") {
    return decideVerificationPolicy("release_task");
  }

  const docsOnly = context.hasDocsMutations === true && context.hasCodeMutations !== true;
  if (docsOnly) {
    return decideVerificationPolicy("docs_change");
  }

  return decideVerificationPolicy(context.taskKind ?? "unknown");
}

export function inferTaskKindFromPrompt(prompt: string): TaskKind {
  const normalized = prompt.toLowerCase();
  if (containsAny(normalized, ["review", "ревью", "code review", "посмотри изменения"])) return "review";
  if (
    containsAny(normalized, [
      "from scratch",
      "new project",
      "create project",
      "cli project",
      "cli-проект",
      "с нуля",
      "создай проект",
      "создать проект",
      "сделай проект",
      "приложение",
    ])
  ) {
    return "feature";
  }
  if (containsAny(normalized, ["lint", "biome", "линт"])) return "lint_failure";
  if (containsAny(normalized, ["test", "tests", "тест", "тесты", "тестов", "падает тест"])) return "test_failure";
  if (containsAny(normalized, ["refactor", "рефактор"])) return "refactor";
  if (containsAny(normalized, ["add", "support", "feature", "добавь", "поддержк"])) return "feature";
  if (containsAny(normalized, ["fix", "bug", "почини", "исправь", "падает", "ошибк"])) return "bug_fix";
  if (containsAny(normalized, ["readme", "docs", "documentation", "документац", "доки", "доках", "roadmap"])) {
    return "docs_change";
  }
  if (containsAny(normalized, ["what", "why", "how", "что", "почему", "как"])) return "read_only_question";
  return "unknown";
}

export function allowsUnverifiedCompletion(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return containsAny(normalized, [
    "skip verification",
    "skip tests",
    "without verification",
    "unverified",
    "не проверяй",
    "без проверки",
    "без проверок",
    "можно без тестов",
  ]);
}

export function verificationKindFromCommand(command: string): VerificationKind | null {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (isNonVerificationProbeCommand(normalized)) return null;
  if (isClearlyNotShellExecution(command, normalized)) return null;
  if (/\bgit\s+(diff|show|status)\b/.test(normalized)) return "diff_inspection";
  if (/\b(tsc|typecheck|pyright|mypy)\b/.test(normalized)) return "typecheck";
  if (/\b(biome|lint)\b/.test(normalized) || /\bruff\s+(check|format\s+--check)\b/.test(normalized)) return "lint";
  if (isTestCommand(normalized)) return "test";
  if (/\bbuild\b/.test(normalized)) return "build";
  if (/\b(run|start|dev)\b/.test(normalized)) return "run";
  return "run";
}

function isClearlyNotShellExecution(command: string, normalized: string): boolean {
  if (/[\u2500-\u257f]/u.test(command)) return true;

  const firstToken = normalized.split(/\s+/)[0] ?? "";
  if (firstToken === "." || firstToken === "..") return true;
  if (!normalized.includes(" ") && !isKnownVerificationExecutable(firstToken) && !/^(?:\.{1,2}\/|~\/|[a-z]:\\)/i.test(command)) {
    return true;
  }

  return false;
}

function isKnownVerificationExecutable(name: string): boolean {
  return [
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
    "test",
    "tsc",
    "pyright",
    "mypy",
  ].includes(name);
}

export function isNonVerificationProbeCommand(command: string): boolean {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (normalized.length === 0) return true;
  if (isRoutineInspectionShellCommand(normalized)) return true;
  if (hasHeadTailPipeline(normalized)) return true;
  if (hasMaskedVerificationExit(normalized)) return true;
  if (isFormattingMutationCommand(normalized)) return true;
  if (isShellUtilityOnlyCommand(normalized)) return true;
  if (isFileMutationOrSetupCommand(normalized)) return true;
  if (/(?:^|\s)(?:--help|--version|-h)(?:\s|$)/.test(normalized)) return true;
  if (/(?:^|\s)-v(?:\s|$)/.test(normalized) && !looksLikeVerificationExecution(normalized)) return true;
  if (/(?:^|[;&|]\s*)(?:which|command\s+-v|type|man)\s+/.test(normalized)) return true;
  if (/(?:^|[;&|]\s*)[^\s;&|]+\s+help(?:\s|$)/.test(normalized)) return true;
  return false;
}

function looksLikeVerificationExecution(command: string): boolean {
  return (
    /\b(tsc|typecheck|pyright|mypy)\b/.test(command) ||
    /\b(biome|lint)\b/.test(command) ||
    /\bruff\s+(check|format\s+--check)\b/.test(command) ||
    isTestCommand(command) ||
    /\bbuild\b/.test(command)
  );
}

function isTestCommand(command: string): boolean {
  return (
    /\b(test|spec)\b/.test(command) ||
    /\b(pytest|unittest|nosetests?|vitest|jest|mocha|ava)\b/.test(command) ||
    /\bgo\s+test\b/.test(command) ||
    /\bcargo\s+test\b/.test(command) ||
    /\bplaywright\s+test\b/.test(command) ||
    /\bcypress\s+run\b/.test(command)
  );
}

function isRoutineInspectionShellCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:pwd|ls|find|grep|rg|sed|cat|head|tail)\b/.test(command);
}

function hasHeadTailPipeline(command: string): boolean {
  return /\|\s*&?\s*(?:head|tail)\b/.test(command);
}

function hasMaskedVerificationExit(command: string): boolean {
  if (!looksLikeVerificationExecution(command)) return false;
  if (/\|\s*&?\s*tee\b/.test(command)) return true;
  if (/\$\{?pipestatus\b/.test(command)) return true;
  if (/;\s*(?:echo|printf)\b.*\bexit\b/.test(command)) return true;
  return false;
}

function isFormattingMutationCommand(command: string): boolean {
  if (/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?format\b/.test(command)) return true;
  if (/\bbiome\s+(?:check|format)\b/.test(command) && /\s--write(?:\s|$)/.test(command)) return true;
  if (/\bprettier\b/.test(command) && /\s--write(?:\s|$)/.test(command)) return true;
  if (/\bruff\s+format\b/.test(command) && !/\s--check(?:\s|$)/.test(command)) return true;
  if (/\bgo\s+fmt\b/.test(command)) return true;
  if (/\bcargo\s+fmt\b/.test(command)) return true;
  return false;
}

const SHELL_UTILITY_COMMANDS = new Set([
  "awk",
  "cat",
  "cut",
  "date",
  "echo",
  "env",
  "false",
  "find",
  "grep",
  "head",
  "ls",
  "printenv",
  "printf",
  "pwd",
  "rg",
  "sed",
  "sleep",
  "sort",
  "tail",
  "tee",
  "true",
  "uniq",
  "wc",
  "whoami",
  "xargs",
]);

const FILE_MUTATION_COMMANDS = new Set([
  "chmod",
  "chown",
  "cp",
  "ln",
  "mkdir",
  "mv",
  "rm",
  "rmdir",
  "tar",
  "touch",
  "unlink",
  "unzip",
  "zip",
]);

const SETUP_SUBCOMMANDS = new Set(["add", "create", "generate", "init", "install", "new", "scaffold"]);

function isShellUtilityOnlyCommand(command: string): boolean {
  const commands = commandSegments(command).map(leadingExecutable).filter((value): value is string => Boolean(value));
  return commands.length > 0 && commands.every((name) => SHELL_UTILITY_COMMANDS.has(name));
}

function isFileMutationOrSetupCommand(command: string): boolean {
  return commandSegments(command).some((segment) => {
    const words = commandWords(segment);
    const executable = words[0];
    if (!executable) return false;
    if (FILE_MUTATION_COMMANDS.has(executable)) return true;
    return words.some((word, index) => index > 0 && SETUP_SUBCOMMANDS.has(word));
  });
}

function commandSegments(command: string): string[] {
  return command.split(/&&|\|\||[;|]/).map((segment) => segment.trim()).filter(Boolean);
}

function leadingExecutable(segment: string): string | null {
  return commandWords(segment)[0] ?? null;
}

function commandWords(segment: string): string[] {
  return segment
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
    .map((word) => word.replace(/^["']|["']$/g, ""))
    .map((word) => {
      const slash = word.lastIndexOf("/");
      return slash === -1 ? word : word.slice(slash + 1);
    })
    .map((word) => word.toLowerCase());
}

export function isDocumentationPath(path: string): boolean {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("docs/") || normalized.includes("/docs/")) return true;
  return DOC_EXTENSIONS.has(extensionOf(normalized));
}

export function isCodePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return !isDocumentationPath(normalized);
}

function extensionOf(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot);
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
