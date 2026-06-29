import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import type { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { SkillManager } from "../../../src/application/skills/skill-manager";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { readSkillContentFromDisk } from "../../../src/infrastructure/persistence/skills/skill-file-operations";
import { computeSkillContentHashOnDisk, FilesystemSkillValidationFilesystem, validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";

const CORE_BUNDLED_SKILLS = [
  "bug-fix",
  "code-review",
  "codebase-orientation",
  "context-handoff",
  "feature-implementation",
  "fix-until-green",
  "memory-capture",
  "test-authoring",
];

function listRepoBundledSkills(): string[] {
  const repoBundledSkillsDir = join(process.cwd(), "skills");
  return readdirSync(repoBundledSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("B.3: Bundled Skills", () => {
  let tempDir: string;
  let bundledSkillsDir: string;
  let userSkillsDir: string;
  let projectDir: string;
  let trustStore: ProjectTrustStore;
  let skillManager: SkillManager;

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

- Relevant task files

## Procedure

1. Inspect inputs.
2. Follow project instructions.

## Verification Contract

Verify the output against the requested task.

## Failure Recovery

Retry with narrower context when verification fails.

## Memory Policy

Do not write memory.

## Stop Conditions

Stop when the requested result is complete.

## Anti-Patterns

- Do not ignore project instructions.
`,
    );
    return skillDir;
  }

  beforeEach(() => {
    // Create temp directories
    tempDir = join(tmpdir(), `soba-bundled-test-${Date.now()}`);
    bundledSkillsDir = join(tempDir, "bundled-skills");
    userSkillsDir = join(tempDir, "user-skills");
    projectDir = join(tempDir, "project");

    mkdirSync(tempDir, { recursive: true });
    mkdirSync(bundledSkillsDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Initialize trust store
    trustStore = createFilesystemProjectTrustStore({ sobaDir: tempDir });

    // Initialize skill system
    const discovery = new SkillDiscovery({
      bundledSkillsPath: bundledSkillsDir,
      userSkillsPath: userSkillsDir,
      projectPath: projectDir,
      trustStore,
      files: new FilesystemSkillValidationFilesystem(),
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
    });

    const catalog = new SkillCatalog({ discovery });
    skillManager = new SkillManager({ catalog, discovery, trustStore, readSkillContent: readSkillContentFromDisk });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Bundled skills validation", () => {
    it("validates all bundled skills in the repository", () => {
      const repoBundledSkillsDir = join(process.cwd(), "skills");
      const skills = listRepoBundledSkills();

      for (const skillName of skills) {
        const skillPath = join(repoBundledSkillsDir, skillName);
        const result = validateSkillOnDisk(skillPath, { scope: "bundled" });

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.frontmatter?.name).toBe(skillName);
        expect(result.frontmatter?.description).toBeDefined();
        expect(result.frontmatter?.description.length).toBeGreaterThan(0);
      }
    });

    it("bundled skills have proper frontmatter", () => {
      const repoBundledSkillsDir = join(process.cwd(), "skills");
      const skills = listRepoBundledSkills();

      for (const skillName of skills) {
        const skillPath = join(repoBundledSkillsDir, skillName);
        const result = validateSkillOnDisk(skillPath, { scope: "bundled" });

        // Check required fields
        expect(result.frontmatter?.name).toBe(skillName);
        expect(result.frontmatter?.description).toBeDefined();
        expect(result.frontmatter?.description.length).toBeLessThanOrEqual(1024);

        // Check name matches directory
        expect(result.frontmatter?.name).toBe(skillName);
        expect(result.frontmatter?.soba?.version).toBe(1);
        expect(result.frontmatter?.soba?.triggers?.length).toBeGreaterThan(0);
      }
    });

    it("includes core engineering bundled skills", () => {
      const skillNames = listRepoBundledSkills();

      for (const skillName of CORE_BUNDLED_SKILLS) {
        expect(skillNames).toContain(skillName);
      }
    });
  });

  describe("Bundled skills discovery", () => {
    it("discovers bundled skills from bundledSkillsPath", () => {
      // Create a test bundled skill
      createBundledPlaybookSkill("test-bundled", "A test bundled skill for validation");

      skillManager.refresh();

      const skill = skillManager.getSkill("test-bundled");
      expect(skill).toBeDefined();
      expect(skill?.name).toBe("test-bundled");
      expect(skill?.scope).toBe("bundled");
      expect(skill?.trusted).toBe(true); // Bundled skills are always trusted
    });

    it("bundled skills have lower precedence than user skills", () => {
      // Create same skill in both bundled and user
      const skillName = "duplicate-skill";
      const userPath = join(userSkillsDir, skillName);

      mkdirSync(userPath, { recursive: true });
      createBundledPlaybookSkill(skillName, "Bundled version");

      writeFileSync(
        join(userPath, "SKILL.md"),
        `---
name: ${skillName}
description: User version
---

# User Version
`
      );

      skillManager.refresh();

      const skill = skillManager.getSkill(skillName);
      expect(skill).toBeDefined();
      expect(skill?.description).toBe("User version");
      expect(skill?.scope).toBe("user");
    });

    it("discovers multiple bundled skills", () => {
      const skills = ["skill-a", "skill-b", "skill-c"];

      for (const name of skills) {
        createBundledPlaybookSkill(name, `${name} description`);
      }

      skillManager.refresh();

      for (const name of skills) {
        const skill = skillManager.getSkill(name);
        expect(skill).toBeDefined();
        expect(skill?.scope).toBe("bundled");
      }
    });
  });

  describe("Bundled skills activation", () => {
    it("activates bundled skills successfully", () => {
      const skillName = "activatable-bundled";
      createBundledPlaybookSkill(skillName, "A bundled skill that can be activated", "Instructions for the skill.");

      skillManager.refresh();

      const result = skillManager.activate(skillName);
      expect(result.success).toBe(true);

      const activeSkills = skillManager.getActiveSkills();
      expect(activeSkills).toHaveLength(1);
      expect(activeSkills[0].name).toBe(skillName);
      expect(activeSkills[0].scope).toBe("bundled");
    });

    it("builds ephemeral messages for active bundled skills", () => {
      const skillName = "ephemeral-bundled";
      createBundledPlaybookSkill(
        skillName,
        "A bundled skill for ephemeral testing",
        "This content should appear in ephemeral messages.",
      );

      skillManager.refresh();
      skillManager.activate(skillName);

      const messages = skillManager.buildEphemeralMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("developer");
      expect(messages[0].content).toContain("SOBA Active Skill: ephemeral-bundled");
      expect(messages[0].content).toContain(
        "This content should appear in ephemeral messages"
      );
    });

    it("deactivates bundled skills", () => {
      const skillName = "deactivatable-bundled";
      createBundledPlaybookSkill(skillName, "A bundled skill that can be deactivated");

      skillManager.refresh();
      skillManager.activate(skillName);

      expect(skillManager.getActiveSkills()).toHaveLength(1);

      const deactivated = skillManager.deactivate(skillName);
      expect(deactivated).toBe(true);
      expect(skillManager.getActiveSkills()).toHaveLength(0);
    });
  });

  describe("Bundled skills with resources", () => {
    it("discovers bundled skills with scripts directory", () => {
      const skillName = "bundled-with-scripts";
      const skillDir = createBundledPlaybookSkill(skillName, "A bundled skill with scripts");
      const scriptsDir = join(skillDir, "scripts");

      mkdirSync(scriptsDir, { recursive: true });

      writeFileSync(
        join(scriptsDir, "helper.sh"),
        "#!/bin/bash\necho 'Helper script'"
      );

      skillManager.refresh();

      const skill = skillManager.getSkill(skillName);
      expect(skill).toBeDefined();
      expect(skill?.scope).toBe("bundled");
    });

    it("discovers bundled skills with references directory", () => {
      const skillName = "bundled-with-refs";
      const skillDir = createBundledPlaybookSkill(skillName, "A bundled skill with references");
      const refsDir = join(skillDir, "references");

      mkdirSync(refsDir, { recursive: true });

      writeFileSync(
        join(refsDir, "guide.md"),
        "# Reference Guide\n\nThis is a reference document."
      );

      skillManager.refresh();

      const skill = skillManager.getSkill(skillName);
      expect(skill).toBeDefined();
      expect(skill?.scope).toBe("bundled");
    });
  });

  describe("Bundled skills in system prompt", () => {
    it("includes bundled skills in catalog for system prompt", () => {
      const skills = ["prompt-skill-1", "prompt-skill-2"];

      for (const name of skills) {
        createBundledPlaybookSkill(name, `${name} for prompt testing`);
      }

      skillManager.refresh();

      const catalogForPrompt = skillManager.getCatalogForPrompt();
      expect(catalogForPrompt.length).toBeGreaterThanOrEqual(2);

      const skillNames = catalogForPrompt.map((s) => s.name);
      expect(skillNames).toContain("prompt-skill-1");
      expect(skillNames).toContain("prompt-skill-2");
    });

    it("excludes invalid bundled skills from catalog", () => {
      // Create valid skill
      createBundledPlaybookSkill("valid-bundled", "A valid bundled skill");

      // Create invalid skill (missing description)
      const invalidDir = join(bundledSkillsDir, "invalid-bundled");
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(
        join(invalidDir, "SKILL.md"),
        `---
name: invalid-bundled
---

# Invalid
`
      );

      skillManager.refresh();

      const catalogForPrompt = skillManager.getCatalogForPrompt();
      const skillNames = catalogForPrompt.map((s) => s.name);

      expect(skillNames).toContain("valid-bundled");
      expect(skillNames).not.toContain("invalid-bundled");
    });
  });
});
