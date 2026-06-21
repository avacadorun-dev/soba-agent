import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { ResponseResource } from "../../../src/core/client/types";
import { parseVerificationDiagnostics } from "../../../src/core/fix-until-green";
import { AgentLoop } from "../../../src/core/loop/agent-loop";
import type { ProjectMemorySource } from "../../../src/core/memory/memory-injector";
import { ProjectMemory } from "../../../src/core/memory/project-memory";
import {
  addRecoveryReflectionFix,
  createRecoveryReflectionDraft,
  writeRecoveryReflectionLesson,
} from "../../../src/core/memory/reflection-memory-policy";
import type { CapsuleRelevanceResult, KnowledgeDocument } from "../../../src/core/memory/types";
import { SessionManager } from "../../../src/core/session/session-manager";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";
import type { ToolDefinition, ToolResult } from "../../../src/core/tools/types";

describe("Reflection memory policy", () => {
  let projectRoot: string;
  let idCounter: number;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-reflection-memory-"));
    idCounter = 0;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("successful recovery writes concise problem cause fix and verification lesson", () => {
    const memory = createMemory();
    const diagnostic = parseVerificationDiagnostics(
      "bun test tests/parser.test.ts",
      "src/parser.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    );
    const draft = addRecoveryReflectionFix(createRecoveryReflectionDraft(diagnostic), "edit changed src/parser.ts");

    const result = writeRecoveryReflectionLesson(memory, {
      task: "Fix parser tests",
      sessionId: "session-1",
      draft,
      verification: "Verification passed: bun test tests/parser.test.ts",
      observableSuccess: true,
      timestamp: "2026-06-20T00:00:00.000Z",
    });

    expect(result.status).toBe("written");
    const capsule = memory.getStores().capsules.get("cap-001");
    expect(capsule.type).toBe("error_fix");
    expect(capsule.detail).toContain("Problem:");
    expect(capsule.detail).toContain("Cause:");
    expect(capsule.detail).toContain("Fix:");
    expect(capsule.detail).toContain("Verification:");
    expect(capsule.tags).toContain("reflection");
    expect(capsule.tags.some((tag) => tag.startsWith("lesson-"))).toBe(true);
  });

  test("failed or blocked recovery does not write success lesson", () => {
    const memory = createMemory();
    const diagnostic = parseVerificationDiagnostics("bun test", "(fail) parser handles invalid input");
    const draft = addRecoveryReflectionFix(createRecoveryReflectionDraft(diagnostic), "edit changed src/parser.ts");

    const result = writeRecoveryReflectionLesson(memory, {
      task: "Fix parser tests",
      sessionId: "session-1",
      draft,
      verification: "Verification still failing",
      observableSuccess: false,
    });

    expect(result).toEqual({ status: "skipped", reason: "no_observable_success" });
    expect(memory.getStores().capsules.list()).toEqual([]);
  });

  test("secret-like values are rejected before writing", () => {
    const memory = createMemory();
    const diagnostic = parseVerificationDiagnostics("bun test", "apiKey=fake-secret-value-1234567890");
    const draft = addRecoveryReflectionFix(createRecoveryReflectionDraft(diagnostic), "edit changed src/config.ts");

    const result = writeRecoveryReflectionLesson(memory, {
      task: "Fix config tests",
      sessionId: "session-1",
      draft,
      verification: "Verification passed: bun test",
      observableSuccess: true,
    });

    expect(result).toEqual({ status: "skipped", reason: "secret_detected" });
    expect(memory.getStores().capsules.list()).toEqual([]);
  });

  test("duplicate lesson is ignored by fingerprint tag", () => {
    const memory = createMemory();
    const diagnostic = parseVerificationDiagnostics("bun test", "(fail) parser handles invalid input");
    const draft = addRecoveryReflectionFix(createRecoveryReflectionDraft(diagnostic), "edit changed src/parser.ts");
    const input = {
      task: "Fix parser tests",
      sessionId: "session-1",
      draft,
      verification: "Verification passed: bun test",
      observableSuccess: true,
    };

    const first = writeRecoveryReflectionLesson(memory, input);
    const second = writeRecoveryReflectionLesson(memory, input);

    expect(first.status).toBe("written");
    expect(second).toEqual({ status: "skipped", reason: "duplicate", existingId: "cap-001" });
    expect(memory.getStores().capsules.list()).toHaveLength(1);
  });

  test("AgentLoop reads relevant memory at task start", async () => {
    const memory = makeMemorySourceSpy();
    const client = createMockClient([makeFinishResponse()]);
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory(projectRoot),
      new ToolRegistry(),
      projectRoot,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      memory,
    );

    await loop.runTurn("Fix parser recovery using current code");

    expect(memory.getKnowledgeFiles).toHaveBeenCalled();
    expect(memory.getRelevantCapsules).toHaveBeenCalledWith({
      text: "Fix parser recovery using current code",
      limit: 10,
    });
  });

  test("AgentLoop writes recovery lesson only after observable passing verification", async () => {
    const memory = createMemory();
    const client = createMockClient([
      makeToolCallResponse("bash", { command: "bun test tests/parser.test.ts" }, "bash_fail"),
      makeToolCallResponse("edit", { path: "src/parser.ts" }, "edit_fix"),
      makeToolCallResponse("bash", { command: "bun test tests/parser.test.ts" }, "bash_pass"),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeEditTool());
    tools.register(makeBashTool());
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory(projectRoot),
      tools,
      projectRoot,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      memory,
    );

    const result = await loop.runTurn("Fix parser tests");

    expect(result.activeErrors).toEqual([]);
    const capsules = memory.getStores().capsules.list();
    expect(capsules).toHaveLength(1);
    expect(capsules[0].summary).toContain("Recovered:");
    expect(capsules[0].detail).toContain("edit changed src/parser.ts");
    expect(capsules[0].detail).toContain("Verification passed: bun test tests/parser.test.ts");
    expect(result.evidenceSummary?.entries.some((entry) => entry.kind === "reflection")).toBe(true);
  });

  function createMemory(): ProjectMemory {
    return new ProjectMemory({
      projectRoot,
      now: () => new Date("2026-06-20T00:00:00.000Z"),
      idGenerator: () => {
        idCounter += 1;
        return `cap-${String(idCounter).padStart(3, "0")}`;
      },
    });
  }
});

function makeMemorySourceSpy(): ProjectMemorySource {
  return {
    getKnowledgeFiles: mock((): KnowledgeDocument[] => []),
    getRelevantCapsules: mock((): CapsuleRelevanceResult[] => []),
  };
}

function makeToolCallResponse(name: string, args: Record<string, unknown>, callId: string): ResponseResource {
  return makeResponse([
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function makeFinishResponse(): ResponseResource {
  return makeToolCallResponse(
    "finish",
    {
      summary: "Parser recovery completed.",
      status: "completed",
      criteria: [{ criterion: "Parser recovery was verified" }],
    },
    "finish_1",
  );
}

function makeResponse(output: ResponseResource["output"]): ResponseResource {
  return {
    id: `resp_${crypto.randomUUID().slice(0, 8)}`,
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output,
    error: null,
    tools: [],
    tool_choice: "auto",
    truncation: "disabled",
    parallel_tool_calls: true,
    text: {},
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    reasoning: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    max_output_tokens: null,
    max_tool_calls: null,
    store: false,
    background: false,
    service_tier: "default",
    metadata: {},
    safety_identifier: null,
    prompt_cache_key: null,
  };
}

function createMockClient(responses: ResponseResource[]): OpenResponsesClient {
  let index = 0;
  return {
    create: mock(async () => {
      const response = responses[index];
      index += 1;
      if (!response) throw new Error("No mock response left");
      return response;
    }),
    createStream: mock(async function* () {}),
    compact: mock(async () => ({
      id: "comp_test",
      object: "response.compaction" as const,
      output: [],
      created_at: 1,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    })),
    getProviderIdentity: mock(() => ({
      adapterId: "test",
      endpointOrigin: "https://test.example",
      model: "test-model",
    })),
    getProviderCapabilities: mock(() => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
    })),
    classifyError: mock(() => "unknown" as const),
    compactNative: mock(async () => {
      throw new Error("compactNative not implemented");
    }),
    getConfig: mock(() => ({
      baseUrl: "https://test.example",
      apiKey: "test-key",
      model: "test-model",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
    })),
    updateConfig: mock(() => {}),
  };
}

function makeEditTool(): ToolDefinition<Record<string, unknown>> {
  return {
    name: "edit",
    label: "edit",
    description: "Mock edit",
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(): Promise<ToolResult> {
      return { content: [{ type: "text", text: "edited" }], isError: false };
    },
  };
}

function makeBashTool(): ToolDefinition<Record<string, unknown>> {
  let callCount = 0;
  return {
    name: "bash",
    label: "bash",
    description: "Mock bash",
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(): Promise<ToolResult> {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "text",
              text: "src/parser.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: "tests passed" }], isError: false };
    },
  };
}
