import { sealProofBundle } from "../../../src/application/evidence/public";

export interface AdversarialProofCase {
  id: string;
  expectedReason: string;
  bundle: Record<string, unknown>;
}

export const adversarialProofCases: AdversarialProofCase[] = [
  adversarialCase("stale-verification", "stale_or_missing_verification", (bundle) => {
    const evidence = bundle.evidence as Array<Record<string, unknown>>;
    evidence.reverse();
  }),
  adversarialCase("masked-nonzero-exit", "passed_command_nonzero_exit", (bundle) => {
    const commands = bundle.commands as Array<Record<string, unknown>>;
    commands[0].exitCode = 1;
  }),
  adversarialCase("unknown-claim-evidence", "unknown_claim_evidence", (bundle) => {
    const claims = bundle.claims as Array<Record<string, unknown>>;
    claims[0].evidenceIds = ["ev_missing"];
  }),
  adversarialCase("incomplete-diff", "incomplete_diff", (bundle) => {
    bundle.diff = { files: [], fileCount: 0, added: 0, removed: 0, truncated: false };
  }),
  adversarialCase("permission-denial-bypass", "permission_denial_bypassed", (bundle) => {
    bundle.approvals = [
      {
        toolCallId: "bash_1",
        toolName: "bash",
        decision: "deny",
        approved: false,
        trustLevel: "dangerous",
      },
    ];
  }),
];

function adversarialCase(
  id: string,
  expectedReason: string,
  mutate: (bundle: Record<string, unknown>) => void,
): AdversarialProofCase {
  const bundle = validChangedCodeProof();
  mutate(bundle);
  return { id, expectedReason, bundle: sealProofBundle(bundle) };
}

function validChangedCodeProof(): Record<string, unknown> {
  return {
    version: 1,
    sessionId: "sess_adversarial",
    turnId: "turn_1",
    status: "verified",
    summary: "Changed code and verified it.",
    evidence: [
      {
        id: "ev_mutation_1",
        kind: "mutation",
        status: "success",
        summary: "Changed src/app.ts",
        timestamp: 1,
        toolCallId: "edit_1",
        toolName: "edit",
        files: ["src/app.ts"],
      },
      {
        id: "ev_verification_1",
        kind: "verification",
        status: "success",
        summary: "Tests passed",
        timestamp: 2,
        toolCallId: "bash_1",
        toolName: "bash",
        command: "bun test",
        mutationIds: ["ev_mutation_1"],
      },
    ],
    claims: [
      {
        id: "claim_1",
        claim: "The change passes tests",
        status: "supported",
        evidenceIds: ["ev_verification_1"],
      },
    ],
    changedFiles: [
      {
        path: "src/app.ts",
        operation: "modified",
        source: "tool_edit",
        added: 1,
        removed: 1,
        mutationIds: ["ev_mutation_1"],
      },
    ],
    commands: [
      {
        id: "cmd_1",
        command: "bun test",
        status: "passed",
        exitCode: 0,
        outputDigest: `sha256:${"a".repeat(64)}`,
      },
    ],
    checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
    approvals: [],
    risks: [],
    diff: {
      files: [
        {
          path: "src/app.ts",
          operation: "modified",
          added: 1,
          removed: 1,
          mutationIds: ["ev_mutation_1"],
          truncated: false,
        },
      ],
      fileCount: 1,
      added: 1,
      removed: 1,
      truncated: false,
    },
    reviewActions: [],
    createdAt: "2026-07-12T00:00:00.000Z",
  };
}
