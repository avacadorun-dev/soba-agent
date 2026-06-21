/**
 * BenchmarkWorkload — generates deterministic scripted workloads
 * for endurance benchmark testing.
 *
 * The workload simulates a realistic coding session with:
 * - User turns (questions, instructions)
 * - Tool calls (read, write, edit, bash)
 * - Compaction triggers at configured intervals
 *
 * All generation is seed-based for reproducibility.
 *
 * Spec: internal-design-notes § Endurance Acceptance
 */

import type { SessionManager } from "../../src/core/session/session-manager";
import type { ItemParam } from "../../src/core/session/types";

// ─── Types ───

export interface WorkloadConfig {
  /** Seed for deterministic PRNG */
  seed: number;
  /** Total number of steps (user turns + tool calls + compaction triggers) */
  stepsCount: number;
  /** Target tokens per step (approximate) */
  tokensPerStep: number;
  /** Insert compaction trigger every N steps */
  compactionInterval: number;
}

export type WorkloadStep =
  | { type: "user_turn"; content: string; tokens: number }
  | { type: "assistant_turn"; content: string; tokens: number }
  | { type: "tool_call"; name: string; args: Record<string, unknown>; tokens: number }
  | { type: "tool_result"; callId: string; output: string; tokens: number }
  | { type: "compaction_trigger"; tokens: number };

export interface WorkloadResult {
  /** Total input tokens (user messages, tool results) */
  totalInputTokens: number;
  /** Total output tokens (assistant messages, tool calls) */
  totalOutputTokens: number;
  /** Number of compaction triggers fired */
  compactionTriggers: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Number of user turns */
  userTurns: number;
  /** Number of assistant turns */
  assistantTurns: number;
  /** Steps executed */
  stepsExecuted: number;
}

// ─── PRNG ───

/**
 * Simple seeded PRNG (xoshiro128**).
 * Deterministic: same seed → same sequence.
 */
class SeededRandom {
  private state: [number, number, number, number];

  constructor(seed: number) {
    // Initialize state from seed using splitmix32
    let s = seed | 0;
    const next = () => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      return t >>> 0;
    };

    this.state = [next(), next(), next(), next()];
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const result = Math.imul(this._rotl(Math.imul(this.state[1], 5), 7), 9);
    const t = this.state[1] << 9;

    this.state[2] ^= this.state[0];
    this.state[3] ^= this.state[1];
    this.state[1] ^= this.state[2];
    this.state[0] ^= this.state[3];

    this.state[2] ^= t;
    this.state[3] = this._rotl(this.state[3], 11);

    return (result >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max) */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length)];
  }

  private _rotl(x: number, k: number): number {
    return (x << k) | (x >>> (32 - k));
  }
}

// ─── Content generators ───

const USER_TEMPLATES = [
  "Implement {feature} in {file}",
  "Fix the bug in {file} where {issue}",
  "Refactor {function} to use {pattern}",
  "Add validation for {input} in {file}",
  "Write tests for {module}",
  "Update {config} to support {option}",
  "Optimize {function} performance",
  "Add error handling to {function}",
  "Create {type} interface for {module}",
  "Document the {function} function",
];

const FEATURES = [
  "authentication",
  "rate limiting",
  "caching",
  "logging",
  "retry logic",
  "pagination",
  "filtering",
  "sorting",
  "validation",
  "serialization",
];

const FILES = [
  "src/core/auth.ts",
  "src/core/config.ts",
  "src/core/session.ts",
  "src/core/client.ts",
  "src/core/loop.ts",
  "src/utils/helpers.ts",
  "src/utils/validation.ts",
  "src/tools/read.ts",
  "src/tools/write.ts",
  "src/tools/bash.ts",
];

const FUNCTIONS = ["processInput", "handleRequest", "validateConfig", "parseResponse", "buildQuery"];

const PATTERNS = ["async/await", "Result type", "dependency injection", "strategy pattern", "observer pattern"];

const ISSUES = [
  "null pointer on empty input",
  "race condition in concurrent calls",
  "memory leak in cache",
  "incorrect error propagation",
  "missing await on async call",
];

const TOOL_NAMES = ["read", "write", "edit", "bash", "ls"];

// ─── BenchmarkWorkload ───

export class BenchmarkWorkload {
  private _config: WorkloadConfig;
  private _rng: SeededRandom;
  private _steps: WorkloadStep[];

  constructor(config: WorkloadConfig) {
    this._config = config;
    this._rng = new SeededRandom(config.seed);
    this._steps = this._generateSteps();
  }

  /**
   * Get the generated steps (for inspection/testing).
   */
  getSteps(): WorkloadStep[] {
    return [...this._steps];
  }

  /**
   * Apply the workload to a session, appending items.
   * Returns execution statistics.
   */
  applyToSession(session: SessionManager): WorkloadResult {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let compactionTriggers = 0;
    let toolCalls = 0;
    let userTurns = 0;
    let assistantTurns = 0;
    let stepsExecuted = 0;
    let lastCallId = "";

    for (const step of this._steps) {
      switch (step.type) {
        case "user_turn": {
          const item: ItemParam = {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: step.content }],
          };
          session.appendItem(item);
          totalInputTokens += step.tokens;
          userTurns++;
          break;
        }

        case "assistant_turn": {
          const item: ItemParam = {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: step.content }],
          };
          session.appendItem(item);
          totalOutputTokens += step.tokens;
          assistantTurns++;
          break;
        }

        case "tool_call": {
          lastCallId = `call_${stepsExecuted}_${Date.now().toString(36)}`;
          const item: ItemParam = {
            type: "function_call",
            name: step.name,
            arguments: JSON.stringify(step.args),
            call_id: lastCallId,
          };
          session.appendItem(item);
          totalOutputTokens += step.tokens;
          toolCalls++;
          break;
        }

        case "tool_result": {
          const item: ItemParam = {
            type: "function_call_output",
            call_id: step.callId || lastCallId,
            output: step.output,
          };
          session.appendItem(item);
          totalInputTokens += step.tokens;
          break;
        }

        case "compaction_trigger": {
          compactionTriggers++;
          break;
        }
      }
      stepsExecuted++;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      compactionTriggers,
      toolCalls,
      userTurns,
      assistantTurns,
      stepsExecuted,
    };
  }

  // ─── Private: step generation ───

  private _generateSteps(): WorkloadStep[] {
    const steps: WorkloadStep[] = [];
    const rng = this._rng;
    let stepCount = 0;

    while (stepCount < this._config.stepsCount) {
      // Check if we should insert a compaction trigger
      if (stepCount > 0 && stepCount % this._config.compactionInterval === 0) {
        steps.push({ type: "compaction_trigger", tokens: 0 });
        stepCount++;
        continue;
      }

      // Generate a typical turn: user → assistant → tool call → tool result → assistant
      const userContent = this._generateUserMessage();
      const userTokens = Math.ceil(userContent.length / 3.5);
      steps.push({ type: "user_turn", content: userContent, tokens: userTokens });
      stepCount++;
      if (stepCount >= this._config.stepsCount) break;

      // Assistant response
      const assistantContent = this._generateAssistantMessage();
      const assistantTokens = Math.ceil(assistantContent.length / 3.5);
      steps.push({ type: "assistant_turn", content: assistantContent, tokens: assistantTokens });
      stepCount++;
      if (stepCount >= this._config.stepsCount) break;

      // Tool call (with some probability)
      if (rng.next() > 0.3) {
        const toolName = rng.pick(TOOL_NAMES);
        const toolArgs = this._generateToolArgs(toolName);
        const toolTokens = Math.ceil((toolName + JSON.stringify(toolArgs)).length / 3.5);
        steps.push({ type: "tool_call", name: toolName, args: toolArgs, tokens: toolTokens });
        stepCount++;
        if (stepCount >= this._config.stepsCount) break;

        // Tool result
        const toolOutput = this._generateToolOutput(toolName);
        const resultTokens = Math.ceil(toolOutput.length / 3.5);
        steps.push({ type: "tool_result", callId: "", output: toolOutput, tokens: resultTokens });
        stepCount++;
        if (stepCount >= this._config.stepsCount) break;

        // Final assistant response after tool call
        const finalContent = this._generateAssistantMessage();
        const finalTokens = Math.ceil(finalContent.length / 3.5);
        steps.push({ type: "assistant_turn", content: finalContent, tokens: finalTokens });
        stepCount++;
      }
    }

    return steps;
  }

  private _generateUserMessage(): string {
    const template = this._rng.pick(USER_TEMPLATES);
    const padding = "x".repeat(this._rng.nextInt(50, this._config.tokensPerStep));

    return template
      .replace("{feature}", this._rng.pick(FEATURES))
      .replace("{file}", this._rng.pick(FILES))
      .replace("{function}", this._rng.pick(FUNCTIONS))
      .replace("{pattern}", this._rng.pick(PATTERNS))
      .replace("{input}", "user input")
      .replace("{config}", "config.json")
      .replace("{option}", "custom options")
      .replace("{type}", "TypeScript")
      .replace("{module}", this._rng.pick(FILES).replace("src/", "").replace(".ts", ""))
      .replace("{issue}", this._rng.pick(ISSUES))
      .concat(` ${padding}`);
  }

  private _generateAssistantMessage(): string {
    const templates = [
      "I'll help you with that. Let me read the file first and then make the necessary changes.",
      "Done. I've updated the code to handle the edge case you mentioned.",
      "The refactoring is complete. All tests should pass with the new implementation.",
      "I've added the validation logic. Here's what changed in the implementation.",
      "The optimization reduced processing time by approximately 40%.",
    ];

    const base = this._rng.pick(templates);
    const padding = "y".repeat(this._rng.nextInt(50, this._config.tokensPerStep));
    return `${base} ${padding}`;
  }

  private _generateToolArgs(toolName: string): Record<string, unknown> {
    switch (toolName) {
      case "read":
        return { path: this._rng.pick(FILES) };
      case "write":
        return {
          path: this._rng.pick(FILES),
          content: `// Generated code\nexport function ${this._rng.pick(FUNCTIONS)}() {\n  return true;\n}\n`,
        };
      case "edit":
        return {
          path: this._rng.pick(FILES),
          edits: [{ oldText: "old code", newText: "new code" }],
        };
      case "bash":
        return { command: this._rng.pick(["bun test", "bun run lint", "bun run build", "git status"]) };
      case "ls":
        return { path: this._rng.pick(["src/", "src/core/", "tests/"]) };
      default:
        return {};
    }
  }

  private _generateToolOutput(toolName: string): string {
    const padding = "z".repeat(this._rng.nextInt(100, this._config.tokensPerStep * 2));
    switch (toolName) {
      case "read":
        return `// File content\nimport { something } from "./module";\n\nexport class Example {\n  method() {\n    return 42;\n  }\n}\n${padding}`;
      case "write":
        return `File written successfully`;
      case "edit":
        return `Edit applied successfully`;
      case "bash":
        return `$ bun test\n✓ 15 tests passed\n${padding}`;
      case "ls":
        return `file1.ts\nfile2.ts\nsubdir/\n${padding}`;
      default:
        return padding;
    }
  }
}
