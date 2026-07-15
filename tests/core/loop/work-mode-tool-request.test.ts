import { describe, expect, test } from "bun:test";
import { buildRequest } from "../../../src/engine/turn/turn-helpers";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";
import type { ToolDefinition } from "../../../src/kernel/tools/types";
import { filterToolsForWorkMode, type WorkMode } from "../../../src/kernel/work-mode/public";

function tool(name: string, toolType: "function" | "local_shell" = "function"): ToolDefinition {
  return {
    name,
    label: name,
    description: `Tool ${name}`,
    parameters: { type: "object", properties: {} },
    toolType,
    async execute() {
      return { content: [{ type: "text", text: "ok" }], isError: false };
    },
  };
}

function requestToolNames(mode: WorkMode): string[] {
  const registry = new ToolRegistry();
  registry.register(tool("read"));
  registry.register(tool("write"));
  registry.register(tool("bash", "local_shell"));
  const allowed = new Set(filterToolsForWorkMode(registry.getNames(), mode, {
    semanticsFor: (name) => registry.getSemantics(name),
  }));
  const request = buildRequest(
    SessionManager.inMemory("/test"),
    "system",
    registry,
    "test-model",
    1_000,
    1_000,
    0,
    [],
    true,
    allowed,
  );

  return (request.tools ?? []).map((definition) =>
    definition.type === "function" ? definition.name : definition.type
  );
}

describe("work-mode model tool request", () => {
  for (const mode of ["plan", "goal"] as const) {
    test(`${mode} mode omits mutation functions and anonymous local_shell`, () => {
      expect(requestToolNames(mode)).toEqual(["read", "finish"]);
    });
  }

  test("agent mode retains mutation functions and local_shell", () => {
    expect(requestToolNames("agent")).toEqual(["read", "write", "local_shell", "finish"]);
  });
});
