import { describe, expect, test } from "bun:test";
import {
  applyDiffReviewAction,
  buildEvidenceBundle,
  buildEvidenceDiffSummary,
  createDiffReviewState,
  formatEvidenceBundleForHandoff,
} from "../../../src/core/evidence";
import type { EvidenceLedgerSummary } from "../../../src/core/loop/evidence-ledger";

const NOW = new Date("2026-06-27T00:00:00.000Z");
const LATER = new Date("2026-06-27T00:01:00.000Z");

describe("Diff review actions", () => {
  test("creates review state from diff and explicit hunks", () => {
    const state = createReviewState();

    expect(state).toMatchObject({
      version: 1,
      turnId: "turn_1",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    expect(state.files[0]).toMatchObject({
      path: "src/app.ts",
      decision: "pending",
      hunks: [
        { id: "hunk_1", decision: "pending", added: 1, removed: 1 },
        { id: "hunk_2", decision: "pending", added: 1, removed: 0 },
      ],
    });
  });

  test("accepts a whole file and records an audit action", () => {
    const reviewed = applyDiffReviewAction(
      createReviewState(),
      { type: "accept_file", path: "src/app.ts", reason: "looks correct" },
      { now: () => LATER },
    );

    expect(reviewed.files[0]?.decision).toBe("accepted");
    expect(reviewed.files[0]?.hunks.map((hunk) => hunk.decision)).toEqual(["accepted", "accepted"]);
    expect(reviewed.actions[0]).toMatchObject({
      id: "review_action_0001",
      type: "accept_file",
      status: "recorded",
      summary: "Accepted file change: src/app.ts",
      mutationIds: ["ev_mutation_edit_1"],
      resultingMutation: undefined,
      createdAt: "2026-06-27T00:01:00.000Z",
    });
  });

  test("rejects a whole file and plans a mutation record", () => {
    const reviewed = applyDiffReviewAction(
      createReviewState(),
      { type: "reject_file", path: "src/app.ts" },
      { now: () => LATER },
    );

    expect(reviewed.files[0]?.decision).toBe("rejected");
    expect(reviewed.actions[0]?.resultingMutation).toEqual({
      id: "review_mutation_review_action_0001",
      kind: "reject_file",
      files: ["src/app.ts"],
      mutationIds: ["ev_mutation_edit_1"],
      summary: "Rejected file change: src/app.ts",
    });
  });

  test("accepts and rejects hunks when hunk metadata is available", () => {
    const accepted = applyDiffReviewAction(
      createReviewState(),
      { type: "accept_hunk", path: "src/app.ts", hunkId: "hunk_1" },
      { now: () => LATER },
    );
    const rejected = applyDiffReviewAction(
      accepted,
      { type: "reject_hunk", path: "src/app.ts", hunkId: "hunk_2" },
      { now: () => LATER },
    );

    expect(rejected.files[0]?.decision).toBe("mixed");
    expect(rejected.files[0]?.hunks.map((hunk) => hunk.decision)).toEqual(["accepted", "rejected"]);
    expect(rejected.actions[1]?.resultingMutation).toMatchObject({
      kind: "reject_hunk",
      files: ["src/app.ts"],
      mutationIds: ["ev_mutation_edit_1"],
      summary: "Rejected hunk hunk_2 in src/app.ts",
    });
  });

  test("records unsupported hunk actions without mutating review state", () => {
    const reviewed = applyDiffReviewAction(
      createReviewState(),
      { type: "reject_hunk", path: "src/app.ts", hunkId: "missing_hunk" },
      { now: () => LATER },
    );

    expect(reviewed.files[0]?.decision).toBe("pending");
    expect(reviewed.actions[0]).toMatchObject({
      type: "reject_hunk",
      status: "unsupported",
      summary: "Hunk review target was not found.",
      mutationIds: [],
    });
  });

  test("rolls back current turn and leaves an audit trail", () => {
    const reviewed = applyDiffReviewAction(
      createReviewState(),
      { type: "rollback_turn", reason: "user rejected the turn" },
      { now: () => LATER },
    );

    expect(reviewed.rollback).toBeDefined();
    expect(reviewed.files.map((file) => file.decision)).toEqual(["rejected"]);
    expect(reviewed.files[0]?.hunks.map((hunk) => hunk.decision)).toEqual(["rejected", "rejected"]);
    expect(reviewed.actions[0]).toMatchObject({
      type: "rollback_turn",
      status: "recorded",
      summary: "Rollback requested for turn_1.",
      resultingMutation: {
        kind: "rollback_turn",
        files: ["src/app.ts"],
        mutationIds: ["ev_mutation_edit_1"],
      },
    });
  });

  test("includes review actions in evidence bundles and handoff text", () => {
    const reviewed = applyDiffReviewAction(
      createReviewState(),
      { type: "reject_file", path: "src/app.ts" },
      { now: () => LATER },
    );
    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_1",
      completionStatus: "completed_with_unverified_changes",
      summary: "Rejected generated changes.",
      ledger: emptySummary(),
      reviewActions: reviewed.actions,
      now: () => LATER,
    });

    expect(bundle.reviewActions).toHaveLength(1);
    expect(formatEvidenceBundleForHandoff(bundle)).toContain("- Review: Rejected file change: src/app.ts");
  });
});

function createReviewState() {
  const diff = buildEvidenceDiffSummary({
    files: [
      {
        path: "src/app.ts",
        operation: "modified",
        oldText: "const a = 1;\n",
        newText: "const a = 2;\nconst b = 3;\n",
        mutationIds: ["ev_mutation_edit_1"],
      },
    ],
  });

  return createDiffReviewState({
    turnId: "turn_1",
    diff,
    hunks: [
      {
        id: "hunk_1",
        path: "src/app.ts",
        header: "@@ const a @@",
        added: 1,
        removed: 1,
        mutationIds: ["ev_mutation_edit_1"],
      },
      {
        id: "hunk_2",
        path: "src/app.ts",
        header: "@@ const b @@",
        added: 1,
        removed: 0,
        mutationIds: ["ev_mutation_edit_1"],
      },
    ],
    now: () => NOW,
  });
}

function emptySummary(): EvidenceLedgerSummary {
  return {
    successfulToolCallIds: new Set(),
    verificationEvidenceCallIds: new Set(),
    inspectionEvidenceCallIds: new Set(),
    verificationKinds: new Set(),
    needsVerification: false,
    hasUsedTools: false,
    hasMutatedFiles: false,
    hasCodeMutations: false,
    hasDocsMutations: false,
    unverifiedMutationIds: [],
    unverifiedCodeMutationIds: [],
    unverifiedDocsMutationIds: [],
    activeDiagnosticIds: [],
    unresolvedVerificationFailureIds: [],
    entries: [],
  };
}
