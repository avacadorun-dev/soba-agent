/**
 * Tool Registry.
 *
 * Stores and provides access to all registered tools.
 * Converts tools to OpenAI-compatible function definitions.
 */

import type { FunctionToolParam, ToolParam } from "../model/openresponses-types";
import { resolveToolSemantics, type ToolSemantics } from "./semantics";
import type { AnyToolDefinition, JsonSchema, JsonSchemaProperty, ToolDefinition } from "./types";

/** Convert soba JsonSchema to OpenAI function parameters format */
function toOpenAIParameters(schema: JsonSchema): Record<string, unknown> {
  function convertProperty(prop: JsonSchemaProperty): Record<string, unknown> {
    const result: Record<string, unknown> = {
      type: prop.type,
    };
    if (prop.description) result.description = prop.description;
    if (prop.enum) result.enum = prop.enum;
    if (prop.items) result.items = convertProperty(prop.items);
    if (prop.properties) {
      const converted: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(prop.properties)) {
        converted[key] = convertProperty(value);
      }
      result.properties = converted;
    }
    if (prop.required) result.required = prop.required;
    if (prop.additionalProperties !== undefined) result.additionalProperties = prop.additionalProperties;
    return result;
  }

  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    properties[key] = convertProperty(value);
  }

  return {
    type: "object",
    properties,
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.additionalProperties !== undefined ? { additionalProperties: schema.additionalProperties } : {}),
  };
}

/**
 * ToolRegistry manages tool definitions and provides lookup/conversion.
 */
export class ToolRegistry {
  private tools = new Map<string, AnyToolDefinition>();

  /** Register a tool definition */
  register<TArgs>(tool: ToolDefinition<TArgs>): void {
    this.tools.set(tool.name, tool as unknown as AnyToolDefinition);
  }

  /** Remove a registered tool by name. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Remove all tools whose name starts with prefix. Returns removed count. */
  unregisterByPrefix(prefix: string): number {
    let removed = 0;
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix) && this.tools.delete(name)) {
        removed += 1;
      }
    }

    return removed;
  }

  /** Get a tool by name. Returns undefined if not found. */
  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Resolve declared tool effects, falling back to built-in compatibility metadata. */
  getSemantics(name: string): ToolSemantics {
    return resolveToolSemantics(name, this.tools.get(name)?.semantics);
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get all registered tools */
  getAll(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Get all tool names */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Get OpenAI-compatible tool definitions.
   * Converts local_shell tools to function tools (name: "bash").
   */
  getOpenAITools(): FunctionToolParam[] {
    const tools: FunctionToolParam[] = [];

    for (const tool of this.tools.values()) {
      tools.push({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: toOpenAIParameters(tool.parameters),
      });
    }

    return tools;
  }

  /**
   * Get OpenResponses-compatible tool definitions.
   * Returns function tools as-is and local_shell as a separate type.
   */
  getOpenResponsesTools(): ToolParam[] {
    const tools: ToolParam[] = [];

    for (const tool of this.tools.values()) {
      if (tool.toolType === "local_shell") {
        tools.push({ type: "local_shell" });
      } else {
        tools.push({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: toOpenAIParameters(tool.parameters),
        });
      }
    }

    return tools;
  }
}
