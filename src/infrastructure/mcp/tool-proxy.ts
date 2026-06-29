import { createHash } from "node:crypto";
import type { JsonSchema, JsonSchemaProperty, ToolDefinition, ToolResult } from "../../kernel/tools/types";
import type { McpClient, McpTool, McpToolCallResult } from "./client";
import { createDefaultMcpServerSecurity, type McpServerSecurity, redactMcpSensitiveText } from "./security";

export const MCP_TOOL_PROXY_PREFIX = "mcp";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const TRUNCATION_MARKER = "[MCP output truncated";

export interface McpToolProxySource {
  getServerIds(): string[];
  getClient(serverId: string): Promise<McpClient>;
  getServerSecurity?(serverId: string): McpServerSecurity;
}

export interface McpToolProxyOptions {
  maxOutputBytes?: number;
}

export interface McpToolProxyMapping {
  proxyName: string;
  displayName: string;
  serverId: string;
  toolName: string;
  collisionIndex: number;
}

interface ToolBuildEntry {
  serverId: string;
  tool: McpTool;
  security: McpServerSecurity;
}

export async function buildMcpToolDefinitions(source: McpToolProxySource, options: McpToolProxyOptions = {}): Promise<Array<ToolDefinition<Record<string, unknown>>>> {
  return buildMcpToolDefinitionsForServers(source, source.getServerIds(), options);
}

export async function buildMcpToolDefinitionsForServers(
  source: McpToolProxySource,
  serverIds: string[],
  options: McpToolProxyOptions = {},
): Promise<Array<ToolDefinition<Record<string, unknown>>>> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const entries: ToolBuildEntry[] = [];

  for (const serverId of serverIds) {
    const client = await source.getClient(serverId);
    const tools = await client.listTools();
    for (const tool of tools) {
      entries.push({
        serverId,
        tool,
        security: source.getServerSecurity?.(serverId) ?? createDefaultMcpServerSecurity(serverId),
      });
    }
  }

  const mappings = createProxyMappings(entries);
  return entries.map((entry, index) => createToolDefinition(source, entry, mappings[index] as McpToolProxyMapping, maxOutputBytes));
}

export function proxyToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PROXY_PREFIX}_${sanitizeToolNamePart(serverId)}_${sanitizeToolNamePart(toolName)}`;
}

export function displayMcpToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PROXY_PREFIX}.${serverId}.${toolName}`;
}

export function mapMcpInputSchema(inputSchema: unknown): JsonSchema {
  if (!isRecord(inputSchema) || inputSchema.type !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }

  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const mappedProperties: Record<string, JsonSchemaProperty> = {};
  for (const [key, value] of Object.entries(properties)) {
    mappedProperties[key] = mapJsonSchemaProperty(value);
  }

  const required = Array.isArray(inputSchema.required) ? inputSchema.required.filter((value): value is string => typeof value === "string") : undefined;

  return {
    type: "object",
    properties: mappedProperties,
    ...(required && required.length > 0 ? { required } : {}),
    ...(typeof inputSchema.additionalProperties === "boolean" ? { additionalProperties: inputSchema.additionalProperties } : { additionalProperties: true }),
  };
}

export function normalizeMcpToolResult(result: McpToolCallResult, options: { maxOutputBytes?: number } = {}): ToolResult {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const rendered = renderMcpResult(result);
  const truncated = truncateMcpOutput(rendered, maxOutputBytes);

  return {
    content: [
      {
        type: "text",
        text: truncated.text,
      },
    ],
    isError: result.isError === true,
    details: {
      mcp: {
        isError: result.isError === true,
        resultType: result.resultType,
        ttlMs: result.ttlMs,
        cacheScope: result.cacheScope,
        structuredContent: result.structuredContent,
        truncated: truncated.truncated,
        originalBytes: truncated.originalBytes,
      },
    },
  };
}

function createToolDefinition(
  source: McpToolProxySource,
  entry: ToolBuildEntry,
  mapping: McpToolProxyMapping,
  maxOutputBytes: number,
): ToolDefinition<Record<string, unknown>> {
  const effectiveMaxOutputBytes = entry.security.maxOutputBytes ?? maxOutputBytes;
  return {
    name: mapping.proxyName,
    label: mapping.displayName,
    description: entry.tool.description ?? `MCP tool ${entry.tool.name} from server ${entry.serverId}.`,
    parameters: mapMcpInputSchema(entry.tool.inputSchema),
    toolType: "function",
    async execute(args, _context, signal): Promise<ToolResult> {
      try {
        const client = await source.getClient(entry.serverId);
        const result = await client.callTool(entry.tool.name, args, { signal, timeoutMs: entry.security.timeoutMs });
        return normalizeMcpToolResult(result, { maxOutputBytes: effectiveMaxOutputBytes });
      } catch (error) {
        return normalizeMcpToolError(error, entry.serverId, entry.tool.name, mapping.proxyName, entry.security);
      }
    },
  };
}

function createProxyMappings(entries: ToolBuildEntry[]): McpToolProxyMapping[] {
  const used = new Set<string>();
  const baseCounts = new Map<string, number>();

  return entries.map((entry) => {
    const baseName = proxyToolName(entry.serverId, entry.tool.name);
    const displayName = displayMcpToolName(entry.serverId, entry.tool.name);
    const nextCollisionIndex = (baseCounts.get(baseName) ?? 0) + 1;
    baseCounts.set(baseName, nextCollisionIndex);

    let proxyName = baseName;
    if (used.has(proxyName)) {
      proxyName = `${baseName}__${stableSuffix(entry.serverId, entry.tool.name, nextCollisionIndex)}`;
      while (used.has(proxyName)) {
        proxyName = `${baseName}__${stableSuffix(entry.serverId, entry.tool.name, nextCollisionIndex + used.size)}`;
      }
    }

    used.add(proxyName);
    return {
      proxyName,
      displayName,
      serverId: entry.serverId,
      toolName: entry.tool.name,
      collisionIndex: nextCollisionIndex,
    };
  });
}

function mapJsonSchemaProperty(value: unknown): JsonSchemaProperty {
  if (!isRecord(value)) {
    return {
      type: "object",
      description: "Unsupported MCP schema property.",
      additionalProperties: true,
    };
  }

  const base = mapJsonSchemaType(value.type);
  const mapped: JsonSchemaProperty = {
    type: base,
  };

  if (typeof value.description === "string") {
    mapped.description = value.description;
  }
  if (Array.isArray(value.enum) && value.enum.every((entry) => typeof entry === "string")) {
    mapped.enum = value.enum;
  }
  if (base === "array") {
    mapped.items = mapJsonSchemaProperty(value.items);
  }
  if (base === "object") {
    mapped.properties = isRecord(value.properties)
      ? Object.fromEntries(Object.entries(value.properties).map(([key, nested]) => [key, mapJsonSchemaProperty(nested)]))
      : {};
    mapped.additionalProperties = typeof value.additionalProperties === "boolean" ? value.additionalProperties : true;
  }

  return mapped;
}

function mapJsonSchemaType(value: unknown): JsonSchemaProperty["type"] {
  switch (value) {
    case "string":
    case "number":
    case "boolean":
    case "object":
    case "array":
      return value;
    case "integer":
      return "number";
    default:
      return "object";
  }
}

function renderMcpResult(result: McpToolCallResult): string {
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      parts.push(renderContentBlock(block));
    }
  } else if (result.content !== undefined) {
    parts.push(renderContentBlock(result.content));
  }

  if (result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }

  if (parts.length === 0) {
    return JSON.stringify(result, null, 2);
  }

  return parts.filter((part) => part.length > 0).join("\n");
}

function renderContentBlock(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") {
    return value.text;
  }

  return JSON.stringify(value);
}

function normalizeMcpToolError(
  error: unknown,
  serverId: string,
  toolName: string,
  proxyName: string,
  security: McpServerSecurity,
): ToolResult {
  const normalized = {
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: redactMcpSensitiveText(error instanceof Error ? error.message : String(error), security),
      code: isRecord(error) && typeof error.code === "string" ? error.code : "mcp_tool_call_failed",
      serverId,
      toolName,
      proxyName,
    },
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(normalized, null, 2),
      },
    ],
    isError: true,
    details: normalized,
  };
}

function truncateMcpOutput(text: string, maxOutputBytes: number): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = Buffer.byteLength(text, "utf-8");
  if (originalBytes <= maxOutputBytes) {
    return {
      text,
      truncated: false,
      originalBytes,
    };
  }

  const marker = `\n${TRUNCATION_MARKER} to ${maxOutputBytes} bytes from ${originalBytes} bytes]`;
  const budget = Math.max(0, maxOutputBytes - Buffer.byteLength(marker, "utf-8"));
  const truncatedText = new TextDecoder().decode(Buffer.from(text, "utf-8").subarray(0, budget));

  return {
    text: `${truncatedText}${marker}`,
    truncated: true,
    originalBytes,
  };
}

function stableSuffix(serverId: string, toolName: string, collisionIndex: number): string {
  return createHash("sha256").update(serverId).update("\0").update(toolName).update("\0").update(String(collisionIndex)).digest("hex").slice(0, 8);
}

function sanitizeToolNamePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "unnamed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
