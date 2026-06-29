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

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);

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
        acceptedKinds: ["lint"],
        commands: [],
        reason: "Lint-failure work must finish with passing lint evidence discovered from the project.",
      };
    case "test_failure":
      return {
        requirement: "command",
        acceptedKinds: ["test"],
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
        acceptedKinds: ["test", "lint", "typecheck", "build"],
        commands: [],
        reason: "Feature and refactor work require project command verification.",
      };
    case "release_task":
      return {
        requirement: "full_gate",
        acceptedKinds: ["test", "lint", "typecheck", "build"],
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
  if (/\bgit\s+(diff|show|status)\b/.test(normalized)) return "diff_inspection";
  if (/\b(tsc|typecheck|pyright|mypy)\b/.test(normalized)) return "typecheck";
  if (/\b(biome|lint)\b/.test(normalized) || /\bruff\s+(check|format\s+--check)\b/.test(normalized)) return "lint";
  if (isTestCommand(normalized)) return "test";
  if (/\bbuild\b/.test(normalized)) return "build";
  if (/\b(run|start|dev)\b/.test(normalized)) return "run";
  return null;
}

export function isNonVerificationProbeCommand(command: string): boolean {
  const normalized = normalizeWhitespace(command).toLowerCase();
  if (normalized.length === 0) return true;
  if (isRoutineInspectionShellCommand(normalized)) return true;
  if (hasHeadTailPipeline(normalized)) return true;
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

export function isDocumentationPath(path: string): boolean {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("docs/") || normalized.includes("/docs/")) return true;
  return DOC_EXTENSIONS.has(extensionOf(normalized));
}

export function isCodePath(path: string): boolean {
  const normalized = path.toLowerCase();
  if (isDocumentationPath(normalized)) return false;
  if (
    normalized.startsWith("src/") ||
    normalized.startsWith("tests/") ||
    normalized.includes("/src/") ||
    normalized.includes("/tests/")
  ) {
    return true;
  }
  return CODE_EXTENSIONS.has(extensionOf(normalized));
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
