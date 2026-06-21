import { sanitizePortableText } from "../capsules/sanitizer";
import type { CapsuleRelevanceResult, KnowledgeDocument, MemoryCapsule } from "./types";

const DEFAULT_MEMORY_TOKEN_BUDGET = 2_000;
const DEFAULT_KNOWLEDGE_TOKEN_RATIO = 0.7;

export interface ProjectMemorySource {
  getKnowledgeFiles(): KnowledgeDocument[];
  getRelevantCapsules(query: { text?: string; tags?: string[]; limit: number }): CapsuleRelevanceResult[];
}

export interface ProjectMemoryInjectionBudget {
  maxTokens: number;
  query?: string;
  maxCapsules?: number;
  knowledgeTokenBudget?: number;
  capsuleTokenBudget?: number;
}

interface SelectedCapsule {
  result: CapsuleRelevanceResult;
  rendered: string;
  tokens: number;
}

export function buildProjectMemorySection(
  memory: ProjectMemorySource,
  budget: number | ProjectMemoryInjectionBudget = DEFAULT_MEMORY_TOKEN_BUDGET,
): string {
  const normalizedBudget = normalizeBudget(budget);
  if (normalizedBudget.maxTokens <= 0) {
    return "";
  }

  const knowledgeSection = buildKnowledgeSection(memory.getKnowledgeFiles(), normalizedBudget.knowledgeTokenBudget);
  const remainingForCapsules = Math.max(0, normalizedBudget.maxTokens - knowledgeSection.tokens);
  const capsuleTokenBudget = Math.min(normalizedBudget.capsuleTokenBudget, remainingForCapsules);
  const capsulesSection = buildCapsulesSection(
    memory.getRelevantCapsules({
      text: normalizedBudget.query,
      limit: normalizedBudget.maxCapsules,
    }),
    capsuleTokenBudget,
  );

  const sections = [knowledgeSection.content, capsulesSection].filter((section) => section.length > 0);
  return sections.length > 0 ? sections.join("\n\n") : "";
}

function normalizeBudget(budget: number | ProjectMemoryInjectionBudget): Required<ProjectMemoryInjectionBudget> {
  if (typeof budget === "number") {
    const maxTokens = Math.max(0, budget);
    const knowledgeTokenBudget = Math.floor(maxTokens * DEFAULT_KNOWLEDGE_TOKEN_RATIO);
    return {
      maxTokens,
      query: "",
      maxCapsules: 10,
      knowledgeTokenBudget,
      capsuleTokenBudget: maxTokens - knowledgeTokenBudget,
    };
  }

  const maxTokens = Math.max(0, budget.maxTokens);
  const knowledgeTokenBudget = Math.max(0, budget.knowledgeTokenBudget ?? Math.floor(maxTokens * DEFAULT_KNOWLEDGE_TOKEN_RATIO));
  return {
    maxTokens,
    query: budget.query ?? "",
    maxCapsules: budget.maxCapsules ?? 10,
    knowledgeTokenBudget: Math.min(knowledgeTokenBudget, maxTokens),
    capsuleTokenBudget: Math.min(Math.max(0, budget.capsuleTokenBudget ?? maxTokens - knowledgeTokenBudget), maxTokens),
  };
}

function buildKnowledgeSection(documents: KnowledgeDocument[], tokenBudget: number): { content: string; tokens: number } {
  const renderedDocuments: string[] = [];
  let usedTokens = 0;

  for (const document of documents) {
    const content = sanitizeMemoryText(document.content).trim();
    if (content.length === 0) {
      continue;
    }

    const rendered = [
      `  <knowledge_file key="${escapeXmlAttribute(document.key)}" path="${escapeXmlAttribute(document.filename)}">`,
      indentXmlText(content, 4),
      "  </knowledge_file>",
    ].join("\n");
    const tokens = estimateMemoryTokens(rendered);
    if (usedTokens + tokens > tokenBudget) {
      continue;
    }

    renderedDocuments.push(rendered);
    usedTokens += tokens;
  }

  if (renderedDocuments.length === 0) {
    return {
      content: "",
      tokens: 0,
    };
  }

  const content = ["<project_knowledge>", ...renderedDocuments, "</project_knowledge>"].join("\n");
  return {
    content,
    tokens: estimateMemoryTokens(content),
  };
}

function buildCapsulesSection(results: CapsuleRelevanceResult[], tokenBudget: number): string {
  if (tokenBudget <= 0) {
    return "";
  }

  const selected: SelectedCapsule[] = [];
  let usedTokens = 0;

  for (const result of sortCapsulesForInjection(results)) {
    const rendered = renderCapsule(result.capsule);
    const tokens = estimateMemoryTokens(rendered);
    if (usedTokens + tokens > tokenBudget) {
      continue;
    }

    selected.push({ result, rendered, tokens });
    usedTokens += tokens;
  }

  if (selected.length === 0) {
    return "";
  }

  const capsules = selected
    .sort((a, b) => b.result.score - a.result.score || compareCapsulesDeterministically(a.result.capsule, b.result.capsule))
    .map((entry) => entry.rendered);

  return ["<project_memory>", ...capsules, "</project_memory>"].join("\n");
}

function sortCapsulesForInjection(results: CapsuleRelevanceResult[]): CapsuleRelevanceResult[] {
  return [...results].sort(
    (a, b) =>
      priorityWeight(b.capsule.priority) - priorityWeight(a.capsule.priority) ||
      b.score - a.score ||
      compareCapsulesDeterministically(a.capsule, b.capsule),
  );
}

function renderCapsule(capsule: MemoryCapsule): string {
  const tags = capsule.tags.length > 0 ? ` tags="${escapeXmlAttribute(capsule.tags.join(","))}"` : "";
  const lines = [
    `  <capsule id="${escapeXmlAttribute(capsule.id)}" type="${escapeXmlAttribute(capsule.type)}" priority="${escapeXmlAttribute(capsule.priority)}"${tags}>`,
    `    <summary>${escapeXmlText(sanitizeMemoryText(capsule.summary))}</summary>`,
  ];

  const detail = sanitizeMemoryText(capsule.detail).trim();
  if (detail.length > 0) {
    lines.push("    <detail>");
    lines.push(indentXmlText(detail, 6));
    lines.push("    </detail>");
  }

  lines.push(`    <context task="${escapeXmlAttribute(capsule.context.task)}" timestamp="${escapeXmlAttribute(capsule.context.timestamp)}" />`);
  lines.push("  </capsule>");
  return lines.join("\n");
}

function sanitizeMemoryText(text: string): string {
  return sanitizePortableText(text).replace(/\$\{ENV:([A-Z_][A-Z0-9_]*)\}/g, "[REDACTED:env_placeholder]");
}

function indentXmlText(text: string, spaces: number): string {
  const padding = " ".repeat(spaces);
  return escapeXmlText(text)
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function estimateMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function priorityWeight(priority: MemoryCapsule["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function compareCapsulesDeterministically(a: MemoryCapsule, b: MemoryCapsule): number {
  return b.context.timestamp.localeCompare(a.context.timestamp) || a.id.localeCompare(b.id);
}
