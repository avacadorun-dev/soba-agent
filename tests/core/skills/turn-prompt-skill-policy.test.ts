import { describe, expect, test } from "bun:test";
import type { SkillSource } from "../../../src/engine/turn/skill-source";
import { prepareTurnPrompt } from "../../../src/engine/turn/turn-prompt-preparation";
import type { OpenResponsesClientConfig } from "../../../src/kernel/model/model-gateway";

const modelConfig = {
  model: "test-model",
  maxOutputTokens: 1_000,
  maxCompletionTokens: 1_000,
  contextWindow: 16_000,
  temperature: 0,
} as OpenResponsesClientConfig;

function skillSource(read: boolean, write: boolean): SkillSource {
  return {
    getCatalogForPrompt: () => [],
    buildEphemeralMessages: () => [],
    getSkill: () => undefined,
    getMemoryAccess: () => ({ read, write }),
    evaluateToolPolicy: (toolName) => ({
      allowed:
        (toolName !== "read_project_memory" || read) &&
        (toolName !== "write_project_memory" || write),
    }),
  };
}

const projectMemory = {
  getKnowledgeFiles: () => [{
    key: "architecture" as const,
    filename: "architecture.md",
    path: "/project/.soba/memory/architecture.md",
    title: "Architecture",
    content: "Private project architecture memory",
    estimatedTokens: 10,
  }],
  getRelevantCapsules: () => [],
};

describe("turn prompt active skill memory policy", () => {
  test("removes memory tools and injected memory when active skills allow neither", async () => {
    const result = await prepareTurnPrompt({
      cwd: "/project",
      userText: "review changes",
      selectedTools: ["read", "read_project_memory", "write_project_memory"],
      skillManager: skillSource(false, false),
      projectMemory,
      modelConfig,
    });

    expect(result.systemPrompt).not.toContain("- read_project_memory:");
    expect(result.systemPrompt).not.toContain("- write_project_memory:");
    expect(result.systemPrompt).not.toContain("<project_knowledge>");
    expect(result.systemPrompt).not.toContain("Private project architecture memory");
  });

  test("injects project memory but hides writes for a read-only skill", async () => {
    const result = await prepareTurnPrompt({
      cwd: "/project",
      userText: "orient in codebase",
      selectedTools: ["read", "read_project_memory", "write_project_memory"],
      skillManager: skillSource(true, false),
      projectMemory,
      modelConfig,
    });

    expect(result.systemPrompt).toContain("- read_project_memory:");
    expect(result.systemPrompt).not.toContain("- write_project_memory:");
    expect(result.systemPrompt).toContain("<project_knowledge>");
    expect(result.systemPrompt).toContain("Private project architecture memory");
  });
});
