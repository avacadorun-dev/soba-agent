/**
 * Session Format v2 tests.
 *
 * Covers: UC-A5 (transparency / capsule inspection), UC-A6 (portable rewind).
 * Plan A.1 tasks:
 *   - v2 entry types, guards and parser compatibility with v1
 *   - append-only migration marker, mixed v1/v2 reading, legacy compaction continuation
 *   - persistent session_cursor and unambiguous active leaf restoration
 *   - append/list/get for ContextCapsuleEntry
 *   - buildInput() native vs portable continuation selection
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEntriesFromFile,
  SessionManager,
  serializeCapsuleContext,
  serializePortableState,
} from "../../../src/core/session/session-manager";
import type {
  AssistantMessageItemParam,
  CompactionSummaryItemParam,
  UserMessageItemParam,
} from "../../../src/core/session/types";
import type {
  ActivatedSkillRef,
  ArtifactLedger,
  ContextCapsuleEntry,
  PortableContextState,
} from "../../../src/core/session/types-v2";
import {
  generateCheckpointId,
  isContextCapsuleEntry,
  isSessionCursorEntry,
  isSessionMigrationEntry,
  isSkillActivationEntry,
  isValidCheckpointId,
} from "../../../src/core/session/types-v2";

// ─── Helpers ───

function makeUserMsg(text: string): UserMessageItemParam {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

function makeAssistantMsg(text: string): AssistantMessageItemParam {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
}

function makePortableState(goal = "Fix the bug"): PortableContextState {
  return {
    goal,
    constraints: ["No breaking changes"],
    completed: ["Read file.ts"],
    inProgress: ["Edit function"],
    pending: ["Run tests"],
    decisions: [{ decision: "Use async/await", rationale: "cleaner" }],
    blockers: [],
    nextSteps: ["Run bun test"],
  };
}

function makeArtifacts(): ArtifactLedger {
  return {
    readFiles: ["src/foo.ts"],
    modifiedFiles: ["src/bar.ts"],
    verificationCommands: ["bun test"],
    verificationStatus: "passed",
  };
}

function makeCapsulePayload(
  checkpointId: string,
  firstKeptEntryId: string,
  firstCompactedEntryId: string,
): Omit<ContextCapsuleEntry, "id" | "parentId" | "timestamp" | "type"> {
  return {
    checkpointId,
    trigger: "user_request",
    strategy: "portable_only",
    quality: "portable",
    portableState: makePortableState(),
    artifacts: makeArtifacts(),
    activatedSkills: [],
    provenance: {
      firstCompactedEntryId,
      firstKeptEntryId,
      sourceEntryIds: [firstCompactedEntryId],
    },
    metrics: {
      effectiveTokensBefore: 10000,
      estimatedTokensAfter: 3000,
      reclaimedTokens: 7000,
      savingsRatio: 0.7,
      generationDurationMs: 500,
    },
  };
}

// ─── Type guards ───

describe("v2 type guards", () => {
  test("isContextCapsuleEntry recognises context_capsule", () => {
    expect(isContextCapsuleEntry({ type: "context_capsule" })).toBe(true);
    expect(isContextCapsuleEntry({ type: "item" })).toBe(false);
    expect(isContextCapsuleEntry({ type: "compaction" })).toBe(false);
  });

  test("isSkillActivationEntry recognises skill_activation", () => {
    expect(isSkillActivationEntry({ type: "skill_activation" })).toBe(true);
    expect(isSkillActivationEntry({ type: "item" })).toBe(false);
  });

  test("isSessionMigrationEntry recognises session_migration", () => {
    expect(isSessionMigrationEntry({ type: "session_migration" })).toBe(true);
    expect(isSessionMigrationEntry({ type: "item" })).toBe(false);
  });

  test("isSessionCursorEntry recognises session_cursor", () => {
    expect(isSessionCursorEntry({ type: "session_cursor" })).toBe(true);
    expect(isSessionCursorEntry({ type: "debug" })).toBe(false);
  });
});

// ─── Checkpoint ID generation ───

describe("generateCheckpointId / isValidCheckpointId", () => {
  test("generated ID matches ck_<12 hex> format", () => {
    const id = generateCheckpointId(new Set());
    expect(isValidCheckpointId(id)).toBe(true);
    expect(id.startsWith("ck_")).toBe(true);
    expect(id.length).toBe(15); // "ck_" + 12 chars
  });

  test("generates unique IDs", () => {
    const existing = new Set<string>();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = generateCheckpointId(existing);
      ids.add(id);
      existing.add(id);
    }
    expect(ids.size).toBe(50);
  });

  test("isValidCheckpointId rejects invalid formats", () => {
    expect(isValidCheckpointId("ck_ABCDEF123456")).toBe(false); // uppercase
    expect(isValidCheckpointId("ck_abc")).toBe(false); // too short
    expect(isValidCheckpointId("cp_abcdef123456")).toBe(false); // wrong prefix
    expect(isValidCheckpointId("")).toBe(false);
  });
});

// ─── Migration marker ───

describe("Session v2 migration", () => {
  test("appendContextCapsule triggers v2 migration on v1 session", () => {
    const sm = SessionManager.inMemory("/project");
    expect(sm.isV2()).toBe(false);

    const id1 = sm.appendItem(makeUserMsg("hello"));
    const capsuleId = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(capsuleId, id1, id1));

    expect(sm.isV2()).toBe(true);
  });

  test("migration marker is written to file on first v2 entry", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-v2-migration-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("hello"));
    const capsuleId = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(capsuleId, id1, id1));

    const entries = loadEntriesFromFile(sm.getSessionFile()!);
    const migrationEntries = entries.filter((e) => isSessionMigrationEntry(e as { type: string }));
    expect(migrationEntries.length).toBe(1);
    expect((migrationEntries[0] as { fromVersion: number }).fromVersion).toBe(1);
    expect((migrationEntries[0] as { toVersion: number }).toVersion).toBe(2);

    rmSync(tmpDir, { recursive: true });
  });

  test("migration marker is written only once (idempotent)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-v2-idempotent-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("msg1"));
    const id2 = sm.appendItem(makeUserMsg("msg2"));

    const ck1 = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck1, id1, id1));

    const ck2 = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck2, id2, id2));

    const entries = loadEntriesFromFile(sm.getSessionFile()!);
    const migrationEntries = entries.filter((e) => isSessionMigrationEntry(e as { type: string }));
    expect(migrationEntries.length).toBe(1);

    rmSync(tmpDir, { recursive: true });
  });

  test("v2 session restored from file has isV2() = true", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-v2-reopen-"));
    const sm = SessionManager.create("/project", tmpDir);
    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    expect(sm2.isV2()).toBe(true);

    rmSync(tmpDir, { recursive: true });
  });
});

// ─── Persistent cursor ───

describe("Session cursor (persistent leaf)", () => {
  test("v2 session writes cursor after appendItem", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-cursor-append-"));
    // Make it persisted
    const smPersisted = SessionManager.create("/project", tmpDir);
    // Trigger v2 migration first
    const id1 = smPersisted.appendItem(makeUserMsg("hello"));
    const ck = smPersisted.generateCheckpointId();
    smPersisted.appendContextCapsule(makeCapsulePayload(ck, id1, id1));

    smPersisted.appendItem(makeUserMsg("after capsule"));

    const entries = loadEntriesFromFile(smPersisted.getSessionFile()!);
    const cursors = entries.filter((e) => isSessionCursorEntry(e as { type: string }));
    expect(cursors.length).toBeGreaterThan(0);

    rmSync(tmpDir, { recursive: true });
  });

  test("reopen v2 session restores leaf from cursor", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-cursor-restore-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("root"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));
    const id3 = sm.appendItem(makeUserMsg("after capsule"));
    sm.appendItem(makeAssistantMsg("response"));
    const id5 = sm.appendItem(makeUserMsg("last message"));

    expect(sm.getLeafId()).toBe(id5);

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    expect(sm2.getLeafId()).toBe(id5);

    rmSync(tmpDir, { recursive: true });
    void id3;
  });

  test("rewind in v2 session persists cursor so restart restores rewound leaf", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-cursor-rewind-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("root"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));
    sm.appendItem(makeUserMsg("A"));
    sm.appendItem(makeAssistantMsg("B"));

    // Rewind to id1 (the capsule's parent)
    sm.branch(id1);
    expect(sm.getLeafId()).toBe(id1);

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    expect(sm2.getLeafId()).toBe(id1);

    rmSync(tmpDir, { recursive: true });
  });

  test("rewind writes cursor with reason=rewind", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-cursor-reason-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("root"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));
    sm.appendItem(makeUserMsg("after"));
    sm.branch(id1);

    const entries = loadEntriesFromFile(sm.getSessionFile()!);
    const rewindCursors = entries.filter(
      (e) => isSessionCursorEntry(e as { type: string }) && (e as { reason: string }).reason === "rewind",
    );
    expect(rewindCursors.length).toBeGreaterThan(0);

    rmSync(tmpDir, { recursive: true });
  });
});

// ─── ContextCapsule append/list/get ───

describe("ContextCapsuleEntry append/list/get", () => {
  test("appendContextCapsule adds entry to tree", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();

    const capsuleEntryId = sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));
    expect(capsuleEntryId).toBeTruthy();

    const entries = sm.getEntries();
    const capsules = entries.filter((e) => isContextCapsuleEntry(e as { type: string }));
    expect(capsules.length).toBe(1);
  });

  test("getCapsuleEntries returns capsules in current branch", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("msg1"));
    const ck1 = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck1, id1, id1));

    const id3 = sm.appendItem(makeUserMsg("msg2"));
    const ck2 = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck2, id3, id3));

    const capsules = sm.getCapsuleEntries();
    expect(capsules.length).toBe(2);
    expect(capsules[0].checkpointId).toBe(ck1);
    expect(capsules[1].checkpointId).toBe(ck2);
  });

  test("getCapsuleByCheckpointId finds capsule by ID", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));

    const found = sm.getCapsuleByCheckpointId(ck);
    expect(found).toBeDefined();
    expect(found?.checkpointId).toBe(ck);
    expect(found?.portableState.goal).toBe("Fix the bug");
  });

  test("getCapsuleByCheckpointId returns undefined for unknown ID", () => {
    const sm = SessionManager.inMemory("/project");
    expect(sm.getCapsuleByCheckpointId("ck_000000000000")).toBeUndefined();
  });

  test("capsule entries survive round-trip to disk", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-capsule-roundtrip-"));
    const sm = SessionManager.create("/project", tmpDir);

    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));
    sm.appendItem(makeAssistantMsg("response"));

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    const capsules = sm2.getCapsuleEntries();
    expect(capsules.length).toBe(1);
    expect(capsules[0].checkpointId).toBe(ck);
    expect(capsules[0].portableState.goal).toBe("Fix the bug");
    expect(capsules[0].artifacts.verificationStatus).toBe("passed");

    rmSync(tmpDir, { recursive: true });
  });

  test("capsule checkpoint IDs are unique within session", () => {
    const sm = SessionManager.inMemory("/project");
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = sm.appendItem(makeUserMsg(`msg ${i}`));
      const ck = sm.generateCheckpointId();
      sm.appendContextCapsule(makeCapsulePayload(ck, id, id));
      ids.add(ck);
    }
    expect(ids.size).toBe(10);
  });
});

// ─── buildInput with Context Capsule ───

describe("buildInput with ContextCapsule (portable continuation)", () => {
  test("buildInput uses portable state when no provider key given", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));
    sm.appendItem(makeAssistantMsg("hi"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id1, id1));

    const keptId = sm.appendItem(makeUserMsg("continue"));

    const input = sm.buildInput(); // no provider key
    // First item should be the portable state developer message
    expect(input.items.length).toBeGreaterThan(0);
    expect(input.items[0].type).toBe("message");
    expect((input.items[0] as { role: string }).role).toBe("system");
    const text = ((input.items[0] as { content: Array<{ text: string }> }).content[0]).text;
    expect(text).toContain("SOBA Context Capsule");
    expect(text).toContain("Fix the bug");

    // Kept items after capsule
    expect(input.items[1].type).toBe("message");
    expect((input.items[1] as { role: string }).role).toBe("user");
    void keptId;
  });

  test("buildInput uses native continuation when compatibility key matches", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();

    const nativeItems = [{ type: "message" as const, role: "system" as const, content: [{ type: "input_text" as const, text: "native compact data" }] }];
    const capsulePayload = {
      ...makeCapsulePayload(ck, id1, id1),
      strategy: "native_portable" as const,
      quality: "native" as const,
      nativeContinuation: {
        provider: { adapterId: "openai", endpointOrigin: "https://api.openai.com", model: "gpt-4o" },
        compatibilityKey: "compat-key-abc",
        items: nativeItems,
      },
    };
    sm.appendContextCapsule(capsulePayload);

    const input = sm.buildInput("compat-key-abc");
    // Should use native items
    expect(input.items[0]).toEqual(nativeItems[0]);
  });

  test("buildInput falls back to portable when compatibility key mismatches", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));
    const ck = sm.generateCheckpointId();

    const capsulePayload = {
      ...makeCapsulePayload(ck, id1, id1),
      nativeContinuation: {
        provider: { adapterId: "openai", endpointOrigin: "https://api.openai.com", model: "gpt-4o" },
        compatibilityKey: "original-key",
        items: [{ type: "message", role: "system", content: "native" }],
      },
    };
    sm.appendContextCapsule(capsulePayload);

    const input = sm.buildInput("different-key"); // mismatch
    const text = ((input.items[0] as { content: Array<{ text: string }> }).content[0]).text;
    expect(text).toContain("SOBA Context Capsule");
  });

  test("buildInput falls back to legacy compaction when no capsule exists", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendItem(makeUserMsg("old"));
    const keptId = sm.appendItem(makeUserMsg("kept"));
    sm.appendItem(makeAssistantMsg("response"));

    const compactionItem: CompactionSummaryItemParam = {
      type: "compaction",
      encrypted_content: "Legacy summary",
    };
    sm.appendCompaction("resp_legacy", compactionItem, keptId, 1000);

    const input = sm.buildInput();
    expect(input.items[0].type).toBe("compaction");
    expect(input.previousResponseId).toBe("resp_legacy");
  });

  test("buildInput includes items after capsule's firstKeptEntryId", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendItem(makeUserMsg("compacted msg 1"));
    sm.appendItem(makeAssistantMsg("compacted response 1"));
    const keptId = sm.appendItem(makeUserMsg("kept from here"));
    sm.appendItem(makeAssistantMsg("kept response"));

    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, keptId, "root"));

    sm.appendItem(makeUserMsg("new message after capsule"));

    const input = sm.buildInput();
    // items: [portable_state, kept_msg, kept_response, new_message]
    expect(input.items.length).toBe(4);
    const text = ((input.items[0] as { content: Array<{ text: string }> }).content[0]).text;
    expect(text).toContain("SOBA Context Capsule");
  });
});

// ─── Skill activation tracking ───

describe("SkillActivation tracking", () => {
  const skillRef: ActivatedSkillRef = {
    name: "commit-message",
    scope: "bundled",
    revision: "v1.0.0",
    contentHash: "abc123def456",
  };

  test("appendSkillActivation adds entry to tree", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendSkillActivation({ action: "activate", skill: skillRef });

    const entries = sm.getEntries();
    const activations = entries.filter((e) => isSkillActivationEntry(e as { type: string }));
    expect(activations.length).toBe(1);
  });

  test("getActiveSkillRefs returns activated skills", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendSkillActivation({ action: "activate", skill: skillRef });

    const refs = sm.getActiveSkillRefs();
    expect(refs.length).toBe(1);
    expect(refs[0].name).toBe("commit-message");
  });

  test("deactivation removes skill from active refs", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendSkillActivation({ action: "activate", skill: skillRef });
    sm.appendSkillActivation({ action: "deactivate", skill: skillRef });

    const refs = sm.getActiveSkillRefs();
    expect(refs.length).toBe(0);
  });

  test("capsule carries skill refs; subsequent activations apply on top", () => {
    const sm = SessionManager.inMemory("/project");
    const id1 = sm.appendItem(makeUserMsg("hello"));

    const ck = sm.generateCheckpointId();
    const capsulePayload = {
      ...makeCapsulePayload(ck, id1, id1),
      activatedSkills: [skillRef],
    };
    sm.appendContextCapsule(capsulePayload);

    const anotherSkill: ActivatedSkillRef = {
      name: "lint-fix",
      scope: "bundled",
      revision: "v1.0.0",
      contentHash: "deadbeef1234",
    };
    sm.appendSkillActivation({ action: "activate", skill: anotherSkill });

    const refs = sm.getActiveSkillRefs();
    expect(refs.length).toBe(2);
    expect(refs.find((r) => r.name === "commit-message")).toBeDefined();
    expect(refs.find((r) => r.name === "lint-fix")).toBeDefined();
  });

  test("skill activation triggers v2 migration", () => {
    const sm = SessionManager.inMemory("/project");
    expect(sm.isV2()).toBe(false);
    sm.appendSkillActivation({ action: "activate", skill: skillRef });
    expect(sm.isV2()).toBe(true);
  });
});

// ─── serializePortableState ───

describe("serializePortableState", () => {
  test("serializes all sections", () => {
    const state = makePortableState("Implement feature X");
    const text = serializePortableState(state);

    expect(text).toContain("## Goal");
    expect(text).toContain("Implement feature X");
    expect(text).toContain("## Constraints");
    expect(text).toContain("No breaking changes");
    expect(text).toContain("## Completed");
    expect(text).toContain("Read file.ts");
    expect(text).toContain("## In Progress");
    expect(text).toContain("Edit function");
    expect(text).toContain("## Pending");
    expect(text).toContain("Run tests");
    expect(text).toContain("## Decisions");
    expect(text).toContain("Use async/await");
    expect(text).toContain("cleaner");
    expect(text).toContain("## Next Steps");
    expect(text).toContain("Run bun test");
  });

  test("omits empty sections", () => {
    const state: PortableContextState = {
      goal: "Simple goal",
      constraints: [],
      completed: [],
      inProgress: [],
      pending: [],
      decisions: [],
      blockers: [],
      nextSteps: [],
    };
    const text = serializePortableState(state);
    expect(text).toContain("## Goal");
    expect(text).not.toContain("## Constraints");
    expect(text).not.toContain("## Completed");
    expect(text).not.toContain("## Blockers");
  });

  test("includes blockers section when present", () => {
    const state = { ...makePortableState(), blockers: ["CI is broken"] };
    const text = serializePortableState(state);
    expect(text).toContain("## Blockers");
    expect(text).toContain("CI is broken");
  });

  test("decisions with rationale are formatted correctly", () => {
    const state: PortableContextState = {
      goal: "G",
      constraints: [],
      completed: [],
      inProgress: [],
      pending: [],
      decisions: [
        { decision: "Use TypeScript", rationale: "type safety" },
        { decision: "Use Bun" },
      ],
      blockers: [],
      nextSteps: [],
    };
    const text = serializePortableState(state);
    expect(text).toContain("rationale: type safety");
    expect(text).toContain("Use Bun");
    expect(text).not.toContain("rationale: undefined");
  });
});

describe("serializeCapsuleContext", () => {
  test("includes artifacts, verification status and active skills", () => {
    const text = serializeCapsuleContext(
      makePortableState("Continue implementation"),
      {
        readFiles: ["src/input.ts"],
        modifiedFiles: ["src/output.ts"],
        verificationCommands: ["bun test"],
        verificationStatus: "failed",
      },
      [
        {
          name: "review",
          scope: "project",
          revision: "rev-1",
          contentHash: "abc123",
        },
      ],
    );

    expect(text).toContain("## Artifacts");
    expect(text).toContain("Verification status: failed");
    expect(text).toContain("Modified: src/output.ts");
    expect(text).toContain("Verification command: bun test");
    expect(text).toContain("## Active Skills");
    expect(text).toContain("review (project, revision rev-1, hash abc123)");
  });
});

// ─── Legacy v1 session compatibility ───

describe("v1 session compatibility", () => {
  test("v1 session opens without migration entry", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-v1-compat-"));
    const sm = SessionManager.create("/project", tmpDir);
    sm.appendItem(makeUserMsg("v1 message"));
    sm.appendItem(makeAssistantMsg("v1 response"));

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    expect(sm2.isV2()).toBe(false);
    expect(sm2.getBranch().length).toBe(2);

    rmSync(tmpDir, { recursive: true });
  });

  test("v1 session with legacy compaction continues to work after v2 entries added", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMsg("old"));
    const keptId = sm.appendItem(makeUserMsg("kept"));
    sm.appendItem(makeAssistantMsg("response"));

    const compactionItem: CompactionSummaryItemParam = {
      type: "compaction",
      encrypted_content: "Legacy summary",
    };
    sm.appendCompaction("resp_legacy", compactionItem, keptId, 1000);

    // Now add a v2 capsule
    const id5 = sm.appendItem(makeUserMsg("after legacy compact"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id5, keptId));

    // buildInput should use capsule (v2 takes precedence)
    const input = sm.buildInput();
    const text = ((input.items[0] as { content: Array<{ text: string }> }).content[0]).text;
    expect(text).toContain("SOBA Context Capsule");
  });

  test("mixed v1/v2 session file is parseable", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-mixed-"));
    const sm = SessionManager.create("/project", tmpDir);

    // v1 items
    sm.appendItem(makeUserMsg("v1 msg"));
    sm.appendItem(makeAssistantMsg("v1 resp"));

    // Trigger v2 migration
    const id3 = sm.appendItem(makeUserMsg("before capsule"));
    const ck = sm.generateCheckpointId();
    sm.appendContextCapsule(makeCapsulePayload(ck, id3, id3));

    const entries = loadEntriesFromFile(sm.getSessionFile()!);
    expect(entries.some((e) => e.type === "session")).toBe(true);
    expect(entries.some((e) => e.type === "item")).toBe(true);
    expect(entries.some((e) => isSessionMigrationEntry(e as { type: string }))).toBe(true);
    expect(entries.some((e) => isContextCapsuleEntry(e as { type: string }))).toBe(true);
    expect(existsSync(sm.getSessionFile()!)).toBe(true);

    rmSync(tmpDir, { recursive: true });
  });
});
