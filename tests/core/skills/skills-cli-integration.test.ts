/**
 * Skills CLI Integration Tests — Phase 2
 *
 * Verifies that SkillManager is properly bootstrapped in CLI and integrates with AgentLoop.
 * Spec: internal-design-notes § I.5
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { SkillManager } from "../../../src/application/skills/skill-manager";

describe("Skills CLI Integration", () => {
  let testDir: string;
  let sobaDir: string;
  let bundledSkillsDir: string;
  let userSkillsDir: string;
  let projectDir: string;

  function createBundledPlaybookSkill(name: string, description: string, extraBody = ""): string {
    const skillDir = join(bundledSkillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: ${description}
soba:
  version: 1
  triggers:
    - ${name}
  memory-policy: none
---

# ${name}

${extraBody}

## Purpose

Purpose for ${name}.

## Triggers

Use when ${name} is relevant.

## Inputs To Inspect

- Relevant task context

## Procedure

1. Inspect inputs.
2. Apply the skill.

## Verification Contract

Verify the output against inspected evidence.

## Failure Recovery

Retry with narrower context if verification fails.

## Memory Policy

Do not write memory.

## Stop Conditions

Stop when the requested output is complete.

## Anti-Patterns

- Do not ignore project instructions.
`,
    );
    return skillDir;
  }

  beforeEach(() => {
    // Create isolated test directories
    testDir = join(tmpdir(), `soba-skills-cli-test-${Date.now()}`);
    sobaDir = join(testDir, ".soba");
    bundledSkillsDir = join(testDir, "bundled-skills");
    userSkillsDir = join(sobaDir, "skills");
    projectDir = join(testDir, "project");

    mkdirSync(testDir, { recursive: true });
    mkdirSync(sobaDir, { recursive: true });
    mkdirSync(bundledSkillsDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("SkillManager инициализируется при старте CLI", () => {
    const trustStore = new ProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    // Initial scan should not throw
    expect(() => skillManager.refresh()).not.toThrow();

    // getCatalogForPrompt should return empty array when no skills exist
    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toEqual([]);
  });

  test("Bundled skills обнаруживаются без копирования", () => {
    // Create a bundled skill
    createBundledPlaybookSkill("test-bundled-skill", "A test bundled skill", "This is a test skill.");

    const trustStore = new ProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    skillManager.refresh();

    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toHaveLength(1);
    expect(catalogForPrompt[0].name).toBe("test-bundled-skill");
    expect(catalogForPrompt[0].description).toBe("A test bundled skill");
  });

  test("Project skills не читаются до trust approval", () => {
    // Create a project skill
    const projectSkillsDir = join(projectDir, ".soba", "skills");
    const skillDir = join(projectSkillsDir, "test-project-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: test-project-skill
description: A test project skill
---

# Test Project Skill

This is a project skill.
`,
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    skillManager.refresh();

    // Project skills should not appear in catalog without trust
    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toHaveLength(0);

    // Check diagnostics show untrusted project warning
    const diagnostics = catalog.getDiagnostics();
    const untrustedWarning = diagnostics.find(
      (d) => d.code === "PROJECT_NOT_TRUSTED",
    );
    expect(untrustedWarning).toBeDefined();
    expect(untrustedWarning?.severity).toBe("warning");
  });

  test("Catalog refresh обновляет список skills без restart", () => {
    const trustStore = new ProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    // Initial scan - no skills
    skillManager.refresh();
    expect(skillManager.getCatalogForPrompt()).toHaveLength(0);

    // Add a skill
    createBundledPlaybookSkill("new-skill", "A newly added skill", "This skill was added after initial scan.");

    // Refresh should pick up the new skill
    skillManager.refresh();
    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toHaveLength(1);
    expect(catalogForPrompt[0].name).toBe("new-skill");
  });

  test("Trust store persistence работает между сессиями", () => {
    const projectIdentity = ProjectTrustStore.computeProjectIdentity(projectDir);

    // First session - approve project
    const trustStore1 = new ProjectTrustStore({ sobaDir });
    expect(trustStore1.isTrusted(projectIdentity)).toBe(false);

    trustStore1.approve(projectIdentity, "test-fingerprint-1");
    expect(trustStore1.isTrusted(projectIdentity)).toBe(true);

    // Second session - should still be trusted
    const trustStore2 = new ProjectTrustStore({ sobaDir });
    expect(trustStore2.isTrusted(projectIdentity)).toBe(true);

    const record = trustStore2.getRecord(projectIdentity);
    expect(record).toBeDefined();
    expect(record?.skillsFingerprint).toBe("test-fingerprint-1");
  });

  test("Project skills доступны после trust approval", () => {
    // Create a project skill
    const projectSkillsDir = join(projectDir, ".soba", "skills");
    const skillDir = join(projectSkillsDir, "test-project-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: test-project-skill
description: A test project skill
---

# Test Project Skill

This is a project skill.
`,
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const projectIdentity = ProjectTrustStore.computeProjectIdentity(projectDir);

    // Approve project
    trustStore.approve(projectIdentity, "test-fingerprint");

    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    skillManager.refresh();

    // Project skills should now appear in catalog
    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toHaveLength(1);
    expect(catalogForPrompt[0].name).toBe("test-project-skill");
  });

  test("Skill activation работает для bundled skills", () => {
    // Create a bundled skill
    createBundledPlaybookSkill(
      "activatable-skill",
      "A skill that can be activated",
      "This skill can be activated by the model.",
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    skillManager.refresh();

    // Activate the skill
    const activationResult = skillManager.activate("activatable-skill");
    expect(activationResult.success).toBe(true);

    // Check that skill is active
    const activeSkills = skillManager.getActiveSkills();
    expect(activeSkills).toHaveLength(1);
    expect(activeSkills[0].name).toBe("activatable-skill");

    // Build ephemeral messages should include the skill
    const messages = skillManager.buildEphemeralMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("developer");
    expect(messages[0].content).toContain("SOBA Active Skill: activatable-skill");
  });

  test("Skill precedence: project > user > bundled", () => {
    // Create same skill in all three locations
    const skillName = "precedence-test-skill";

    // Bundled (lowest precedence)
    createBundledPlaybookSkill(skillName, "Bundled version");

    // User (medium precedence)
    const userSkillDir = join(userSkillsDir, skillName);
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      `---
name: ${skillName}
description: User version
---

# User Version
`,
    );

    // Project (highest precedence) - need to approve first
    const projectSkillsDir = join(projectDir, ".soba", "skills");
    const projectSkillDir = join(projectSkillsDir, skillName);
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      `---
name: ${skillName}
description: Project version
---

# Project Version
`,
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const projectIdentity = ProjectTrustStore.computeProjectIdentity(projectDir);
    trustStore.approve(projectIdentity, "test-fingerprint");

    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({
      catalog,
      discovery,
      trustStore,
    });

    skillManager.refresh();

    const catalogForPrompt = skillManager.getCatalogForPrompt();
    expect(catalogForPrompt).toHaveLength(1);
    expect(catalogForPrompt[0].name).toBe(skillName);
    expect(catalogForPrompt[0].description).toBe("Project version");
  });
});
