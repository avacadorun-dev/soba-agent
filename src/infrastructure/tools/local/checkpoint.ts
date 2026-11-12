/**
 * Checkpoint control-tool.
 *
 * Allows the agent to mark milestones or plan pivots during a long turn.
 * The tool itself does NOT trigger compaction — it records the checkpoint
 * and defers compaction evaluation to the AgentLoop after the tool batch
 * completes.
 *
 * Key properties:
 * - Does NOT end the turn
 * - Does NOT perform compaction within a parallel tool batch
 * - After the batch completes, AgentLoop passes the event to ContextManager
 * - The tool call is always persisted in the session, even if ROI policy skips compaction
 *
 * Spec: internal-design-notes § Checkpoint Control-Tool
 */

import type { CheckpointArgs } from "../../../kernel/tools/checkpoint";

export { type CheckpointEvent, extractCheckpointEvent } from "../../../kernel/tools/checkpoint";

import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";

// ─── Tool Definition ───

export const checkpointTool: ToolDefinition<CheckpointArgs> = {
  name: "checkpoint",
  label: "checkpoint",
  description:
    "Mark a meaningful milestone or plan pivot during a long task. " +
    "This does NOT end the turn and should not be used for routine progress logging. Use it when a significant subtask " +
    "is complete or the plan has changed. " +
    "Provide completed items and pending items for context tracking.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "Type of checkpoint",
        enum: ["milestone", "plan_pivot"],
      },
      reason: {
        type: "string",
        description: "Why this checkpoint is being created",
      },
      nextDirection: {
        type: "string",
        description: "For plan_pivot: the next direction to follow after the pivot",
      },
      completed: {
        type: "array",
        description: "List of completed items (optional)",
        items: { type: "string" },
      },
      pending: {
        type: "array",
        description: "List of pending items (optional)",
        items: { type: "string" },
      },
      items: {
        type: "array",
        description:
          "Optional structured plan: ordered items that replace the persisted plan. Each item has a title, a status (pending, active, done, blocked), and optional evidenceIds linking done items to evidence.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            status: { type: "string", enum: ["pending", "active", "done", "blocked"] },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["kind", "reason"],
  },
  toolType: "function",

  async execute(args: CheckpointArgs, _context: ToolContext, _signal?: AbortSignal): Promise<ToolResult> {
    const completed = args.completed ?? [];
    const pending = args.pending ?? [];
    const items = normalizePlanItems(args.items);

    const lines: string[] = [];
    lines.push(`Checkpoint recorded: ${args.kind}`);
    lines.push(`Reason: ${args.reason}`);
    if (args.nextDirection) {
      lines.push(`Next direction: ${args.nextDirection}`);
    }

    if (completed.length > 0) {
      lines.push(`Completed: ${completed.join(", ")}`);
    }
    if (pending.length > 0) {
      lines.push(`Pending: ${pending.join(", ")}`);
    }
    if (items.length > 0) {
      lines.push("Plan items:");
      for (const item of items) {
        const evidence = item.evidenceIds && item.evidenceIds.length > 0 ? ` (evidence: ${item.evidenceIds.join(", ")})` : "";
        lines.push(`  [${item.status}] ${item.title}${evidence}`);
      }
    }

    lines.push("Compaction will be evaluated after this tool batch completes.");

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: false,
      details: {
        kind: args.kind,
        reason: args.reason,
        nextDirection: args.nextDirection,
        completed,
        pending,
        ...(items.length > 0 ? { items } : {}),
      },
    };
  },
};

function normalizePlanItems(items: CheckpointArgs["items"]): NonNullable<CheckpointArgs["items"]> {
  if (!Array.isArray(items)) return [];
  const validStatuses = new Set(["pending", "active", "done", "blocked"]);
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) return [];
    const status = validStatuses.has(item.status) ? item.status : "pending";
    const evidenceIds = Array.isArray(item.evidenceIds)
      ? item.evidenceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return [{ title, status, ...(evidenceIds.length > 0 ? { evidenceIds } : {}) }];
  });
}
