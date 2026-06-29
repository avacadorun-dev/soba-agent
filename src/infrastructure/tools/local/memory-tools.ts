import { basename, relative, resolve } from "node:path";
import { detectPotentialSecret, sanitizePortableText } from "../../../application/capsules/sanitizer";
import {
  type CapsuleListFilters,
  type CapsulePriority,
  type CapsuleType,
  KNOWLEDGE_KEYS,
  type KnowledgeDocument,
  type KnowledgeKey,
  type MemoryCapsule,
  type MemoryCapsuleInput,
} from "../../../engine/memory/types";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { ProjectMemory } from "../../persistence/memory/project-memory";

export const READ_PROJECT_MEMORY_TOOL_NAME = "read_project_memory";
export const WRITE_PROJECT_MEMORY_TOOL_NAME = "write_project_memory";

const DEFAULT_MAX_ITEMS = 20;
const MAX_ITEMS_LIMIT = 100;
const DEFAULT_MAX_BYTES = 24 * 1024;
const MAX_BYTES_LIMIT = 128 * 1024;
const DEFAULT_ENTRY_CONTENT_BYTES = 4 * 1024;
const ENV_PLACEHOLDER_PATTERN = /\$\{ENV:[a-zA-Z_][a-zA-Z0-9_]*\}/;
const CAPSULE_EXAMPLE =
  '{"target":"capsule","capsule":{"type":"decision","summary":"Short durable fact","detail":"Specific reusable context.","priority":"high","tags":["architecture"]}}';
const CAPSULE_TYPES: CapsuleType[] = ["decision", "error_fix", "discovery", "pattern", "blocker", "insight"];
const CAPSULE_PRIORITIES: CapsulePriority[] = ["critical", "high", "medium", "low"];

export type ReadProjectMemoryKind = "all" | "knowledge" | "capsules";
export type WriteProjectMemoryTarget = "capsule" | "knowledge";
export type KnowledgeWriteMode = "replace" | "append";

export interface ReadProjectMemoryArgs {
  kind?: ReadProjectMemoryKind;
  query?: string;
  tags?: string[];
  capsuleType?: CapsuleType;
  priority?: CapsulePriority | CapsulePriority[];
  from?: string;
  to?: string;
  knowledgeKey?: KnowledgeKey;
  includeContent?: boolean;
  limit?: number;
  maxBytes?: number;
}

export interface WriteProjectMemoryArgs {
  target: WriteProjectMemoryTarget;
  capsule?: MemoryCapsuleInput;
  knowledge?: {
    key: KnowledgeKey;
    content: string;
    mode?: KnowledgeWriteMode;
    path?: string;
  };
}

export interface ReadProjectMemoryResult {
  kind: ReadProjectMemoryKind;
  knowledge: NormalizedKnowledgeDocument[];
  capsules: NormalizedMemoryCapsule[];
  truncated: boolean;
  limit: number;
}

export interface WriteProjectMemoryResult {
  target: WriteProjectMemoryTarget;
  id?: string;
  key?: KnowledgeKey;
  path?: string;
  bytes: number;
}

interface NormalizedKnowledgeDocument {
  key: KnowledgeKey;
  filename: string;
  title: string;
  estimatedTokens: number;
  content?: string;
  truncated?: boolean;
}

interface NormalizedMemoryCapsule {
  id: string;
  type: CapsuleType;
  summary: string;
  priority: CapsulePriority;
  tags: string[];
  timestamp: string;
  detail?: string;
  score?: number;
  truncated?: boolean;
}

export type MemoryToolErrorCode =
  | "invalid_arguments"
  | "invalid_path"
  | "invalid_secret"
  | "unsupported_target"
  | "memory_operation_failed";

export class MemoryToolError extends Error {
  readonly code: MemoryToolErrorCode;

  constructor(code: MemoryToolErrorCode, message: string) {
    super(message);
    this.name = "MemoryToolError";
    this.code = code;
  }
}

export function createMemoryTools(options: { createMemory?: (context: ToolContext) => ProjectMemory } = {}): Array<ToolDefinition<Record<string, unknown>>> {
  const createMemory = options.createMemory ?? ((context: ToolContext) => new ProjectMemory({ projectRoot: context.cwd }));

  return [
    {
      name: READ_PROJECT_MEMORY_TOOL_NAME,
      label: "read project memory",
      description:
        "Read bounded project memory through the managed memory API, not general project files. Supports knowledge/capsule filtering by tags, capsule type, priority, date range and query. Output is sanitized and size-limited.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["all", "knowledge", "capsules"],
            description: "Memory layer to read. Defaults to all.",
          },
          query: {
            type: "string",
            description: "Relevance query for capsules.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Capsule tags that must all match.",
          },
          capsuleType: {
            type: "string",
            enum: ["decision", "error_fix", "discovery", "pattern", "blocker", "insight"],
            description: "Capsule type filter.",
          },
          priority: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Capsule priority filter.",
          },
          from: {
            type: "string",
            description: "Inclusive ISO timestamp lower bound for capsules.",
          },
          to: {
            type: "string",
            description: "Inclusive ISO timestamp upper bound for capsules.",
          },
          knowledgeKey: {
            type: "string",
            enum: [...KNOWLEDGE_KEYS],
            description: "Knowledge file key filter.",
          },
          includeContent: {
            type: "boolean",
            description: "Include knowledge content and capsule detail. Defaults to true.",
          },
          limit: {
            type: "number",
            description: "Maximum number of entries per layer. Hard-capped at 100.",
          },
          maxBytes: {
            type: "number",
            description: "Maximum JSON output bytes. Hard-capped at 128KB.",
          },
        },
        additionalProperties: false,
      },
      toolType: "function",
      async execute(args, context, signal): Promise<ToolResult> {
        if (signal?.aborted) {
          return errorToolResult("invalid_arguments", "Operation aborted.");
        }

        return executeMemoryTool(() => readProjectMemory(createMemory(context), normalizeReadArgs(args)));
      },
    },
    {
      name: WRITE_PROJECT_MEMORY_TOOL_NAME,
      label: "write project memory",
      description:
        "Write project memory through the managed memory API. Can create a memory capsule or replace/append one allowed knowledge file inside .soba/memory. Rejects secret-like content and path traversal. Never use write/edit/bash to modify .soba/memory directly.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["capsule", "knowledge"],
            description: "Write target.",
          },
          capsule: {
            type: "object",
            description:
              `Capsule payload when target=capsule. Required fields: type, summary, detail, priority. Example: ${CAPSULE_EXAMPLE}`,
            properties: {
              type: {
                type: "string",
                enum: CAPSULE_TYPES,
                description: "Capsule type.",
              },
              summary: {
                type: "string",
                description: "One concise durable memory sentence.",
              },
              detail: {
                type: "string",
                description: "Specific reusable context for future agents.",
              },
              priority: {
                type: "string",
                enum: CAPSULE_PRIORITIES,
                description: "Memory priority.",
              },
              tags: {
                type: "array",
                description: "Search tags.",
                items: { type: "string" },
              },
              related: {
                type: "array",
                description: "Related memory capsule ids.",
                items: { type: "string" },
              },
              context: {
                type: "object",
                description: "Optional task/session/timestamp context.",
                additionalProperties: true,
              },
            },
            required: ["type", "summary", "detail", "priority"],
            additionalProperties: true,
          },
          knowledge: {
            type: "object",
            description: "Knowledge write payload when target=knowledge.",
            additionalProperties: true,
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      toolType: "function",
      async execute(args, context, signal): Promise<ToolResult> {
        if (signal?.aborted) {
          return errorToolResult("invalid_arguments", "Operation aborted.");
        }

        return executeMemoryTool(() => writeProjectMemory(createMemory(context), normalizeWriteArgs(args), context.cwd));
      },
    },
  ];
}

export function readProjectMemory(memory: ProjectMemory, args: ReadProjectMemoryArgs = {}): ReadProjectMemoryResult {
  const kind = args.kind ?? "all";
  const limit = clampInteger(args.limit, DEFAULT_MAX_ITEMS, 1, MAX_ITEMS_LIMIT);
  const maxBytes = clampInteger(args.maxBytes, DEFAULT_MAX_BYTES, 1_024, MAX_BYTES_LIMIT);
  const includeContent = args.includeContent ?? true;

  memory.initialize();

  const knowledge =
    kind === "all" || kind === "knowledge"
      ? memory
          .getKnowledgeFiles()
          .filter((document) => !args.knowledgeKey || document.key === args.knowledgeKey)
          .slice(0, limit)
          .map((document) => normalizeKnowledgeDocument(document, includeContent))
      : [];

  const capsules =
    kind === "all" || kind === "capsules"
      ? readCapsules(memory, args, limit).map((capsule) => normalizeCapsule(capsule, includeContent))
      : [];

  return boundReadResult(
    {
      kind,
      knowledge,
      capsules,
      truncated: false,
      limit,
    },
    maxBytes,
  );
}

export function writeProjectMemory(memory: ProjectMemory, args: WriteProjectMemoryArgs, projectRoot: string): WriteProjectMemoryResult {
  memory.initialize();

  switch (args.target) {
    case "capsule": {
      if (!args.capsule) {
        throw new MemoryToolError(
          "invalid_arguments",
          `write_project_memory target=capsule requires a non-empty capsule payload. Required fields: type, summary, detail, priority. Example: ${CAPSULE_EXAMPLE}`,
        );
      }

      assertValidCapsuleInput(args.capsule);
      assertNoSecretLikeContent(args.capsule);
      const capsule = memory.addCapsule(args.capsule);
      return {
        target: "capsule",
        id: capsule.id,
        bytes: Buffer.byteLength(JSON.stringify(capsule), "utf-8"),
      };
    }
    case "knowledge": {
      if (!args.knowledge) {
        throw new MemoryToolError("invalid_arguments", "write_project_memory target=knowledge requires a knowledge payload.");
      }

      assertKnowledgeKey(args.knowledge.key);
      assertNoSecretLikeContent(args.knowledge.content);
      assertAllowedKnowledgePath(memory, projectRoot, args.knowledge.key, args.knowledge.path);

      const store = memory.getStores().knowledge;
      const mode = args.knowledge.mode ?? "replace";
      const document = mode === "append" ? store.append(args.knowledge.key, args.knowledge.content) : store.write(args.knowledge.key, args.knowledge.content);

      return {
        target: "knowledge",
        key: document.key,
        path: document.path,
        bytes: Buffer.byteLength(document.content, "utf-8"),
      };
    }
    default:
      throw new MemoryToolError("unsupported_target", `Unsupported project memory write target: ${String(args.target)}.`);
  }
}

function readCapsules(memory: ProjectMemory, args: ReadProjectMemoryArgs, limit: number): Array<MemoryCapsule & { score?: number }> {
  const filters: CapsuleListFilters = {
    ...(args.capsuleType ? { type: args.capsuleType } : {}),
    ...(args.tags ? { tags: args.tags } : {}),
    ...(args.priority ? { priority: args.priority } : {}),
    ...(args.from ? { from: args.from } : {}),
    ...(args.to ? { to: args.to } : {}),
  };

  if (args.query && args.query.trim().length > 0) {
    return memory
      .getRelevantCapsules({
        text: args.query,
        tags: args.tags,
        limit,
      })
      .map((result) => ({
        ...result.capsule,
        score: result.score,
      }))
      .filter((capsule) => capsuleMatchesFilters(capsule, filters))
      .slice(0, limit);
  }

  return memory.getStores().capsules.list(filters).slice(0, limit);
}

function normalizeKnowledgeDocument(document: KnowledgeDocument, includeContent: boolean): NormalizedKnowledgeDocument {
  const normalized: NormalizedKnowledgeDocument = {
    key: document.key,
    filename: document.filename,
    title: document.title,
    estimatedTokens: document.estimatedTokens,
  };

  if (includeContent) {
    const truncated = truncateString(sanitizeMemoryText(document.content), DEFAULT_ENTRY_CONTENT_BYTES);
    normalized.content = truncated.text;
    normalized.truncated = truncated.truncated;
  }

  return normalized;
}

function normalizeCapsule(capsule: MemoryCapsule & { score?: number }, includeContent: boolean): NormalizedMemoryCapsule {
  const normalized: NormalizedMemoryCapsule = {
    id: capsule.id,
    type: capsule.type,
    summary: sanitizeMemoryText(capsule.summary),
    priority: capsule.priority,
    tags: [...capsule.tags],
    timestamp: capsule.context.timestamp,
    ...(typeof capsule.score === "number" ? { score: capsule.score } : {}),
  };

  if (includeContent) {
    const truncated = truncateString(sanitizeMemoryText(capsule.detail), DEFAULT_ENTRY_CONTENT_BYTES);
    normalized.detail = truncated.text;
    normalized.truncated = truncated.truncated;
  }

  return normalized;
}

function boundReadResult(result: ReadProjectMemoryResult, maxBytes: number): ReadProjectMemoryResult {
  let bounded = shrinkLargeEntries(result, maxBytes, Math.min(512, Math.max(128, Math.floor(maxBytes / 4))));
  while (Buffer.byteLength(JSON.stringify(bounded), "utf-8") > maxBytes && (bounded.knowledge.length > 0 || bounded.capsules.length > 0)) {
    bounded = {
      ...bounded,
      truncated: true,
      knowledge: bounded.knowledge.length >= bounded.capsules.length ? bounded.knowledge.slice(0, -1) : bounded.knowledge,
      capsules: bounded.capsules.length > bounded.knowledge.length ? bounded.capsules.slice(0, -1) : bounded.capsules,
    };
  }

  return bounded;
}

function shrinkLargeEntries(result: ReadProjectMemoryResult, maxBytes: number, maxContentBytes: number): ReadProjectMemoryResult {
  if (Buffer.byteLength(JSON.stringify(result), "utf-8") <= maxBytes) {
    return result;
  }

  return {
    ...result,
    truncated: true,
    knowledge: result.knowledge.map((document) => {
      if (!document.content) {
        return document;
      }

      const truncated = truncateString(document.content, maxContentBytes);
      return {
        ...document,
        content: truncated.text,
        truncated: document.truncated || truncated.truncated,
      };
    }),
    capsules: result.capsules.map((capsule) => {
      if (!capsule.detail) {
        return capsule;
      }

      const truncated = truncateString(capsule.detail, maxContentBytes);
      return {
        ...capsule,
        detail: truncated.text,
        truncated: capsule.truncated || truncated.truncated,
      };
    }),
  };
}

function normalizeReadArgs(raw: Record<string, unknown>): ReadProjectMemoryArgs {
  return {
    ...(isReadKind(raw.kind) ? { kind: raw.kind } : {}),
    ...(typeof raw.query === "string" ? { query: raw.query } : {}),
    ...(isStringArray(raw.tags) ? { tags: raw.tags } : {}),
    ...(isCapsuleType(raw.capsuleType) ? { capsuleType: raw.capsuleType } : {}),
    ...(isCapsulePriority(raw.priority) ? { priority: raw.priority } : {}),
    ...(typeof raw.from === "string" ? { from: raw.from } : {}),
    ...(typeof raw.to === "string" ? { to: raw.to } : {}),
    ...(isKnowledgeKey(raw.knowledgeKey) ? { knowledgeKey: raw.knowledgeKey } : {}),
    ...(typeof raw.includeContent === "boolean" ? { includeContent: raw.includeContent } : {}),
    ...(typeof raw.limit === "number" ? { limit: raw.limit } : {}),
    ...(typeof raw.maxBytes === "number" ? { maxBytes: raw.maxBytes } : {}),
  };
}

function normalizeWriteArgs(raw: Record<string, unknown>): WriteProjectMemoryArgs {
  if (raw.target !== "capsule" && raw.target !== "knowledge") {
    throw new MemoryToolError("invalid_arguments", "write_project_memory target must be either capsule or knowledge.");
  }

  return {
    target: raw.target,
    ...(isRecord(raw.capsule) ? { capsule: raw.capsule as unknown as MemoryCapsuleInput } : {}),
    ...(isRecord(raw.knowledge) ? { knowledge: raw.knowledge as WriteProjectMemoryArgs["knowledge"] } : {}),
  };
}

function executeMemoryTool(run: () => ReadProjectMemoryResult | WriteProjectMemoryResult): ToolResult {
  try {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(run(), null, 2),
        },
      ],
      isError: false,
    };
  } catch (error) {
    if (error instanceof MemoryToolError) {
      return errorToolResult(error.code, error.message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errorToolResult("memory_operation_failed", message);
  }
}

function errorToolResult(code: MemoryToolErrorCode, message: string): ToolResult {
  const category = code === "memory_operation_failed" ? "unknown" : "validation";
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code, message } }, null, 2),
      },
    ],
    isError: true,
    error: {
      code,
      category,
      retryable: false,
      nextAction: nextActionForMemoryError(code),
      fingerprint: `${category}:${code}`,
    },
    details: { code },
  };
}

function nextActionForMemoryError(code: MemoryToolErrorCode): string {
  switch (code) {
    case "invalid_arguments":
      return `Fix the write_project_memory arguments before retrying. For target=capsule use ${CAPSULE_EXAMPLE}`;
    case "invalid_path":
      return "Use only the allowed project memory knowledge path for the selected key.";
    case "invalid_secret":
      return "Remove secrets or env placeholders before writing project memory.";
    case "unsupported_target":
      return "Use target=capsule or target=knowledge.";
    case "memory_operation_failed":
      return "Inspect the error and change the memory payload or use read_project_memory before retrying.";
  }
}

function assertNoSecretLikeContent(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (detectPotentialSecret(serialized) || ENV_PLACEHOLDER_PATTERN.test(serialized)) {
    throw new MemoryToolError("invalid_secret", "Project memory write rejected because content appears to contain a secret or env placeholder.");
  }
}

function assertValidCapsuleInput(capsule: MemoryCapsuleInput): void {
  const missingFields: string[] = [];
  if (typeof capsule.type !== "string") missingFields.push("type");
  if (typeof capsule.summary !== "string" || capsule.summary.trim().length === 0) missingFields.push("summary");
  if (typeof capsule.detail !== "string" || capsule.detail.trim().length === 0) missingFields.push("detail");
  if (typeof capsule.priority !== "string") missingFields.push("priority");

  if (missingFields.length > 0) {
    throw new MemoryToolError(
      "invalid_arguments",
      `write_project_memory target=capsule received an incomplete capsule payload. Missing or empty fields: ${missingFields.join(", ")}. Example: ${CAPSULE_EXAMPLE}`,
    );
  }

  if (!CAPSULE_TYPES.includes(capsule.type)) {
    throw new MemoryToolError(
      "invalid_arguments",
      `Invalid memory capsule type "${capsule.type}". Allowed values: ${CAPSULE_TYPES.join(", ")}. Example: ${CAPSULE_EXAMPLE}`,
    );
  }
  if (!CAPSULE_PRIORITIES.includes(capsule.priority)) {
    throw new MemoryToolError(
      "invalid_arguments",
      `Invalid memory capsule priority "${capsule.priority}". Allowed values: ${CAPSULE_PRIORITIES.join(", ")}. Example: ${CAPSULE_EXAMPLE}`,
    );
  }
  if (capsule.tags !== undefined && !Array.isArray(capsule.tags)) {
    throw new MemoryToolError("invalid_arguments", "Memory capsule tags must be an array of strings.");
  }
  if (capsule.tags?.some((tag) => typeof tag !== "string")) {
    throw new MemoryToolError("invalid_arguments", "Memory capsule tags must be strings.");
  }
  if (capsule.related !== undefined && !Array.isArray(capsule.related)) {
    throw new MemoryToolError("invalid_arguments", "Memory capsule related must be an array of capsule ids.");
  }
  if (capsule.related?.some((id) => typeof id !== "string")) {
    throw new MemoryToolError("invalid_arguments", "Memory capsule related ids must be strings.");
  }
}

function assertAllowedKnowledgePath(memory: ProjectMemory, projectRoot: string, key: KnowledgeKey, path: string | undefined): void {
  if (!path) {
    return;
  }

  const memoryDir = memory.getMemoryDir();
  const requestedPath = resolveMemoryPath(projectRoot, memoryDir, path);
  assertInsideDirectory(memoryDir, requestedPath);

  const expectedPath = resolve(memory.getStores().knowledge.read(key).path);
  if (requestedPath !== expectedPath || basename(requestedPath) !== basename(expectedPath)) {
    throw new MemoryToolError("invalid_path", `Knowledge path must target the allowed file for key "${key}" inside .soba/memory.`);
  }
}

function resolveMemoryPath(projectRoot: string, memoryDir: string, inputPath: string): string {
  if (resolve(inputPath) === inputPath) {
    return resolve(inputPath);
  }
  if (inputPath === ".soba" || inputPath.startsWith(".soba/")) {
    return resolve(projectRoot, inputPath);
  }

  return resolve(memoryDir, inputPath);
}

function assertInsideDirectory(baseDir: string, targetPath: string): void {
  const relativePath = relative(resolve(baseDir), resolve(targetPath));
  if (relativePath === "" || relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
    throw new MemoryToolError("invalid_path", "Project memory write path must stay inside .soba/memory.");
  }
}

function assertKnowledgeKey(value: unknown): asserts value is KnowledgeKey {
  if (!isKnowledgeKey(value)) {
    throw new MemoryToolError("invalid_arguments", `Unknown project memory knowledge key: ${String(value)}.`);
  }
}

function capsuleMatchesFilters(capsule: MemoryCapsule, filters: CapsuleListFilters): boolean {
  if (filters.type && capsule.type !== filters.type) {
    return false;
  }
  if (filters.tags && filters.tags.length > 0 && !filters.tags.every((tag) => capsule.tags.includes(tag.toLowerCase()))) {
    return false;
  }
  if (filters.priority) {
    const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    if (!priorities.includes(capsule.priority)) {
      return false;
    }
  }
  if (filters.from && Date.parse(capsule.context.timestamp) < Date.parse(filters.from)) {
    return false;
  }
  if (filters.to && Date.parse(capsule.context.timestamp) > Date.parse(filters.to)) {
    return false;
  }
  return true;
}

function sanitizeMemoryText(text: string): string {
  return sanitizePortableText(text, { homeDirectory: process.env.HOME ?? null }).replace(
    /\$\{ENV:([A-Z_][A-Z0-9_]*)\}/g,
    "[REDACTED:env_placeholder]",
  );
}

function truncateString(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) {
    return { text, truncated: false };
  }

  return {
    text: new TextDecoder().decode(Buffer.from(text, "utf-8").subarray(0, maxBytes)),
    truncated: true,
  };
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isReadKind(value: unknown): value is ReadProjectMemoryKind {
  return value === "all" || value === "knowledge" || value === "capsules";
}

function isKnowledgeKey(value: unknown): value is KnowledgeKey {
  return typeof value === "string" && KNOWLEDGE_KEYS.includes(value as KnowledgeKey);
}

function isCapsuleType(value: unknown): value is CapsuleType {
  return value === "decision" || value === "error_fix" || value === "discovery" || value === "pattern" || value === "blocker" || value === "insight";
}

function isCapsulePriority(value: unknown): value is CapsulePriority {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
