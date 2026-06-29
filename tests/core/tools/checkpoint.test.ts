/**
 * Tests for Checkpoint control-tool (Phase 2, Task A.7).
 *
 * Covers:
 * - Tool execution with milestone and plan_pivot kinds
 * - Tool execution with completed/pending items
 * - Tool execution with minimal args
 * - extractCheckpointEvent function
 * - Tool does not end the turn (isError: false)
 * - Tool always returns content
 */

import { describe, expect, it } from "bun:test";
import { checkpointTool, extractCheckpointEvent } from "../../../src/infrastructure/tools/local/checkpoint";
import type { ToolContext } from "../../../src/kernel/tools/types";

// ─── Helpers ───

function makeContext(): ToolContext {
  return {
    cwd: "/tmp/test-project",
  };
}

// ─── Tests ───

describe("checkpointTool", () => {
  describe("execution", () => {
    it("executes milestone checkpoint with all fields", async () => {
      const args = {
        kind: "milestone" as const,
        reason: "Completed authentication module",
        completed: ["Login form", "JWT validation", "Password hashing"],
        pending: ["Session management", "Logout flow"],
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.isError).toBe(false);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");

      const text = result.content[0].text;
      expect(text).toContain("milestone");
      expect(text).toContain("Completed authentication module");
      expect(text).toContain("Login form");
      expect(text).toContain("Session management");
    });

    it("executes plan_pivot checkpoint", async () => {
      const args = {
        kind: "plan_pivot" as const,
        reason: "Switching from REST to GraphQL based on client feedback",
        nextDirection: "Implement GraphQL schema first",
        completed: ["REST API design"],
        pending: ["GraphQL schema", "Resolvers"],
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toContain("plan_pivot");
      expect(text).toContain("Switching from REST to GraphQL");
      expect(text).toContain("Implement GraphQL schema first");
    });

    it("executes checkpoint with minimal args (kind and reason only)", async () => {
      const args = {
        kind: "milestone" as const,
        reason: "Reached 50% test coverage",
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toContain("milestone");
      expect(text).toContain("Reached 50% test coverage");
    });

    it("executes checkpoint with empty completed/pending arrays", async () => {
      const args = {
        kind: "plan_pivot" as const,
        reason: "Reconsidering architecture",
        completed: [],
        pending: [],
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toContain("plan_pivot");
      expect(text).toContain("Reconsidering architecture");
    });

    it("always returns isError: false (does not end the turn)", async () => {
      const testCases = [
        { kind: "milestone" as const, reason: "Test 1" },
        { kind: "plan_pivot" as const, reason: "Test 2" },
        {
          kind: "milestone" as const,
          reason: "Test 3",
          completed: ["Item 1"],
          pending: ["Item 2"],
        },
      ];

      for (const args of testCases) {
        const result = await checkpointTool.execute(args, makeContext());
        expect(result.isError).toBe(false);
      }
    });

    it("always returns at least one content block", async () => {
      const args = {
        kind: "milestone" as const,
        reason: "Simple checkpoint",
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text.length).toBeGreaterThan(0);
    });

    it("includes details in result for event extraction", async () => {
      const args = {
        kind: "milestone" as const,
        reason: "Feature complete",
        completed: ["Feature A", "Feature B"],
        pending: ["Tests", "Documentation"],
      };

      const result = await checkpointTool.execute(args, makeContext());

      expect(result.details).toBeDefined();
      expect(result.details?.kind).toBe("milestone");
      expect(result.details?.reason).toBe("Feature complete");
      expect(result.details?.nextDirection).toBeUndefined();
      expect(result.details?.completed).toEqual(["Feature A", "Feature B"]);
      expect(result.details?.pending).toEqual(["Tests", "Documentation"]);
    });
  });

  describe("tool metadata", () => {
    it("has correct name and toolType", () => {
      expect(checkpointTool.name).toBe("checkpoint");
      expect(checkpointTool.toolType).toBe("function");
    });

    it("has description explaining it does not end the turn", () => {
      expect(checkpointTool.description).toContain("does NOT end the turn");
    });

    it("has required parameters: kind and reason", () => {
      expect(checkpointTool.parameters.required).toContain("kind");
      expect(checkpointTool.parameters.required).toContain("reason");
    });

    it("has kind parameter with enum values", () => {
      const kindProp = checkpointTool.parameters.properties.kind;
      expect(kindProp.enum).toEqual(["milestone", "plan_pivot"]);
    });

    it("has optional completed and pending array parameters", () => {
      const completedProp = checkpointTool.parameters.properties.completed;
      const pendingProp = checkpointTool.parameters.properties.pending;

      expect(completedProp.type).toBe("array");
      expect(pendingProp.type).toBe("array");

      // They should not be in required
      expect(checkpointTool.parameters.required).not.toContain("completed");
      expect(checkpointTool.parameters.required).not.toContain("pending");
    });
  });
});

describe("extractCheckpointEvent", () => {
  it("extracts event from full checkpoint args", () => {
    const args = {
      kind: "milestone" as const,
      reason: "Completed phase 1",
      completed: ["Task A", "Task B"],
      pending: ["Task C"],
    };

    const event = extractCheckpointEvent(args);

    expect(event.kind).toBe("milestone");
    expect(event.reason).toBe("Completed phase 1");
    expect(event.completed).toEqual(["Task A", "Task B"]);
    expect(event.pending).toEqual(["Task C"]);
    expect(event.timestamp).toBeDefined();
    expect(typeof event.timestamp).toBe("string");
  });

  it("extracts event from minimal checkpoint args", () => {
    const args = {
      kind: "plan_pivot" as const,
      reason: "Changing direction",
      nextDirection: "Stabilize parser before adding features",
    };

    const event = extractCheckpointEvent(args);

    expect(event.kind).toBe("plan_pivot");
    expect(event.reason).toBe("Changing direction");
    expect(event.nextDirection).toBe("Stabilize parser before adding features");
    expect(event.completed).toEqual([]);
    expect(event.pending).toEqual([]);
    expect(event.timestamp).toBeDefined();
  });

  it("extracts event with empty arrays", () => {
    const args = {
      kind: "milestone" as const,
      reason: "Quick checkpoint",
      completed: [],
      pending: [],
    };

    const event = extractCheckpointEvent(args);

    expect(event.completed).toEqual([]);
    expect(event.pending).toEqual([]);
  });

  it("generates valid ISO timestamp", () => {
    const args = {
      kind: "milestone" as const,
      reason: "Test",
    };

    const event = extractCheckpointEvent(args);

    // Should be parseable as ISO date
    const parsed = new Date(event.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});
