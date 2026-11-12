/**
 * Tests for project-declared required skills (#9).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import { parseProjectSkillDeclarations } from "../../../src/application/skills/project-declarations";
import type { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { SkillManager } from "../../../src/application/skills/skill-manager";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { readSkillContentFromDisk } from "../../../src/infrastructure/persistence/skills/skill-file-operations";
import {
  computeSkillContentHashOnDisk,
  FilesystemSkillValidationFilesystem,
  validateSkillOnDisk,
} from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";

function makeSkill(root: string, name: string, description = `${name} description`): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSkill body for ${name}.\n`,
  );
}

describe("parseProjectSkillDeclarations", () => {
  it("parses always and required entries", () => {
    const content = [
      "# Project",
      "",
      "```soba-skills",
      '{ "always": ["repo-guidelines"], "required": [{ "name": "ts-best", "when": "typescript" }] }',
      "```",
    ].join("\n");

    const result = parseProjectSkillDeclarations(content);

    expect(result.warnings).toEqual([]);
    expect(result.declarations).toEqual([
      { name: "repo-guidelines", always: true },
      { name: "ts-best", always: false, when: "typescript" },
    ]);
  });

  it("returns no declarations when the block is absent", () => {
    expect(parseProjectSkillDeclarations("# Just docs").declarations).toEqual([]);
  });

  it("malformed JSON produces an actionable warning", () => {
    const content = ["```soba-skills", "{ not json", "```"].join("\n");

    const result = parseProjectSkillDeclarations(content);

    expect(result.declarations).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("not valid JSON");
    expect(result.warnings[0]).toContain("AGENTS.md");
  });

  it("invalid entries are skipped with warnings", () => {
    const content = [
      "```soba-skills",
      '{ "required": [42, { "name": "" }, { "name": "ok" }, { "name": "x", "when": 5 }], "bogus": 1 }',
      "```",
    ].join("\n");

    const result = parseProjectSkillDeclarations(content);

    expect(result.declarations).toEqual([{ name: "ok", always: false }]);
    expect(result.warnings.length).toBe(4);
  });
});

describe("SkillManager project declarations", () => {
  let tempDir: string;
  let skillsDir: string;
  let projectDir: string;
  let sobaDir: string;
  let skillManager: SkillManager;
  let trustStore: ProjectTrustStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-decl-test-"));
    skillsDir = join(tempDir, "skills");
    projectDir = join(tempDir, "project");
    sobaDir = join(tempDir, ".soba");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sobaDir, { recursive: true });

    makeSkill(skillsDir, "repo-guidelines");
    makeSkill(skillsDir, "ts-best");
    makeSkill(skillsDir, "python-best");

    const files = new FilesystemSkillValidationFilesystem();
    trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: skillsDir,
      bundledSkillsPath: join(tempDir, "bundled"),
      trustStore,
      files,
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
    });
    skillManager = new SkillManager({
      catalog: new SkillCatalog({ discovery }),
      discovery,
      trustStore,
      readSkillContent: readSkillContentFromDisk,
    });
    skillManager.refresh();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("activates always-declared skills without an explicit activation attempt", () => {
    skillManager.setProjectDeclarations([{ name: "repo-guidelines", always: true }]);

    const activated = skillManager.activateDeclaredSkillsForPrompt("");

    expect(activated).toEqual(["repo-guidelines"]);
    expect(skillManager.isActive("repo-guidelines")).toBe(true);
  });

  it("activates when-matched required skills only for matching work", () => {
    skillManager.setProjectDeclarations([
      { name: "ts-best", always: false, when: "typescript" },
      { name: "python-best", always: false, when: "python" },
    ]);

    const tsActivated = skillManager.activateDeclaredSkillsForPrompt("Fix the TypeScript fixture");
    expect(tsActivated).toEqual(["ts-best"]);
    expect(skillManager.isActive("ts-best")).toBe(true);
    expect(skillManager.isActive("python-best")).toBe(false);

    const pyActivated = skillManager.activateDeclaredSkillsForPrompt("update the python profile");
    expect(pyActivated).toEqual(["python-best"]);
    expect(skillManager.isActive("python-best")).toBe(true);
  });

  it("session context lists active skills and why each is active", () => {
    skillManager.setProjectDeclarations([{ name: "repo-guidelines", always: true }]);
    skillManager.activateDeclaredSkillsForPrompt("");

    const withReasons = skillManager.getActiveSkillsWithReasons();

    expect(withReasons.length).toBe(1);
    expect(withReasons[0].ref.name).toBe("repo-guidelines");
    expect(withReasons[0].reason).toContain("AGENTS.md");
  });

  it("deactivation removes content from subsequent turns", () => {
    skillManager.setProjectDeclarations([{ name: "repo-guidelines", always: true }]);
    skillManager.activateDeclaredSkillsForPrompt("");
    expect(skillManager.buildEphemeralMessages().some((m) => m.content.includes("repo-guidelines"))).toBe(true);

    expect(skillManager.deactivate("repo-guidelines")).toBe(true);

    const messages = skillManager.buildEphemeralMessages();
    expect(messages.some((m) => m.content.includes("repo-guidelines"))).toBe(false);
  });

  it("a missing declared skill does not activate and does not crash", () => {
    skillManager.setProjectDeclarations([{ name: "does-not-exist", always: true }]);

    const activated = skillManager.activateDeclaredSkillsForPrompt("");

    expect(activated).toEqual([]);
    expect(skillManager.isActive("does-not-exist")).toBe(false);
  });
});
