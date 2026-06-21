import type {
  PortableCapsuleIntegrationStep,
  PortableCapsuleQualityExpectation,
} from "../../../src/core/capsules";
import type { ContextCapsuleEntry } from "../../../src/core/session/types-v2";

export function makeStructuredCheckpoint(): ContextCapsuleEntry {
  return {
    type: "context_capsule",
    id: "entry-structured",
    timestamp: "2026-06-19T00:00:00.000Z",
    parentId: "entry-parent",
    checkpointId: "ck_struct11111",
    trigger: "milestone",
    strategy: "deterministic",
    quality: "portable",
    portableState: {
      goal: "Implement provider registry API key resolution",
      constraints: ["Bun only", "Do not introduce ESLint"],
      completed: ["Updated provider registry"],
      inProgress: ["Review CLI integration"],
      pending: ["Run provider registry tests"],
      decisions: [
        {
          decision: "Provider registry owns API key resolution",
          rationale: "Keeps adapter construction deterministic",
        },
        {
          decision: "Persisted provider secrets stay out of portable capsules",
          rationale: "Capsules cross trust boundaries",
        },
      ],
      blockers: ["Need manual confirmation for external provider credentials"],
      nextSteps: ["Run bun test tests/core/provider/registry.test.ts"],
    },
    artifacts: {
      readFiles: ["src/core/provider/registry.ts"],
      modifiedFiles: ["src/core/provider/registry.ts", "tests/core/provider/registry.test.ts"],
      verificationCommands: ["bun test tests/core/provider/registry.test.ts"],
      verificationStatus: "passed",
    },
    activatedSkills: [],
    provenance: {
      firstCompactedEntryId: "entry-a",
      firstKeptEntryId: "entry-b",
      sourceEntryIds: ["entry-a", "entry-b"],
    },
    metrics: {
      effectiveTokensBefore: 42_000,
      estimatedTokensAfter: 4_200,
      reclaimedTokens: 37_800,
      savingsRatio: 0.9,
      generationDurationMs: 25,
    },
  };
}

export function makeConversationCheckpoint(): ContextCapsuleEntry {
  return {
    type: "context_capsule",
    id: "entry-conversation",
    timestamp: "2026-06-19T00:00:00.000Z",
    parentId: "entry-parent",
    checkpointId: "ck_convo111111",
    trigger: "user_request",
    strategy: "deterministic",
    quality: "portable",
    portableState: {
      goal: "Prepare a handoff for the auth refactor discussion",
      constraints: ["Keep current CLI behavior backward compatible"],
      completed: ["Compared internal checkpoints with portable capsule framework"],
      inProgress: ["Documenting create export load workflow"],
      pending: ["Ask reviewer to test manual capsule flow"],
      decisions: [
        {
          decision: "Keep /capsule list and inspect behavior unchanged",
          rationale: "Existing users rely on checkpoint inspection",
        },
      ],
      blockers: ["Full bun test has unrelated baseline failures"],
      nextSteps: ["Use manual-test-run checklist"],
    },
    artifacts: {
      readFiles: ["internal-design-notes"],
      modifiedFiles: ["src/cli/commands.ts", "docs/portable-capsules.md"],
      verificationCommands: ["bun test tests/commands.test.ts"],
      verificationStatus: "passed",
    },
    activatedSkills: [],
    provenance: {
      firstCompactedEntryId: "entry-c",
      firstKeptEntryId: "entry-d",
      sourceEntryIds: ["entry-c", "entry-d"],
    },
    metrics: {
      effectiveTokensBefore: 24_000,
      estimatedTokensAfter: 3_600,
      reclaimedTokens: 20_400,
      savingsRatio: 0.85,
      generationDurationMs: 20,
    },
  };
}

export const structuredIntegrationPlan: PortableCapsuleIntegrationStep[] = [
  {
    order: 1,
    mode: "manual",
    title: "Review provider registry API key resolution",
    prerequisites: ["Open src/core/provider/registry.ts"],
    actions: ["Check provider registry owns API key resolution"],
    verification: ["bun test tests/core/provider/registry.test.ts"],
    rollback: ["Do not apply changes; keep current provider registry implementation"],
  },
];

export const structuredExpectation: PortableCapsuleQualityExpectation = {
  goalKeywords: ["provider registry", "API key resolution"],
  decisions: [
    "Provider registry owns API key resolution",
    "Persisted provider secrets stay out of portable capsules",
  ],
  blockers: ["external provider credentials"],
  artifacts: {
    readFiles: ["src/core/provider/registry.ts"],
    modifiedFiles: ["src/core/provider/registry.ts", "tests/core/provider/registry.test.ts"],
    verificationCommands: ["bun test tests/core/provider/registry.test.ts"],
    verificationStatus: "passed",
  },
  integrationActions: ["Check provider registry owns API key resolution"],
};

export const conversationExpectation: PortableCapsuleQualityExpectation = {
  goalKeywords: ["auth refactor", "handoff"],
  decisions: ["Keep /capsule list and inspect behavior unchanged"],
  blockers: ["baseline failures"],
  artifacts: {
    readFiles: ["internal-design-notes"],
    modifiedFiles: ["src/cli/commands.ts"],
    verificationCommands: ["bun test tests/commands.test.ts"],
    verificationStatus: "passed",
  },
  integrationActions: ["manual-test-run checklist"],
};
