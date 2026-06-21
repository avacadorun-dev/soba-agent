import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  buildPortableCapsuleFromCheckpoint,
  decodePortableCapsuleMarkdown,
  encodePortableCapsuleMarkdown,
  type PortableCapsule,
  type PortableCapsuleIntegrationStep,
  sanitizePortableCapsule,
  sha256Hex,
  validatePortableCapsule,
} from "../../../src/core/capsules";
import type { ContextCapsuleEntry } from "../../../src/core/session/types-v2";

function makeCapsule(overrides: Partial<PortableCapsule> = {}): PortableCapsule {
  const createdAt = "2026-06-19T00:00:00.000Z";
  const payload = "export const schema = { ok: true };";

  return {
    schema: "soba.portable-capsule",
    version: 1,
    id: "pc_abc123def456",
    title: "Auth handoff",
    createdAt,
    intendedReceiver: "another SOBA-compatible agent",
    objective: "Передать auth decisions",
    tier: "quick",
    category: "conversation_thread",
    archetype: "handoff",
    dispatchSummary: "Auth flow was refactored and needs final verification.",
    coreContent: ["Goal: refactor auth", "Decision: keep provider registry boundaries"],
    patterns: [{ name: "provider-boundary", description: "Provider registry owns API key resolution" }],
    assumptions: ["Bun is the only runtime"],
    signals: ["Run bun test tests/core/provider/registry.test.ts"],
    artifacts: {
      readFiles: ["src/core/provider/registry.ts"],
      modifiedFiles: ["src/core/provider/registry.ts"],
      verificationCommands: ["bun test tests/core/provider/registry.test.ts"],
      verificationStatus: "passed",
    },
    integrationPlan: [],
    verbatimPayloads: [{ name: "schema.ts", mediaType: "text/typescript", content: payload, checksum: sha256Hex(payload) }],
    sanitation: {
      checkedAt: createdAt,
      redactions: [{ category: "api_key", count: 1 }],
      secretLeakDetected: false,
    },
    provenance: { source: "session_checkpoint", checkpointId: "ck_abc123def456" },
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<ContextCapsuleEntry> = {}): ContextCapsuleEntry {
  return {
    type: "context_capsule",
    id: "entry-1",
    timestamp: "2026-06-19T00:00:00.000Z",
    parentId: "entry-0",
    checkpointId: "ck_abc123def456",
    trigger: "user_request",
    strategy: "deterministic",
    quality: "portable",
    portableState: {
      goal: "Ship auth provider fix with apiKey=fake-super-secret-value",
      constraints: ["Use Bun only"],
      completed: ["Updated provider registry"],
      inProgress: ["Review sanitizer"],
      pending: ["Add CLI command"],
      decisions: [{ decision: "Keep load untrusted", rationale: "Capsules cross trust boundaries" }],
      blockers: ["No blocker"],
      nextSteps: ["Run bun test"],
    },
    artifacts: {
      readFiles: ["/tmp/soba-agent/src/core/provider/registry.ts"],
      modifiedFiles: ["src/core/provider/registry.ts"],
      verificationCommands: ["bun test tests/core/provider/registry.test.ts"],
      verificationStatus: "passed",
    },
    activatedSkills: [],
    provenance: {
      firstCompactedEntryId: "entry-1",
      firstKeptEntryId: "entry-2",
      sourceEntryIds: ["entry-1"],
    },
    metrics: {
      effectiveTokensBefore: 10_000,
      estimatedTokensAfter: 1_000,
      reclaimedTokens: 9_000,
      savingsRatio: 0.9,
      generationDurationMs: 10,
    },
    ...overrides,
  };
}

describe("PortableCapsule schema and Markdown codec", () => {
  it("кодирует capsule в .capsule.md и декодирует без потери machine payload", () => {
    const capsule = makeCapsule();
    const markdown = encodePortableCapsuleMarkdown(capsule);
    const decoded = decodePortableCapsuleMarkdown(markdown);

    expect(markdown).toContain("```soba-capsule-json");
    expect(decoded.frontmatter.id).toBe(capsule.id);
    expect(decoded.briefing).toContain("Auth handoff");
    expect(decoded.capsule).toEqual(capsule);
  });

  it("валидирует корректную Quick handoff capsule", () => {
    const result = validatePortableCapsule(makeCapsule());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("PortableCapsule validation", () => {
  it("отклоняет Standard capsule без integration plan", () => {
    const result = validatePortableCapsule(makeCapsule({ tier: "standard", integrationPlan: [] }));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("missing_integration_plan");
  });

  it("отклоняет auto-step без verification и rollback", () => {
    const integrationPlan: PortableCapsuleIntegrationStep[] = [
      {
        order: 1,
        mode: "auto",
        title: "Apply patch",
        prerequisites: [],
        actions: ["Edit src/core/provider/registry.ts"],
        verification: [],
        rollback: [],
      },
    ];

    const result = validatePortableCapsule(makeCapsule({ tier: "standard", integrationPlan }));

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("auto_step_without_verification");
    expect(result.errors.map((error) => error.code)).toContain("auto_step_without_rollback");
  });

  it("отклоняет изменённый verbatim payload по checksum", () => {
    const capsule = makeCapsule({
      verbatimPayloads: [
        {
          name: "schema.ts",
          mediaType: "text/typescript",
          content: "export const schema = { ok: false };",
          checksum: sha256Hex("export const schema = { ok: true };"),
        },
      ],
    });

    const result = validatePortableCapsule(capsule);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("payload_checksum_mismatch");
  });

  it("отклоняет unsanitized secret", () => {
    const result = validatePortableCapsule(
      makeCapsule({
        objective: "Use Bearer very-secret-bearer-token",
        sanitation: { checkedAt: "2026-06-19T00:00:00.000Z", redactions: [], secretLeakDetected: false },
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("unsanitized_secret");
  });
});

describe("PortableCapsule sanitization and checkpoint mapping", () => {
  it("редактирует API keys, bearer tokens, private keys, credential URLs и home paths", () => {
    expect(process.env.HOME).toBeDefined();
    const homePath = join(process.env.HOME ?? "", "project");
    const dirtyCapsule = makeCapsule({
      objective:
        `apiKey=fake-test-secret-1234567890 Bearer abcdefghijklmnop https://user:pass@example.com ${homePath}`,
      coreContent: ["-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"],
      sanitation: { checkedAt: "2026-06-19T00:00:00.000Z", redactions: [], secretLeakDetected: false },
    });

    const sanitized = sanitizePortableCapsule(dirtyCapsule, new Date("2026-06-19T00:00:00.000Z"));
    const serialized = JSON.stringify(sanitized);
    const validation = validatePortableCapsule(sanitized);

    expect(serialized).not.toContain("fake-test-secret");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(homePath);
    expect(sanitized.sanitation.redactions.map((redaction) => redaction.category)).toContain("api_key");
    expect(sanitized.sanitation.redactions.map((redaction) => redaction.category)).toContain("bearer_token");
    expect(sanitized.sanitation.redactions.map((redaction) => redaction.category)).toContain("private_key");
    expect(sanitized.sanitation.redactions.map((redaction) => redaction.category)).toContain("credential_url");
    expect(sanitized.sanitation.redactions.map((redaction) => redaction.category)).toContain("absolute_home_path");
    expect(validation.valid).toBe(true);
  });

  it("строит portable capsule из internal checkpoint без native continuation и с artifact ledger", () => {
    const capsule = buildPortableCapsuleFromCheckpoint(makeCheckpoint(), {
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const validation = validatePortableCapsule(capsule);
    const serialized = JSON.stringify(capsule);

    expect(capsule.provenance).toEqual({ source: "session_checkpoint", checkpointId: "ck_abc123def456" });
    expect(capsule.artifacts.modifiedFiles).toContain("src/core/provider/registry.ts");
    expect(capsule.coreContent.some((entry) => entry.includes("Updated provider registry"))).toBe(true);
    expect(serialized).not.toContain("nativeContinuation");
    expect(serialized).not.toContain("fake-super-secret-value");
    if (process.env.HOME) expect(serialized).not.toContain(process.env.HOME);
    expect(validation.valid).toBe(true);
  });
});
