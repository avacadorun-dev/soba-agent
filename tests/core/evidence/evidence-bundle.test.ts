import { describe, expect, test } from "bun:test";
import {
  buildEvidenceBundle,
  type EvidenceChangedFile,
  type EvidenceCommandRun,
  formatEvidenceBundleForHandoff,
} from "../../../src/engine/evidence";
import type { EvidenceEntry, EvidenceLedgerSummary } from "../../../src/engine/evidence/evidence-ledger";

const NOW = new Date("2026-06-27T00:00:00.000Z");

describe("Evidence Bundle builder", () => {
  test("builds a verified bundle for a code mutation with passing command evidence", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "success",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
        resolves: ["bash_1"],
      }),
      verificationEntry({
        id: "ev_verification_bash_1",
        status: "success",
        toolCallId: "bash_1",
        command: "bun test",
        verificationKind: "test",
        mutationIds: ["ev_mutation_edit_1"],
        durationMs: 4210,
        exitCode: 0,
        cwd: "/repo",
        outputPreview: "tests passed",
        outputDigest: "sha256:abc123",
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_1",
      completionStatus: "completed",
      summary: "Patched app and verified tests.",
      criteria: [{ criterion: "App patch is covered by tests", evidenceIds: ["ev_verification_bash_1"] }],
      ledger: summary(entries, { hasCodeMutations: true }),
      now: () => NOW,
    });

    expect(bundle).toMatchObject({
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Patched app and verified tests.",
      createdAt: "2026-06-27T00:00:00.000Z",
    });
    expect(bundle.changedFiles).toEqual([
      {
        path: "src/app.ts",
        operation: "unknown",
        source: "tool_edit",
        mutationIds: ["ev_mutation_edit_1"],
      },
    ]);
    expect(bundle.commands).toMatchObject([
      {
        command: "bun test",
        status: "passed",
        verificationKind: "test",
        durationMs: 4210,
        exitCode: 0,
        cwd: "/repo",
        outputPreview: "tests passed",
        outputDigest: "sha256:abc123",
      },
    ]);
    expect(bundle.checks).toMatchObject([{ label: "Tests", status: "passed", verificationKind: "test" }]);
    expect(bundle.evidence).toMatchObject([
      {
        id: "ev_mutation_edit_1",
        kind: "mutation",
        status: "success",
        files: ["src/app.ts"],
      },
      {
        id: "ev_verification_bash_1",
        kind: "verification",
        status: "success",
        command: "bun test",
      },
    ]);
    expect(bundle.claims).toEqual([
      {
        id: "claim_1",
        claim: "App patch is covered by tests",
        status: "supported",
        evidenceIds: ["ev_verification_bash_1"],
      },
    ]);
    expect(bundle.risks).toEqual([]);
  });

  test("marks criteria without known evidence as unsupported or unverified claims", () => {
    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_claims",
      completionStatus: "completed_with_unverified_changes",
      summary: "Recorded criteria.",
      criteria: [
        { criterion: "Known mutation exists", evidenceIds: ["ev_mutation_edit_1"] },
        { criterion: "Missing evidence exists", evidenceIds: ["ev_missing"] },
        { criterion: "No explicit evidence" },
      ],
      ledger: summary([
        mutationEntry({
          id: "ev_mutation_edit_1",
          status: "unverified",
          toolCallId: "edit_1",
          toolName: "edit",
          files: ["src/app.ts"],
        }),
      ], {
        hasCodeMutations: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
      now: () => NOW,
    });

    expect(bundle.claims.map((claim) => claim.status)).toEqual(["supported", "unsupported", "unverified"]);
  });

  test("marks code mutations without verification as unverified", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "unverified",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_2",
      completionStatus: "completed_with_unverified_changes",
      summary: "Patched app without running checks.",
      ledger: summary(entries, {
        hasCodeMutations: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("unverified");
    expect(bundle.checks).toContainEqual({
      id: "check_command_verification_not_run",
      label: "Command verification",
      status: "not_run",
      reason: "Code changes have no passing command verification evidence.",
    });
    expect(bundle.risks.map((risk) => risk.kind)).toEqual(["skipped_check", "unverified_changes"]);
  });

  test("marks unknown file mutations without verification as unverified", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "unverified",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["generated"],
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_unknown",
      completionStatus: "completed_with_unverified_changes",
      summary: "Changed an unknown file path.",
      ledger: summary(entries, {
        hasCodeMutations: false,
        hasDocsMutations: false,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: [],
        unverifiedDocsMutationIds: [],
      }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("unverified");
    expect(bundle.checks).toContainEqual({
      id: "check_mutation_verification_not_run",
      label: "Mutation verification",
      status: "not_run",
      reason: "File changes have no passing verification evidence.",
    });
  });

  test("accepts docs-only mutation with manual inspection evidence", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_docs_1",
        status: "success",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["docs/guide.md"],
        resolves: ["read_1"],
      }),
      inspectEntry({
        id: "ev_inspect_read_1",
        toolCallId: "read_1",
        files: ["docs/guide.md"],
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_3",
      completionStatus: "completed",
      summary: "Updated docs and read them back.",
      ledger: summary(entries, { hasDocsMutations: true }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("verified");
    expect(bundle.checks).toMatchObject([{ label: "Manual inspection", status: "passed", verificationKind: "manual_inspection" }]);
    expect(bundle.risks).toEqual([]);
  });

  test("keeps failed verification visible and marks bundle partially verified", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "unverified",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
      }),
      verificationEntry({
        id: "ev_verification_bash_1",
        status: "failure",
        toolCallId: "bash_1",
        command: "bun test",
        verificationKind: "test",
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_4",
      completionStatus: "completed_with_unverified_changes",
      summary: "Tests were attempted but failed.",
      ledger: summary(entries, {
        hasCodeMutations: true,
        activeDiagnosticIds: ["ev_diagnostic_bash_1"],
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("partially_verified");
    expect(bundle.checks).toMatchObject([{ label: "Tests", status: "failed", verificationKind: "test" }]);
    expect(bundle.commands).toMatchObject([{ command: "bun test", status: "failed" }]);
    expect(bundle.risks.map((risk) => risk.kind)).toEqual([
      "active_diagnostic",
      "failed_check",
      "unverified_changes",
    ]);
  });

  test("does not keep earlier failed verification as an active risk after later same-kind pass", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "success",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
        resolves: ["bash_2"],
      }),
      verificationEntry({
        id: "ev_verification_bash_1",
        status: "failure",
        toolCallId: "bash_1",
        command: "bun run typecheck",
        verificationKind: "typecheck",
      }),
      verificationEntry({
        id: "ev_verification_bash_2",
        status: "success",
        toolCallId: "bash_2",
        command: "bun run typecheck",
        verificationKind: "typecheck",
        mutationIds: ["ev_mutation_edit_1"],
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_retry",
      completionStatus: "completed",
      summary: "Typecheck failed, was fixed, then passed.",
      ledger: summary(entries, { hasCodeMutations: true }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("verified");
    expect(bundle.commands).toMatchObject([
      { command: "bun run typecheck", status: "failed" },
      { command: "bun run typecheck", status: "passed" },
    ]);
    expect(bundle.checks).toMatchObject([{ label: "Typecheck", status: "passed", verificationKind: "typecheck" }]);
    expect(bundle.risks).toEqual([]);
  });

  test("represents skipped verification as a skipped check", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_edit_1",
        status: "unverified",
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
      }),
      verificationEntry({
        id: "ev_verification_skip_1",
        status: "rejected",
        command: "bun run lint",
        verificationKind: "lint",
        summary: "Auto-verifier skipped: bun run lint. Command requires confirmation.",
      }),
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_5",
      completionStatus: "completed_with_unverified_changes",
      summary: "Lint was skipped by policy.",
      ledger: summary(entries, {
        hasCodeMutations: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("partially_verified");
    expect(bundle.checks).toMatchObject([{ label: "Lint", status: "skipped", verificationKind: "lint" }]);
    expect(bundle.checks[0]?.reason).toBe("Auto-verifier skipped: bun run lint. Command requires confirmation.");
    expect(bundle.risks.map((risk) => risk.kind)).toEqual(["skipped_check", "unverified_changes"]);
  });

  test("classifies optional command records without ledger verification entries", () => {
    const commands: EvidenceCommandRun[] = [
      {
        id: "cmd_manual_typecheck",
        command: "bunx tsc --noEmit",
        status: "failed",
        verificationKind: "typecheck",
        exitCode: 2,
      },
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_6",
      completionStatus: "completed_with_unverified_changes",
      summary: "Typecheck failed outside ledger verification.",
      ledger: summary([]),
      commands,
      now: () => NOW,
    });

    expect(bundle.status).toBe("partially_verified");
    expect(bundle.checks).toContainEqual({
      id: "check_cmd_manual_typecheck",
      label: "Typecheck",
      status: "failed",
      verificationKind: "typecheck",
      commandId: "cmd_manual_typecheck",
      reason: "Command failed: bunx tsc --noEmit",
    });
    expect(bundle.risks.map((risk) => risk.kind)).toEqual(["failed_check"]);
  });

  test("blocked completion keeps blocked bundle status", () => {
    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_7",
      completionStatus: "blocked",
      summary: "Blocked waiting for credentials.",
      ledger: summary([], { activeDiagnosticIds: ["ev_diagnostic_auth"] }),
      now: () => NOW,
    });

    expect(bundle.status).toBe("blocked");
    expect(bundle.risks).toMatchObject([{ kind: "active_diagnostic", severity: "error" }]);
  });

  test("merges precomputed changed file snapshots with ledger mutation IDs", () => {
    const entries: EvidenceEntry[] = [
      mutationEntry({
        id: "ev_mutation_write_1",
        status: "unverified",
        toolCallId: "write_1",
        toolName: "write",
        files: ["src/new-file.ts"],
      }),
    ];
    const changedFiles: EvidenceChangedFile[] = [
      {
        path: "src/new-file.ts",
        operation: "created",
        source: "git",
        added: 12,
        removed: 0,
        mutationIds: [],
        remainsChanged: true,
      },
    ];

    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_8",
      completionStatus: "completed_with_unverified_changes",
      summary: "Created a file.",
      ledger: summary(entries, {
        hasCodeMutations: true,
        unverifiedMutationIds: ["ev_mutation_write_1"],
        unverifiedCodeMutationIds: ["ev_mutation_write_1"],
      }),
      changedFiles,
      now: () => NOW,
    });

    expect(bundle.changedFiles).toEqual([
      {
        path: "src/new-file.ts",
        operation: "created",
        source: "git",
        added: 12,
        removed: 0,
        mutationIds: ["ev_mutation_write_1"],
        remainsChanged: true,
      },
    ]);
  });

  test("formats compact handoff text", () => {
    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_9",
      completionStatus: "completed",
      summary: "Done.",
      ledger: summary([
        mutationEntry({
          id: "ev_mutation_edit_1",
          status: "success",
          toolCallId: "edit_1",
          toolName: "edit",
          files: ["src/app.ts"],
        }),
        verificationEntry({
          id: "ev_verification_bash_1",
          status: "success",
          toolCallId: "bash_1",
          command: "bun test",
          verificationKind: "test",
        }),
      ], { hasCodeMutations: true }),
      changedFiles: [
        {
          path: "src/app.ts",
          operation: "modified",
          source: "git",
          added: 3,
          removed: 1,
          mutationIds: ["ev_mutation_edit_1"],
        },
      ],
      approvals: [
        {
          toolCallId: "bash_1",
          toolName: "bash",
          decision: "auto",
          approved: true,
          trustLevel: "safe",
          approvalKind: "command",
          approvalValue: "bun test",
          description: "bash: bun test",
          reason: "safe test command",
        },
      ],
      now: () => NOW,
    });

    expect(formatEvidenceBundleForHandoff(bundle)).toBe(
      "\n**Evidence**\n- Status: verified\n- Changed files: modified src/app.ts (+3/-1)\n- Checks: Tests passed (bun test)\n- Permissions: bash: bun test auto trust=safe\n- Risks: none",
    );
  });

  test("formats diff summary in handoff text when available", () => {
    const bundle = buildEvidenceBundle({
      sessionId: "sess_1",
      turnId: "turn_10",
      completionStatus: "completed",
      summary: "Done.",
      ledger: summary([]),
      diff: {
        fileCount: 2,
        added: 7,
        removed: 1,
        truncated: false,
        files: [],
      },
      now: () => NOW,
    });

    expect(formatEvidenceBundleForHandoff(bundle)).toContain("- Diff: 2 files, +7/-1");
  });
});

function summary(
  entries: EvidenceEntry[],
  overrides: Partial<EvidenceLedgerSummary> = {},
): EvidenceLedgerSummary {
  const verificationEvidenceCallIds = new Set(
    entries.flatMap((entry) =>
      entry.kind === "verification" &&
      entry.status === "success" &&
      entry.toolCallId &&
      entry.verificationKind !== "diff_inspection" &&
      entry.verificationKind !== "manual_inspection"
        ? [entry.toolCallId]
        : [],
    ),
  );
  const inspectionEvidenceCallIds = new Set(
    entries.flatMap((entry) =>
      entry.status === "success" &&
      entry.toolCallId &&
      (entry.verificationKind === "diff_inspection" || entry.verificationKind === "manual_inspection")
        ? [entry.toolCallId]
        : [],
    ),
  );
  const verificationKinds = new Set(
    entries.flatMap((entry) => (entry.status === "success" && entry.verificationKind ? [entry.verificationKind] : [])),
  );
  const unverifiedMutationIds = entries.flatMap((entry) =>
    entry.kind === "mutation" && entry.status === "unverified" ? [entry.id] : [],
  );
  const hasMutatedFiles = entries.some((entry) => entry.kind === "mutation");

  return {
    successfulToolCallIds: new Set(entries.flatMap((entry) => (entry.toolCallId && entry.status === "success" ? [entry.toolCallId] : []))),
    verificationEvidenceCallIds,
    inspectionEvidenceCallIds,
    verificationKinds,
    needsVerification: unverifiedMutationIds.length > 0,
    hasUsedTools: entries.some((entry) => entry.toolCallId !== undefined),
    hasMutatedFiles,
    hasCodeMutations: hasMutatedFiles,
    hasDocsMutations: false,
    unverifiedMutationIds,
    unverifiedCodeMutationIds: unverifiedMutationIds,
    unverifiedDocsMutationIds: [],
    activeDiagnosticIds: [],
    unresolvedVerificationFailureIds: unresolvedVerificationFailures(entries),
    entries,
    ...overrides,
  };
}

function unresolvedVerificationFailures(entries: EvidenceEntry[]): string[] {
  const laterPassingKinds = new Set<string>();
  const unresolved: string[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind !== "verification" || !entry.verificationKind) continue;
    if (entry.status === "success") {
      laterPassingKinds.add(entry.verificationKind);
      continue;
    }
    if (entry.status === "failure" && !laterPassingKinds.has(entry.verificationKind)) {
      unresolved.push(entry.id);
    }
  }

  return unresolved.reverse();
}

function mutationEntry(input: Partial<EvidenceEntry> & Pick<EvidenceEntry, "id" | "status">): EvidenceEntry {
  return {
    kind: "mutation",
    timestamp: 1,
    summary: "mutation",
    ...input,
  };
}

function verificationEntry(input: Partial<EvidenceEntry> & Pick<EvidenceEntry, "id" | "status">): EvidenceEntry {
  return {
    kind: "verification",
    timestamp: 1,
    toolName: "bash",
    summary: input.summary ?? "verification",
    ...input,
  };
}

function inspectEntry(input: Partial<EvidenceEntry> & Pick<EvidenceEntry, "id">): EvidenceEntry {
  return {
    kind: "inspect",
    status: "success",
    timestamp: 1,
    toolName: "read",
    verificationKind: "manual_inspection",
    summary: "manual inspection",
    ...input,
  };
}
