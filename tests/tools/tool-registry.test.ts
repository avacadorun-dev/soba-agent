/**
 * Tool Registry tests.
 */

import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "../../src/core/tools/tool-registry";
import type { ToolDefinition } from "../../src/core/tools/types";

function makeDummyTool(name: string, toolType: "function" | "local_shell" = "function"): ToolDefinition {
  return {
    name,
    label: name,
    description: `Tool ${name}`,
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input string" },
      },
      required: ["input"],
    },
    toolType,
    async execute(args) {
      return {
        content: [{ type: "text", text: `Executed ${name} with ${args.input}` }],
        isError: false,
      };
    },
  };
}

describe("ToolRegistry", () => {
  test("register и get по имени", () => {
    const registry = new ToolRegistry();
    const tool = makeDummyTool("test-tool");
    registry.register(tool);

    expect(registry.has("test-tool")).toBe(true);
    expect(registry.get("test-tool")).toBe(tool);
  });

  test("get для несуществующего тула возвращает undefined", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("has возвращает false для незарегистрированного тула", () => {
    const registry = new ToolRegistry();
    expect(registry.has("missing")).toBe(false);
  });

  test("getAll возвращает все зарегистрированные тулы", () => {
    const registry = new ToolRegistry();
    registry.register(makeDummyTool("a"));
    registry.register(makeDummyTool("b"));
    registry.register(makeDummyTool("c"));

    expect(registry.getAll().length).toBe(3);
  });

  test("getNames возвращает имена всех тулов", () => {
    const registry = new ToolRegistry();
    registry.register(makeDummyTool("read"));
    registry.register(makeDummyTool("write"));

    expect(registry.getNames()).toEqual(["read", "write"]);
  });

  test("getOpenAITools конвертирует тулы в OpenAI формат", () => {
    const registry = new ToolRegistry();
    registry.register(makeDummyTool("read"));
    registry.register(makeDummyTool("write"));

    const openaiTools = registry.getOpenAITools();

    expect(openaiTools.length).toBe(2);
    expect(openaiTools[0].type).toBe("function");
    expect(openaiTools[0].name).toBe("read");
    expect(openaiTools[0].parameters).toBeDefined();
    expect(openaiTools[0].parameters?.type).toBe("object");
    expect(openaiTools[0].parameters?.properties).toBeDefined();
  });

  test("getOpenResponsesTools включает local_shell как отдельный тип", () => {
    const registry = new ToolRegistry();
    registry.register(makeDummyTool("read"));
    registry.register(makeDummyTool("bash", "local_shell"));

    const tools = registry.getOpenResponsesTools();

    expect(tools.length).toBe(2);
    expect(tools[0].type).toBe("function");
    expect(tools[1].type).toBe("local_shell");
  });

  test("перерегистрация заменяет тул", () => {
    const registry = new ToolRegistry();
    const v1 = makeDummyTool("tool");
    const v2 = makeDummyTool("tool");
    v2.description = "Updated description";

    registry.register(v1);
    registry.register(v2);

    expect(registry.get("tool")?.description).toBe("Updated description");
  });

  test("OpenAI tools содержат корректные параметры", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "complex-tool",
      label: "Complex",
      description: "A tool with complex parameters",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          mode: { type: "string", enum: ["read", "write"] },
          count: { type: "number", description: "Number of items" },
        },
        required: ["path"],
      },
      toolType: "function",
      async execute() {
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
    });

    const tools = registry.getOpenAITools();
    const params = tools[0].parameters;
    expect(params).toBeDefined();
    expect((params as { properties: Record<string, unknown> }).properties.path).toBeDefined();
    expect((params as { properties: Record<string, unknown> }).properties.mode).toBeDefined();
    expect((params as { required: string[] }).required).toEqual(["path"]);
  });
});
