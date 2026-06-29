/**
 * Tests for Task B.2: Progressive disclosure и activation
 *
 * Covers:
 * - catalog-only prompt
 * - activation content/resources
 * - explicit activation
 * - exact-revision deduplication
 * - no raw skill content in session
 * - explicit args persisted as user message
 * - trust revoke stops injection
 * - missing revision diagnostic
 * - capsule carry-over
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import type { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { SkillManager } from "../../../src/application/skills/skill-manager";
import { handleSkillSlashCommand, isSkillSlashCommand } from "../../../src/application/skills/slash-handler";
import { buildSystemPrompt } from "../../../src/engine/prompt/system-prompt";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { readSkillContentFromDisk } from "../../../src/infrastructure/persistence/skills/skill-file-operations";
import { computeSkillContentHashOnDisk, FilesystemSkillValidationFilesystem, validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";
import type { ActivatedSkillRef } from "../../../src/kernel/transcript/types-v2";

describe("Task B.2: Progressive disclosure и activation", () => {
  let tempDir: string;
  let skillsDir: string;
  let projectDir: string;
  let sobaDir: string;
  let skillManager: SkillManager;
  let trustStore: ProjectTrustStore;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = mkdtempSync(join(tmpdir(), "soba-b2-test-"));
    skillsDir = join(tempDir, "skills");
    projectDir = join(tempDir, "project");
    sobaDir = join(tempDir, ".soba");

    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sobaDir, { recursive: true });

    // Create test skills
    const testSkillDir = join(skillsDir, "test-skill");
    mkdirSync(testSkillDir, { recursive: true });
    writeFileSync(
      join(testSkillDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill for validation
---

# Test Skill

This is a test skill with detailed instructions.

## Usage

Use this skill for testing purposes.
`,
    );

    const scriptDir = join(testSkillDir, "scripts");
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, "helper.sh"), "#!/bin/bash\necho 'helper script'");

    // Initialize trust store and skill manager
    trustStore = createFilesystemProjectTrustStore({ sobaDir });

    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: skillsDir,
      bundledSkillsPath: join(tempDir, "bundled"),
      trustStore,
      files: new FilesystemSkillValidationFilesystem(),
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
    });

    const catalog = new SkillCatalog({ discovery });
    skillManager = new SkillManager({ catalog, discovery, trustStore, readSkillContent: readSkillContentFromDisk });
    
    // Refresh catalog to discover skills
    skillManager.refresh();
  });

  describe("catalog-only prompt", () => {
    it("включает только catalog в system prompt без полного содержимого", () => {
      const catalogForPrompt = skillManager.getCatalogForPrompt();

      expect(catalogForPrompt).toHaveLength(1);
      expect(catalogForPrompt[0].name).toBe("test-skill");
      expect(catalogForPrompt[0].description).toBe("A test skill for validation");

      const prompt = buildSystemPrompt({
        cwd: projectDir,
        skills: catalogForPrompt,
      });

      // Catalog должен быть в prompt
      expect(prompt).toContain("test-skill");
      expect(prompt).toContain("A test skill for validation");
      expect(prompt).toContain("Use activate_skill only when the current task clearly matches");
      expect(prompt).toContain("Do not activate skills for generic exploration");

      // Полное содержимое НЕ должно быть в prompt
      expect(prompt).not.toContain("This is a test skill with detailed instructions");
    });

    it("инжектит project instructions перед generic skill examples", () => {
      const prompt = buildSystemPrompt({
        cwd: projectDir,
        contextFiles: [{ path: "AGENTS.md", content: "Project instructions first." }],
        skills: skillManager.getCatalogForPrompt(),
      });

      const projectIndex = prompt.indexOf("<project_context>");
      const skillsIndex = prompt.indexOf("<available_skills>");

      expect(projectIndex).toBeGreaterThanOrEqual(0);
      expect(skillsIndex).toBeGreaterThanOrEqual(0);
      expect(projectIndex).toBeLessThan(skillsIndex);
      expect(prompt).toContain("Project instructions override generic skill examples");
    });
  });

  describe("activation content/resources", () => {
    it("возвращает содержимое и ресурсы при активации", () => {
      const result = skillManager.activate("test-skill");

      expect(result.success).toBe(true);

      const skill = skillManager.getSkill("test-skill");
      expect(skill).toBeDefined();
      expect(skill?.name).toBe("test-skill");

      // Check that skill has resources directory
      expect(skill?.skillPath).toBeDefined();
    });
  });

  describe("explicit activation", () => {
    it("активирует skill и сохраняет в active skills", () => {
      const result = skillManager.activate("test-skill");

      expect(result.success).toBe(true);
      expect(skillManager.isActive("test-skill")).toBe(true);

      const activeSkills = skillManager.getActiveSkills();
      expect(activeSkills).toHaveLength(1);
      expect(activeSkills[0].name).toBe("test-skill");
    });

    it("деактивирует skill", () => {
      skillManager.activate("test-skill");
      expect(skillManager.isActive("test-skill")).toBe(true);

      const deactivated = skillManager.deactivate("test-skill");
      expect(deactivated).toBe(true);
      expect(skillManager.isActive("test-skill")).toBe(false);
    });

    it("не инжектит deactivated skill", () => {
      skillManager.activate("test-skill");
      expect(skillManager.buildEphemeralMessages()).toHaveLength(1);

      skillManager.deactivate("test-skill");
      const messages = skillManager.buildEphemeralMessages();

      expect(messages).toHaveLength(0);
      expect(messages.some((message) => message.content.includes("SOBA Active Skill: test-skill"))).toBe(false);
    });
  });

  describe("exact-revision deduplication", () => {
    it("дедуплицирует активацию той же revision", () => {
      const result1 = skillManager.activate("test-skill");
      expect(result1.success).toBe(true);

      const ref1 = skillManager.getActiveSkills()[0];

      // Повторная активация той же revision
      const result2 = skillManager.activate("test-skill");
      expect(result2.success).toBe(true);

      const activeSkills = skillManager.getActiveSkills();
      expect(activeSkills).toHaveLength(1); // Не дублируется
      expect(activeSkills[0].revision).toBe(ref1.revision);
    });
  });

  describe("no raw skill content in session", () => {
    it("buildEphemeralMessages возвращает содержимое для injection, но не для session", () => {
      skillManager.activate("test-skill");

      const messages = skillManager.buildEphemeralMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("developer");
      expect(messages[0].content).toContain("SOBA Active Skill: test-skill");
      expect(messages[0].content).toContain("Core safety, completion, verification, tool-selection, and project instructions override this skill.");
      expect(messages[0].content).toContain("<skill_content>");
      expect(messages[0].content).toContain("This is a test skill with detailed instructions");
      expect(messages[0].content).toContain("</skill_content>");

      // Но это ephemeral - не должно сохраняться в session
      // (проверяется на уровне session manager)
    });
  });

  describe("explicit args persisted as user message", () => {
    it("парсит /skill:<name> [args] и возвращает user message", () => {
      const input = "/skill:test-skill Apply this to the current task";

      expect(isSkillSlashCommand(input)).toBe(true);

      const activations: ActivatedSkillRef[] = [];
      const result = handleSkillSlashCommand(input, skillManager, (ref) => {
        activations.push(ref);
      });

      expect(result.success).toBe(true);
      expect(result.activation).toBeDefined();
      expect(result.activation?.name).toBe("test-skill");
      expect(result.userMessage).toBe("Apply this to the current task");
      expect(activations).toHaveLength(1);
    });

    it("создает дефолтное сообщение если args пустые", () => {
      const input = "/skill:test-skill";

      const result = handleSkillSlashCommand(input, skillManager, () => {});

      expect(result.success).toBe(true);
      expect(result.userMessage).toBe("Apply the test-skill skill to the current task.");
    });
  });

  describe("trust revoke stops injection", () => {
    it("прекращает injection после trust revoke", () => {
      // Trust project
      const projectIdentity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(projectDir);
      trustStore.approve(projectIdentity, "fingerprint");

      // Create project skill
      const projectSkillsDir = join(projectDir, ".soba", "skills");
      mkdirSync(projectSkillsDir, { recursive: true });
      const projectSkillDir = join(projectSkillsDir, "project-skill");
      mkdirSync(projectSkillDir, { recursive: true });
      writeFileSync(
        join(projectSkillDir, "SKILL.md"),
        `---
name: project-skill
description: A project-specific skill
---

# Project Skill

Project-specific instructions.
`,
      );

      // Refresh catalog
      skillManager.refresh();

      // Activate test-skill first
      const testResult = skillManager.activate("test-skill");
      expect(testResult.success).toBe(true);

      // Activate project skill
      const result = skillManager.activate("project-skill");
      expect(result.success).toBe(true);

      // Build ephemeral messages - should include both skills
      let messages = skillManager.buildEphemeralMessages();
      expect(messages).toHaveLength(2); // test-skill + project-skill

      // Revoke trust
      trustStore.revoke(projectIdentity);

      // Refresh catalog
      skillManager.refresh();

      // Build ephemeral messages - should NOT include project skill
      messages = skillManager.buildEphemeralMessages();
      expect(messages).toHaveLength(1); // only test-skill
      expect(messages[0].content).not.toContain("Project Skill");
    });
  });

  describe("missing revision diagnostic", () => {
    it("возвращает ошибку для несуществующего skill", () => {
      const result = skillManager.activate("nonexistent-skill");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("capsule carry-over", () => {
    it("восстанавливает active skills из capsule", () => {
      const capsuleSkills: ActivatedSkillRef[] = [
        {
          name: "test-skill",
          scope: "user",
          revision: "rev123",
          contentHash: "hash123",
        },
      ];

      skillManager.restoreFromCapsule(capsuleSkills);

      expect(skillManager.isActive("test-skill")).toBe(true);
      const activeSkills = skillManager.getActiveSkills();
      expect(activeSkills).toHaveLength(1);
      expect(activeSkills[0].revision).toBe("rev123");
    });

    it("применяет activation/deactivation entries после capsule", () => {
      const capsuleSkills: ActivatedSkillRef[] = [
        {
          name: "test-skill",
          scope: "user",
          revision: "rev123",
          contentHash: "hash123",
        },
      ];

      skillManager.restoreFromCapsule(capsuleSkills);

      // Apply deactivation
      skillManager.applyActivationEntries([
        { action: "deactivate", skill: capsuleSkills[0] },
      ]);

      expect(skillManager.isActive("test-skill")).toBe(false);
    });
  });

  describe("slash command parsing", () => {
    it("распознает skill slash commands", () => {
      expect(isSkillSlashCommand("/skill:test-skill")).toBe(true);
      expect(isSkillSlashCommand("/skill:test-skill args")).toBe(true);
      expect(isSkillSlashCommand("/skill:test-skill-2")).toBe(true);
      expect(isSkillSlashCommand("/compact")).toBe(false);
      expect(isSkillSlashCommand("regular message")).toBe(false);
    });
  });

  // Cleanup
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
});
