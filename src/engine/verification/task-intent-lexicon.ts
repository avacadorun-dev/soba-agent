import type { TaskKind } from "./verification-policy";

export type TaskIntent =
  | "review"
  | "project_creation"
  | "lint_failure"
  | "test_failure"
  | "refactor"
  | "code_change"
  | "feature"
  | "bug_fix"
  | "docs_change"
  | "read_only_question";

export type TaskIntentLexiconExtension = Partial<Record<TaskIntent, readonly string[]>>;

/**
 * Built-in multilingual hints for prompt-only classification.
 *
 * Correctness never depends on a match: unknown prompts use the conservative
 * command-verification policy, and mutation context can refine the decision.
 * Integrations may extend every intent with additional languages or domain
 * vocabulary without changing the classifier.
 */
export const DEFAULT_TASK_INTENT_LEXICON: Readonly<Record<TaskIntent, readonly string[]>> = {
  review: ["review", "code review", "ревью", "посмотри изменения", "审查", "代码审查"],
  project_creation: [
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
    "从零开始",
    "创建新项目",
    "全新项目",
    "创建项目",
  ],
  lint_failure: ["lint", "biome", "линт", "代码检查失败", "静态检查失败"],
  test_failure: ["test", "tests", "тест", "тесты", "тестов", "падает тест", "测试", "测试失败"],
  refactor: ["refactor", "рефактор", "重构"],
  code_change: [
    "build",
    "change",
    "implement",
    "update",
    "write",
    "edit",
    "debug",
    "создай",
    "измени",
    "обнови",
    "напиши",
    "проверь",
    "сделай",
    "创建",
    "更改",
    "实现",
    "更新",
    "编写",
    "调试",
  ],
  feature: ["add", "support", "feature", "добавь", "поддержк", "添加", "支持", "功能"],
  bug_fix: ["fix", "bug", "почини", "исправь", "падает", "ошибк", "修复", "错误", "故障"],
  docs_change: [
    "readme",
    "docs",
    "documentation",
    "документац",
    "доки",
    "доках",
    "roadmap",
    "文档",
    "说明文档",
    "路线图",
  ],
  read_only_question: ["what", "why", "how", "что", "почему", "как", "什么", "为什么", "如何", "怎么"],
};

export const DEFAULT_UNVERIFIED_COMPLETION_PHRASES = [
  "skip verification",
  "skip tests",
  "without verification",
  "unverified",
  "не проверяй",
  "без проверки",
  "без проверок",
  "можно без тестов",
  "跳过验证",
  "无需验证",
  "跳过测试",
  "不用测试",
] as const;

export const DEFAULT_FULL_VERIFICATION_PHRASES = [
  "full gate",
  "full verification",
  "release",
  "перед коммит",
  "полный gate",
  "полную провер",
  "完整验证",
  "完整检查",
  "发布检查",
  "发布前",
] as const;

export const ORDERED_TASK_INTENTS: ReadonlyArray<readonly [TaskIntent, TaskKind]> = [
  ["review", "review"],
  ["project_creation", "feature"],
  ["lint_failure", "lint_failure"],
  ["test_failure", "test_failure"],
  ["refactor", "refactor"],
  ["docs_change", "docs_change"],
  ["feature", "feature"],
  ["bug_fix", "bug_fix"],
  ["code_change", "code_change"],
  ["read_only_question", "read_only_question"],
];

export function intentPhrases(
  intent: TaskIntent,
  extension: TaskIntentLexiconExtension = {},
): readonly string[] {
  return [...DEFAULT_TASK_INTENT_LEXICON[intent], ...(extension[intent] ?? [])];
}
