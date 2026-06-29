import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import { SkillEvaluator } from "../../../src/application/skills/evaluator";
import { SkillManager } from "../../../src/application/skills/skill-manager";
import { FilesystemSkillEvaluationStorage } from "../../../src/infrastructure/persistence/skills/evaluation-storage";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { readSkillContentFromDisk } from "../../../src/infrastructure/persistence/skills/skill-file-operations";
import { computeSkillContentHashOnDisk, FilesystemSkillValidationFilesystem, validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";

const repoSkillsDir = join(process.cwd(), "skills");
const forbiddenLintToolExamples = ["eslint", "prettier"];
const genericTriggers = new Set(["task", "code", "work", "help", "general"]);

function listBundledSkillNames(): string[] {
  return readdirSync(repoSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readSkill(name: string): string {
  return readFileSync(join(repoSkillsDir, name, "SKILL.md"), "utf-8");
}

describe("Bundled skill eval baseline", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-skill-eval-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("UC-AL-03 lint-fix stays project-tooling-first without hard-coded formatter drift", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath: join(tempDir, "eval-runs") }), validateSkill: validateSkillOnDisk });
    const content = readSkill("lint-fix");
    const lowerContent = content.toLowerCase();
    const result = evaluator.evaluateFixtureTask({
      id: "uc-al-03-lint-fix",
      useCaseId: "UC-AL-03",
      prompt: "Fix lint failure",
      requiredSkillName: "lint-fix",
      skillPath: join(repoSkillsDir, "lint-fix"),
      expectedProcessMarkers: ["project instructions", "verification"],
      forbiddenContent: forbiddenLintToolExamples,
      forbiddenCommands: forbiddenLintToolExamples,
      trace: {
        activatedSkills: ["lint-fix"],
        narration: ["Read project instructions", "Ran lint verification with the configured project command"],
        toolCalls: [
          { name: "read", status: "success" },
          { name: "bash", command: "project lint command", status: "failure", evidenceKind: "diagnostic" },
          { name: "edit", status: "success", mutatesFiles: true },
          { name: "bash", command: "project lint command", status: "success", evidenceKind: "verification" },
        ],
      },
    });

    expect(content).toContain("Project instructions");
    expect(content).toContain("tools already configured by the project");
    expect(content).toContain("project's configured command");
    for (const forbiddenTool of forbiddenLintToolExamples) {
      expect(lowerContent).not.toContain(forbiddenTool);
    }
    expect(result.status).toBe("pass");
    expect(result.scores.verificationEvidence).toBe(1);
  });

  test("UC-AL-07 activates code-review and preserves no-mutation review behavior", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath: join(tempDir, "eval-runs") }), validateSkill: validateSkillOnDisk });
    const trustStore = createFilesystemProjectTrustStore({ sobaDir: tempDir });
    const discovery = new SkillDiscovery({
      projectPath: tempDir,
      userSkillsPath: join(tempDir, "user-skills"),
      bundledSkillsPath: repoSkillsDir,
      trustStore,
      files: new FilesystemSkillValidationFilesystem(),
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
    });
    const catalog = new SkillCatalog({ discovery });
    const skillManager = new SkillManager({ catalog, discovery, trustStore, readSkillContent: readSkillContentFromDisk });

    skillManager.refresh();
    const activation = skillManager.activate("code-review");
    const messages = skillManager.buildEphemeralMessages();
    const reviewContent = messages.map((message) => message.content).join("\n");
    const result = evaluator.evaluateFixtureTask({
      id: "uc-al-07-code-review",
      useCaseId: "UC-AL-07",
      prompt: "Please review this diff",
      requiredSkillName: "code-review",
      skillPath: join(repoSkillsDir, "code-review"),
      expectedProcessMarkers: ["findings", "read"],
      requiresVerification: false,
      trace: {
        activatedSkills: ["code-review"],
        narration: ["Read the diff and returned findings first"],
        toolCalls: [{ name: "read", status: "success" }],
        output: "Findings first review with no mutation.",
      },
    });

    expect(activation.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(reviewContent).toContain("SOBA Active Skill: code-review");
    expect(reviewContent).toContain("Present findings first");
    expect(reviewContent).toContain("Do not modify files unless the user explicitly asks");
    expect(reviewContent.toLowerCase()).not.toContain("use edit");
    expect(reviewContent.toLowerCase()).not.toContain("use write");
    expect(result.status).toBe("pass");
  });

  test("malformed or incomplete bundled skill fixture fails validation", () => {
    const skillPath = join(tempDir, "incomplete-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---
name: incomplete-skill
description: Incomplete bundled fixture
soba:
  version: 1
  triggers:
    - incomplete
  memory-policy: none
---

# incomplete-skill

## Purpose

Missing the rest of the protocol sections.
`,
    );

    const result = validateSkillOnDisk(skillPath, { scope: "bundled" });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "MISSING_BUNDLED_SKILL_SECTION")).toBe(true);
  });

  test("skill trigger precision baseline does not regress", () => {
    for (const skillName of listBundledSkillNames()) {
      const result = validateSkillOnDisk(join(repoSkillsDir, skillName), { scope: "bundled" });
      const triggers = result.frontmatter?.soba?.triggers ?? [];

      expect(result.valid).toBe(true);
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) {
        expect(trigger.length).toBeGreaterThanOrEqual(4);
        expect(genericTriggers.has(trigger.toLowerCase())).toBe(false);
      }
    }
  });
});
