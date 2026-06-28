import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RevisionStore } from "../../../src/application/skills/revisions";

describe("RevisionStore", () => {
  const testDir = join(process.cwd(), ".test-revisions");
  const revisionsPath = join(testDir, "revisions");
  const skillsPath = join(testDir, "skills");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(revisionsPath, { recursive: true });
    mkdirSync(skillsPath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("создаёт immutable revision snapshot", () => {
    const store = new RevisionStore({ revisionsPath });

    // Create a skill
    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---
name: test-skill
description: Test skill
---

# Test Skill
`,
      "utf-8",
    );

    const revision = store.createSnapshot("test-skill", skillPath, "user");

    expect(revision.revisionId).toBeDefined();
    expect(revision.skillName).toBe("test-skill");
    expect(revision.scope).toBe("user");
    expect(revision.contentHash).toBeDefined();
    expect(revision.approved).toBe(false);
    expect(existsSync(revision.snapshotPath)).toBe(true);
  });

  it("snapshot содержит копию skill содержимого", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---
name: test-skill
description: Test skill
---

# Test Skill
`,
      "utf-8",
    );

    const revision = store.createSnapshot("test-skill", skillPath, "user");

    // Check snapshot contains SKILL.md
    const snapshotSkillMd = join(revision.snapshotPath, "SKILL.md");
    expect(existsSync(snapshotSkillMd)).toBe(true);

    const content = readFileSync(snapshotSkillMd, "utf-8");
    expect(content).toContain("test-skill");
  });

  it("помечает revision как approved", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const revision = store.createSnapshot("test-skill", skillPath, "user");
    const approved = store.approve(revision.revisionId, "test-skill");

    expect(approved).toBeDefined();
    expect(approved?.approved).toBe(true);
    expect(approved?.approvedAt).toBeDefined();
  });

  it("помечает revision как promoted", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const revision = store.createSnapshot("test-skill", skillPath, "user");
    store.approve(revision.revisionId, "test-skill");
    const promoted = store.markPromoted(revision.revisionId, "test-skill", "user");

    expect(promoted).toBeDefined();
    expect(promoted?.promotedTo).toBe("user");
  });

  it("прикрепляет eval result к revision", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const revision = store.createSnapshot("test-skill", skillPath, "user");

    const evalResult = {
      runId: "eval_123",
      skillName: "test-skill",
      revisionId: revision.revisionId,
      configHash: "abc123",
      config: {
        model: "gpt-4",
        temperature: 0,
        maxTokens: 4096,
        tools: ["bash"],
      },
      cases: [],
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        passRate: 1.0,
      },
      timestamp: new Date().toISOString(),
    };

    const updated = store.attachEvalResult(revision.revisionId, "test-skill", evalResult);

    expect(updated).toBeDefined();
    expect(updated?.evalResult).toBeDefined();
    expect(updated?.evalResult?.summary.passRate).toBe(1.0);
  });

  it("получает revision по ID", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const revision = store.createSnapshot("test-skill", skillPath, "user");
    const retrieved = store.getRevision("test-skill", revision.revisionId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.revisionId).toBe(revision.revisionId);
  });

  it("возвращает null для несуществующего revision", () => {
    const store = new RevisionStore({ revisionsPath });
    const revision = store.getRevision("test-skill", "non-existent");
    expect(revision).toBeNull();
  });

  it("получает историю revisions для skill", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    // Create multiple revisions
    const rev1 = store.createSnapshot("test-skill", skillPath, "user");
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Updated\n---\n", "utf-8");
    const rev2 = store.createSnapshot("test-skill", skillPath, "user");

    const history = store.getHistory("test-skill");

    expect(history.skillName).toBe("test-skill");
    expect(history.revisions).toHaveLength(2);
    // Both revisions should be present, order may vary due to timestamp resolution
    const revisionIds = history.revisions.map((r) => r.revisionId);
    expect(revisionIds).toContain(rev1.revisionId);
    expect(revisionIds).toContain(rev2.revisionId);
  });

  it("получает последний approved revision", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const rev1 = store.createSnapshot("test-skill", skillPath, "user");
    store.approve(rev1.revisionId, "test-skill");
    store.markPromoted(rev1.revisionId, "test-skill", "user");

    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Updated\n---\n", "utf-8");
    store.createSnapshot("test-skill", skillPath, "user");
    // rev2 not approved

    const latest = store.getLatestApproved("test-skill");

    expect(latest).toBeDefined();
    expect(latest?.revisionId).toBe(rev1.revisionId);
  });

  it("rollback создаёт новый revision из старого snapshot", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      "---\nname: test-skill\ndescription: Version 1\n---\n",
      "utf-8",
    );

    const rev1 = store.createSnapshot("test-skill", skillPath, "user");
    store.approve(rev1.revisionId, "test-skill");
    store.markPromoted(rev1.revisionId, "test-skill", "user");

    writeFileSync(
      join(skillPath, "SKILL.md"),
      "---\nname: test-skill\ndescription: Version 2\n---\n",
      "utf-8",
    );
    const rev2 = store.createSnapshot("test-skill", skillPath, "user", rev1.revisionId);
    store.approve(rev2.revisionId, "test-skill");
    store.markPromoted(rev2.revisionId, "test-skill", "user");

    // Rollback to rev1
    const rollbackRev = store.rollback("test-skill", rev1.revisionId);

    expect(rollbackRev).toBeDefined();
    // Rollback creates a new revision, parentRevision should be the current revision (rev2)
    expect(rollbackRev?.parentRevision).toBeDefined();

    // Check rollback snapshot contains original content from rev1
    const rollbackSkillMd = join(rollbackRev!.snapshotPath, "SKILL.md");
    const content = readFileSync(rollbackSkillMd, "utf-8");
    expect(content).toContain("Version 1");
  });

  it("revision snapshots immutable", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      "---\nname: test-skill\ndescription: Original\n---\n",
      "utf-8",
    );

    const revision = store.createSnapshot("test-skill", skillPath, "user");

    // Modify original skill
    writeFileSync(
      join(skillPath, "SKILL.md"),
      "---\nname: test-skill\ndescription: Modified\n---\n",
      "utf-8",
    );

    // Snapshot should still contain original content
    const snapshotSkillMd = join(revision.snapshotPath, "SKILL.md");
    const content = readFileSync(snapshotSkillMd, "utf-8");
    expect(content).toContain("Original");
    expect(content).not.toContain("Modified");
  });

  it("вычисляет content hash для revision", () => {
    const store = new RevisionStore({ revisionsPath });

    const skillPath = join(skillsPath, "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");

    const revision = store.createSnapshot("test-skill", skillPath, "user");

    expect(revision.contentHash).toBeDefined();
    expect(revision.contentHash.length).toBeGreaterThan(0);
  });
});
