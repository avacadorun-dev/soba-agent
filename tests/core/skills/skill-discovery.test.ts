/**
 * Tests for Skill Discovery, Validation, and Catalog — Phase 2 B.1
 *
 * Covers:
 * - Compatible skill discovery
 * - Invalid skill detection
 * - Standard deviations diagnostic
 * - Collision handling
 * - Untrusted project not read
 * - Canonical identity
 * - Worktree trust isolation
 * - Trust persistence/revoke/reapprove
 * - Fingerprint change
 * - External lazy content hash
 * - Symlink rejection
 * - Cross-agent location
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/core/skills/catalog";
import { SkillDiscovery } from "../../../src/core/skills/discovery";
import { ProjectTrustStore } from "../../../src/core/skills/project-trust-store";
import { computeSkillContentHash, validateSkill } from "../../../src/core/skills/validator";

describe("Skill Discovery, Validation, and Catalog", () => {
  let tempDir: string;
  let sobaDir: string;
  let projectDir: string;
  let userSkillsDir: string;
  let bundledSkillsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-skill-test-"));
    sobaDir = join(tempDir, ".soba");
    projectDir = join(tempDir, "project");
    userSkillsDir = join(sobaDir, "skills");
    bundledSkillsDir = join(tempDir, "bundled-skills");

    mkdirSync(sobaDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    mkdirSync(bundledSkillsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createValidSkill(dir: string, name: string, description?: string): string {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: ${description || `Test skill ${name}`}
---

# ${name}

This is a test skill.
`,
    );
    return skillDir;
  }

  function createBundledPlaybookSkill(dir: string, name: string, description?: string): string {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: ${description || `Test bundled skill ${name}`}
soba:
  version: 1
  triggers:
    - ${name}
  memory-policy: none
---

# ${name}

## Purpose

Define the purpose of this bundled skill.

## Triggers

Use this skill when the task matches ${name}.

## Inputs To Inspect

- Relevant project files

## Procedure

1. Inspect the requested context.
2. Apply the skill-specific workflow.

## Verification Contract

Run the relevant project checks for any changed files.

## Failure Recovery

If verification fails, inspect the failure and retry with a narrower change.

## Memory Policy

Do not write memory unless the user explicitly asks.

## Stop Conditions

Stop when the requested output is complete or a real blocker appears.

## Anti-Patterns

- Do not ignore project instructions.
`,
    );
    return skillDir;
  }

  function createInvalidSkill(dir: string, name: string): string {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
description: Missing name field
---

# Invalid Skill
`,
    );
    return skillDir;
  }

  function createSkillWithSymlink(dir: string, name: string): string {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: Skill with symlink
---

# Skill
`,
    );
    // Create a symlink
    symlinkSync("/etc/passwd", join(skillDir, "symlink.txt"));
    return skillDir;
  }

  describe("Validator", () => {
    test("валидирует корректный skill", () => {
      const skillDir = createValidSkill(userSkillsDir, "test-skill");
      const result = validateSkill(skillDir);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.frontmatter?.name).toBe("test-skill");
      expect(result.frontmatter?.description).toBe("Test skill test-skill");
    });

    test("отклоняет skill без name", () => {
      const skillDir = createInvalidSkill(userSkillsDir, "invalid-skill");
      const result = validateSkill(skillDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_NAME")).toBe(true);
    });

    test("отклоняет skill с неправильным форматом name", () => {
      const skillDir = join(userSkillsDir, "Invalid_Name");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Invalid_Name
description: Invalid name format
---

# Skill
`,
      );

      const result = validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_NAME_FORMAT")).toBe(true);
    });

    test("отклоняет skill с name-directory mismatch", () => {
      const skillDir = join(userSkillsDir, "wrong-dir");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: different-name
description: Name does not match directory
---

# Skill
`,
      );

      const result = validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "NAME_DIRECTORY_MISMATCH")).toBe(true);
    });

    test("отклоняет skill с symlink", () => {
      const skillDir = createSkillWithSymlink(userSkillsDir, "symlink-skill");
      const result = validateSkill(skillDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SYMLINK_DETECTED")).toBe(true);
    });

    test("вычисляет content hash", () => {
      const skillDir = createValidSkill(userSkillsDir, "hash-test");
      const hash = computeSkillContentHash(skillDir);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Same content should produce same hash
      const hash2 = computeSkillContentHash(skillDir);
      expect(hash2).toBe(hash);
    });

    test("предупреждает о SOBA-specific metadata", () => {
      const skillDir = join(userSkillsDir, "soba-meta");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: soba-meta
description: Skill with SOBA metadata
metadata:
  soba.disable-model-invocation: "true"
---

# Skill
`,
      );

      const result = validateSkill(skillDir);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "SOBA_SPECIFIC_METADATA")).toBe(true);
    });

    test("предупреждает о allowed-tools", () => {
      const skillDir = join(userSkillsDir, "tools-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: tools-skill
description: Skill with allowed-tools
allowed-tools:
  - bash
  - write
---

# Skill
`,
      );

      const result = validateSkill(skillDir);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "ALLOWED_TOOLS_NOT_PRE_APPROVED")).toBe(true);
    });

    test("валидирует bundled skill с обязательными playbook секциями", () => {
      const skillDir = createBundledPlaybookSkill(bundledSkillsDir, "bundled-playbook");
      const result = validateSkill(skillDir, { scope: "bundled" });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.frontmatter?.soba?.version).toBe(1);
      expect(result.frontmatter?.soba?.triggers).toEqual(["bundled-playbook"]);
      expect(result.frontmatter?.soba?.memoryPolicy).toBe("none");
    });

    test("отклоняет bundled skill без обязательной секции", () => {
      const skillDir = createBundledPlaybookSkill(bundledSkillsDir, "missing-section");
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: missing-section
description: Missing one bundled section
---

# missing-section

## Purpose

Purpose exists.
`,
      );

      const result = validateSkill(skillDir, { scope: "bundled" });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.code === "MISSING_BUNDLED_SKILL_SECTION")).toBe(true);
      expect(result.errors.some((error) => error.message.includes("Triggers"))).toBe(true);
    });

    test("ясно отклоняет malformed soba metadata", () => {
      const skillDir = createBundledPlaybookSkill(bundledSkillsDir, "bad-soba");
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: bad-soba
description: Skill with malformed soba metadata
soba:
  version: latest
  triggers: commit
  disable-model-invocation: "yes"
  memory-policy: sometimes
---

# bad-soba

## Purpose
Purpose exists.

## Triggers
Triggers exist.

## Inputs To Inspect
Inputs exist.

## Procedure
Procedure exists.

## Verification Contract
Verification exists.

## Failure Recovery
Recovery exists.

## Memory Policy
Memory policy exists.

## Stop Conditions
Stop conditions exist.

## Anti-Patterns
Anti-patterns exist.
`,
      );

      const result = validateSkill(skillDir, { scope: "bundled" });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.code === "INVALID_SOBA_METADATA")).toBe(true);
      expect(result.errors.map((error) => error.message).join("\n")).toContain("soba.version");
      expect(result.errors.map((error) => error.message).join("\n")).toContain("soba.triggers");
    });
  });

  describe("ProjectTrustStore", () => {
    test("сохраняет и загружает trust record", () => {
      const store = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);

      expect(store.isTrusted(identity)).toBe(false);

      const record = store.approve(identity, "fingerprint123");
      expect(record.skillsFingerprint).toBe("fingerprint123");
      expect(store.isTrusted(identity)).toBe(true);

      // Reload and verify persistence
      const store2 = new ProjectTrustStore({ sobaDir });
      expect(store2.isTrusted(identity)).toBe(true);
    });

    test("отзывает trust", () => {
      const store = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);

      store.approve(identity, "fp1");
      expect(store.isTrusted(identity)).toBe(true);

      const revoked = store.revoke(identity);
      expect(revoked).toBe(true);
      expect(store.isTrusted(identity)).toBe(false);
    });

    test("обновляет fingerprint", () => {
      const store = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);

      store.approve(identity, "fp1");
      const updated = store.updateFingerprint(identity, "fp2");

      expect(updated).toBe(true);
      const record = store.getRecord(identity);
      expect(record?.skillsFingerprint).toBe("fp2");
    });

    test("вычисляет canonical identity", () => {
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);
      expect(identity.canonicalRoot).toBeTruthy();
    });

    test("список trusted projects", () => {
      const store = new ProjectTrustStore({ sobaDir });
      const identity1 = ProjectTrustStore.computeProjectIdentity(projectDir);

      const project2 = join(tempDir, "project2");
      mkdirSync(project2, { recursive: true });
      const identity2 = ProjectTrustStore.computeProjectIdentity(project2);

      store.approve(identity1, "fp1");
      store.approve(identity2, "fp2");

      const trusted = store.listTrusted();
      expect(trusted).toHaveLength(2);
    });
  });

  describe("SkillDiscovery", () => {
    test("обнаруживает skills в user directory", () => {
      createValidSkill(userSkillsDir, "user-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("user-skill");
      expect(result.skills[0].scope).toBe("user");
    });

    test("обнаруживает bundled skills", () => {
      createBundledPlaybookSkill(bundledSkillsDir, "bundled-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        bundledSkillsPath: bundledSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("bundled-skill");
      expect(result.skills[0].scope).toBe("bundled");
    });

    test("не читает project skills без trust", () => {
      const projectSkillsDir = join(projectDir, ".soba", "skills");
      mkdirSync(projectSkillsDir, { recursive: true });
      createValidSkill(projectSkillsDir, "project-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(0);
      expect(result.diagnostics.some((d) => d.code === "PROJECT_NOT_TRUSTED")).toBe(true);
    });

    test("читает project skills после trust", () => {
      const projectSkillsDir = join(projectDir, ".soba", "skills");
      mkdirSync(projectSkillsDir, { recursive: true });
      createValidSkill(projectSkillsDir, "project-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);
      trustStore.approve(identity, "fp");

      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("project-skill");
      expect(result.skills[0].scope).toBe("project");
    });

    test("обрабатывает collision с precedence", () => {
      createBundledPlaybookSkill(bundledSkillsDir, "shared-skill", "Bundled version");
      createValidSkill(userSkillsDir, "shared-skill", "User version");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        bundledSkillsPath: bundledSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].description).toBe("User version");
      expect(result.diagnostics.some((d) => d.code === "SKILL_COLLISION")).toBe(true);
    });

    test("обнаруживает cross-agent skills в .agents/skills", () => {
      const agentsSkillsDir = join(projectDir, ".agents", "skills");
      mkdirSync(agentsSkillsDir, { recursive: true });
      createValidSkill(agentsSkillsDir, "cross-agent-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);
      trustStore.approve(identity, "fp");

      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("cross-agent-skill");
    });

    test("добавляет invalid skills в catalog с ошибками", () => {
      createInvalidSkill(userSkillsDir, "invalid-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].enabled).toBe(false);
      expect(result.skills[0].diagnostics.length).toBeGreaterThan(0);
    });

    test("вычисляет content hash для valid skills", () => {
      createValidSkill(userSkillsDir, "hash-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const result = discovery.discover();
      expect(result.skills[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.skills[0].revision).toMatch(/^external_/);
    });

    test("computeFingerprint возвращает детерминированный хеш", () => {
      createValidSkill(userSkillsDir, "fingerprint-skill");
      createValidSkill(bundledSkillsDir, "bundled-fp-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        bundledSkillsPath: bundledSkillsDir,
        trustStore,
      });

      const fp1 = discovery.computeFingerprint(projectDir);
      const fp2 = discovery.computeFingerprint(projectDir);

      expect(fp1).toMatch(/^[a-f0-9]{64}$/);
      expect(fp1).toBe(fp2);
    });

    test("computeFingerprint меняется при изменении skill", () => {
      createValidSkill(userSkillsDir, "changing-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const fp1 = discovery.computeFingerprint(projectDir);

      // Modify the skill content
      const skillDir = join(userSkillsDir, "changing-skill");
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: changing-skill
description: Modified description
---

# changing-skill

This skill has been modified.
`,
      );

      const fp2 = discovery.computeFingerprint(projectDir);
      expect(fp1).not.toBe(fp2);
    });

    test("computeFingerprint включает project skills", () => {
      const projectSkillsDir = join(projectDir, ".soba", "skills");
      mkdirSync(projectSkillsDir, { recursive: true });
      createValidSkill(projectSkillsDir, "project-fp-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const identity = ProjectTrustStore.computeProjectIdentity(projectDir);
      trustStore.approve(identity, "fp");

      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const fp = discovery.computeFingerprint(projectDir);
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("SkillCatalog", () => {
    test("обновляет catalog", () => {
      createValidSkill(userSkillsDir, "catalog-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      expect(catalog.list()).toHaveLength(1);
      expect(catalog.get("catalog-skill")).toBeDefined();
    });

    test("активирует skill", () => {
      createValidSkill(userSkillsDir, "activate-me");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const result = catalog.activate("activate-me");
      expect(result.success).toBe(true);
      expect(result.skill?.name).toBe("activate-me");
    });

    test("отклоняет активацию несуществующего skill", () => {
      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const result = catalog.activate("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("отклоняет активацию disabled skill", () => {
      createInvalidSkill(userSkillsDir, "disabled-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const result = catalog.activate("disabled-skill");
      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
    });

    test("возвращает model-invocable skills", () => {
      createValidSkill(userSkillsDir, "invocable-skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const invocable = catalog.getModelInvocable();
      expect(invocable).toHaveLength(1);
      expect(invocable[0].name).toBe("invocable-skill");
    });

    test("исключает skills с disable-model-invocation", () => {
      const skillDir = join(userSkillsDir, "disabled-invocation");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: disabled-invocation
description: Skill with disabled model invocation
metadata:
  soba.disable-model-invocation: "true"
---

# Skill
`,
      );

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const invocable = catalog.getModelInvocable();
      expect(invocable).toHaveLength(0);
    });

    test("исключает skills с soba.disable-model-invocation", () => {
      const skillDir = join(userSkillsDir, "soba-disabled-invocation");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: soba-disabled-invocation
description: Skill with soba disabled model invocation
soba:
  disable-model-invocation: true
---

# Skill
`,
      );

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const invocable = catalog.getModelInvocable();
      expect(invocable).toHaveLength(0);
    });

    test("генерирует summary для system prompt", () => {
      createValidSkill(userSkillsDir, "summary-skill", "A helpful skill");

      const trustStore = new ProjectTrustStore({ sobaDir });
      const discovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: userSkillsDir,
        trustStore,
      });

      const catalog = new SkillCatalog({ discovery });
      catalog.refresh();

      const summary = catalog.getSummary();
      expect(summary).toContain("summary-skill");
      expect(summary).toContain("A helpful skill");
    });
  });
});
