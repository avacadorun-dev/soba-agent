import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSobaRuntime } from "../../src/application/runtime-factory";
import type { ResponseResource } from "../../src/core/client/types";
import { DEFAULT_COMPACTION_CONFIG } from "../../src/core/compaction/trigger-policy";
import type { SobaConfig } from "../../src/core/config/types";
import { SessionManager } from "../../src/core/session/session-manager";

let testHome: string;
let projectRoot: string;
let previousHome: string | undefined;
let previousBundledSkillsPath: string | undefined;

function makeConfig(): SobaConfig {
  return {
    baseUrl: "https://api.example.test/v1",
    apiKey: "fake-api-key",
    model: "test-model",
    maxOutputTokens: 1024,
    contextWindow: 32_000,
    maxCompletionTokens: 0,
    temperature: 0.7,
    maxAgentIterations: 3,
    maxStalledIterations: 2,
    maxRunMinutes: 1,
    bashMaxTimeoutSeconds: 30,
    sessionDir: "",
    lang: "en",
    theme: "graphite",
    compaction: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
  };
}

function makeTextResponse(text: string): ResponseResource {
  return {
    id: "resp_runtime_factory",
    object: "response",
    created_at: Date.now(),
    completed_at: Date.now(),
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "message",
        id: "msg_runtime_factory",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
        phase: "final_answer",
      },
    ],
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
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
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

beforeEach(() => {
  testHome = join(tmpdir(), `soba-runtime-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  projectRoot = join(tmpdir(), `soba-runtime-project-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  previousHome = process.env.HOME;
  previousBundledSkillsPath = process.env.SOBA_BUNDLED_SKILLS_PATH;
  process.env.HOME = testHome;
  process.env.SOBA_BUNDLED_SKILLS_PATH = join(projectRoot, "missing-skills");
});

afterEach(() => {
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
  if (previousBundledSkillsPath) process.env.SOBA_BUNDLED_SKILLS_PATH = previousBundledSkillsPath;
  else delete process.env.SOBA_BUNDLED_SKILLS_PATH;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createSobaRuntime", () => {
  test("builds one shared runtime composition over the legacy AgentLoop", async () => {
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
    });

    const events: string[] = [];
    composition.runtime.onEvent((event) => events.push(event.type));
    composition.client.create = async () => makeTextResponse("runtime ok");

    const result = await composition.runtime.runTurn({
      sessionId: session.getSessionId(),
      source: "print",
      content: [{ type: "text", text: "hello" }],
    });

    expect(composition.agentLoop.getSessionManager()).toBe(session);
    expect(composition.tools.getNames()).toContain("read");
    expect(result.response.id).toBe("resp_runtime_factory");
    expect(events).toContain("turn_start");
    expect(events).toContain("turn_end");
  });
});
