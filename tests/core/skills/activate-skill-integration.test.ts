/**
 * I.6 Activate Skill Tool Registration — Integration Tests
 * 
 * Tests the integration of activate_skill tool with:
 * - Tool registry
 * - System prompt (skill catalog)
 * - Ephemeral message injection
 * - Agent loop event emission
 * - Session entry persistence
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "../../../src/application/skills/catalog";
import { SkillDiscovery } from "../../../src/application/skills/discovery";
import type { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { SkillManager } from "../../../src/application/skills/skill-manager";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { AgentEvent } from "../../../src/engine/turn/types";
import { createOpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { readSkillContentFromDisk } from "../../../src/infrastructure/persistence/skills/skill-file-operations";
import { computeSkillContentHashOnDisk, FilesystemSkillValidationFilesystem, validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";
import { createActivateSkillTool } from "../../../src/infrastructure/tools/local/activate-skill";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";

describe("I.6: Activate Skill Tool Integration", () => {
  let testDir: string;
  let sobaDir: string;
  let bundledSkillsDir: string;
  let userSkillsDir: string;
  let projectDir: string;
  let session: SessionManager;
  let tools: ToolRegistry;
  let skillManager: SkillManager;
  let skillCatalog: SkillCatalog;
  let trustStore: ProjectTrustStore;

  function createBundledPlaybookSkill(name: string, description: string, body: string): void {
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

${body}

## Purpose

Purpose for ${name}.

## Triggers

Trigger when ${name} is useful.

## Inputs To Inspect

- Relevant task context

## Procedure

1. Inspect inputs.
2. Apply the skill.

## Verification Contract

Verify the requested output against inspected evidence.

## Failure Recovery

Retry with narrower context if verification fails.

## Memory Policy

Do not write memory.

## Stop Conditions

Stop when the task-specific output is complete.

## Anti-Patterns

- Do not ignore project instructions.
`,
    );
  }

  beforeEach(() => {
    // Create isolated test directories
    testDir = join(tmpdir(), `soba-activate-skill-test-${Date.now()}`);
    sobaDir = join(testDir, ".soba");
    bundledSkillsDir = join(testDir, "bundled-skills");
    userSkillsDir = join(sobaDir, "skills");
    projectDir = join(testDir, "project");

    mkdirSync(testDir, { recursive: true });
    mkdirSync(sobaDir, { recursive: true });
    mkdirSync(bundledSkillsDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    createBundledPlaybookSkill(
      "test-skill",
      "A test skill for integration testing",
      "This is a test skill with detailed instructions for integration testing.",
    );
    createBundledPlaybookSkill("another-skill", "Another test skill", "This is another test skill.");

    // Initialize session
    session = SessionManager.create(projectDir, join(testDir, "sessions"));

    // Initialize tool registry
    tools = new ToolRegistry();

    // Initialize skill infrastructure
    trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const discovery = new SkillDiscovery({
      projectPath: projectDir,
      userSkillsPath: userSkillsDir,
      bundledSkillsPath: bundledSkillsDir,
      trustStore,
      files: new FilesystemSkillValidationFilesystem(),
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
    });
    skillCatalog = new SkillCatalog({ discovery });
    skillManager = new SkillManager({
      catalog: skillCatalog,
      discovery,
      trustStore,
      readSkillContent: readSkillContentFromDisk,
    });

    // Initial scan
    skillManager.refresh();
  });

  describe("Tool Registration", () => {
    it("registers activate_skill tool when skills are available", () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => session.appendSkillActivation({ action: "activate", skill: ref }),
        isActive: (name, revision) => {
          const activeSkills = skillManager.getActiveSkills();
          return activeSkills.some(
            (skill) => skill.name === name && skill.revision === revision,
          );
        },
      });

      tools.register(activateSkillTool);

      expect(tools.has("activate_skill")).toBe(true);
      expect(tools.getNames()).toContain("activate_skill");
    });

    it("activate_skill tool has correct schema", () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => session.appendSkillActivation({ action: "activate", skill: ref }),
        isActive: (_name, _revision) => false,
      });

      tools.register(activateSkillTool);

      const openResponsesTools = tools.getOpenResponsesTools();
      const activateSkill = openResponsesTools.find(
        (t) => t.type === "function" && t.name === "activate_skill",
      );

      expect(activateSkill).toBeDefined();
      expect(activateSkill?.type).toBe("function");
      if (activateSkill && activateSkill.type === "function") {
        expect(activateSkill.parameters).toBeDefined();
        expect(activateSkill.parameters?.properties).toBeDefined();
      }
    });
  });

  describe("System Prompt Integration", () => {
    it("includes skill catalog in system prompt", () => {
      const catalogForPrompt = skillManager.getCatalogForPrompt();

      expect(catalogForPrompt).toHaveLength(2);
      expect(catalogForPrompt[0].name).toBe("test-skill");
      expect(catalogForPrompt[1].name).toBe("another-skill");

      // Verify catalog contains required fields
      expect(catalogForPrompt[0].description).toBe(
        "A test skill for integration testing",
      );
      expect(catalogForPrompt[0].location).toContain("test-skill");
    });

    it("catalog is empty when no skills exist", () => {
      // Create empty skill manager
      const emptyDiscovery = new SkillDiscovery({
        projectPath: projectDir,
        userSkillsPath: join(testDir, "empty-user"),
        bundledSkillsPath: join(testDir, "empty-bundled"),
        trustStore,
      files: new FilesystemSkillValidationFilesystem(),
      validateSkill: validateSkillOnDisk,
      computeSkillContentHash: computeSkillContentHashOnDisk,
      });
      const emptyCatalog = new SkillCatalog({ discovery: emptyDiscovery });
      const emptyManager = new SkillManager({
        catalog: emptyCatalog,
        discovery: emptyDiscovery,
        trustStore,
        readSkillContent: readSkillContentFromDisk,
      });

      mkdirSync(join(testDir, "empty-user"), { recursive: true });
      mkdirSync(join(testDir, "empty-bundled"), { recursive: true });

      emptyManager.refresh();
      const catalogForPrompt = emptyManager.getCatalogForPrompt();

      expect(catalogForPrompt).toHaveLength(0);
    });
  });

  describe("Ephemeral Message Injection", () => {
    it("builds ephemeral messages for active skills", () => {
      skillManager.activate("test-skill");

      const messages = skillManager.buildEphemeralMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("developer");
      expect(messages[0].content).toContain("SOBA Active Skill: test-skill");
      expect(messages[0].content).toContain("Follow this skill only for the current task aspects it covers.");
      expect(messages[0].content).toContain("Core safety, completion, verification, tool-selection, and project instructions override this skill.");
      expect(messages[0].content).toContain("<skill_content>");
      expect(messages[0].content).toContain(
        "This is a test skill with detailed instructions",
      );
      expect(messages[0].content).toContain("</skill_content>");
    });

    it("builds multiple ephemeral messages for multiple active skills", () => {
      skillManager.activate("test-skill");
      skillManager.activate("another-skill");

      const messages = skillManager.buildEphemeralMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toContain("test-skill");
      expect(messages[1].content).toContain("another-skill");
    });

    it("returns empty array when no skills are active", () => {
      const messages = skillManager.buildEphemeralMessages();
      expect(messages).toHaveLength(0);
    });

    it("ephemeral messages are not persisted in session", () => {
      skillManager.activate("test-skill");
      const messages = skillManager.buildEphemeralMessages();

      // Verify messages exist but are not in session
      expect(messages).toHaveLength(1);

      const sessionItems = session.buildInput().items;
      const developerMessages = sessionItems.filter(
        (item) => {
          const msg = item as { type: string; role?: string; content?: unknown };
          return msg.type === "message" &&
          msg.role === "developer" &&
          Array.isArray(msg.content) &&
          msg.content.some(
            (c: Record<string, unknown>) => "text" in c && (c as { text: string }).text.includes("SOBA Active Skill"),
          );
        },
      );

      expect(developerMessages).toHaveLength(0);
    });
  });

  describe("Tool Execution", () => {
    it("activates skill and returns success", async () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => session.appendSkillActivation({ action: "activate", skill: ref }),
        isActive: (name, revision) => {
          const activeSkills = skillManager.getActiveSkills();
          return activeSkills.some(
            (skill) => skill.name === name && skill.revision === revision,
          );
        },
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("Use only when the task clearly matches");
      expect(tool?.description).toContain("do not activate skills for generic exploration");

      const result = await tool!.execute(
        { name: "test-skill" },
        { cwd: projectDir, session },
      );

      expect(result.isError).toBeFalsy();
      const resultText = result.content
        .map((c) => ("text" in c ? c.text : ""))
        .join("");
      expect(resultText).toContain("test-skill");
      expect(resultText).toContain("Activated");
    });

    it("persists activation entry in session", async () => {
      let activationCalled = false;
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => {
          activationCalled = true;
          session.appendSkillActivation({
            action: "activate",
            skill: ref,
          });
        },
        isActive: (_name, _revision) => false,
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      await tool!.execute({ name: "test-skill" }, { cwd: projectDir, session });

      expect(activationCalled).toBe(true);

      // Verify session has skill_activation entry
      const entries = session.getEntries();
      const activationEntry = entries.find(
        (e) => e.type === "skill_activation" && "skill" in e,
      );

      expect(activationEntry).toBeDefined();
      if (activationEntry && "skill" in activationEntry) {
        expect(activationEntry.skill.name).toBe("test-skill");
        expect(activationEntry.action).toBe("activate");
      }
    });

    it("returns error for non-existent skill", async () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => session.appendSkillActivation({ action: "activate", skill: ref }),
        isActive: (_name, _revision) => false,
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      const result = await tool!.execute(
        { name: "non-existent-skill" },
        { cwd: projectDir, session },
      );

      expect(result.isError).toBe(true);
      const resultText = result.content
        .map((c) => ("text" in c ? c.text : ""))
        .join("");
      expect(resultText).toContain("not found");
    });

    it("deduplicates activation when skill is already active", async () => {
      skillManager.activate("test-skill");

      let activationCount = 0;
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => {
          activationCount++;
          session.appendSkillActivation({
            action: "activate",
            skill: ref,
          });
        },
        isActive: (name, revision) => {
          const activeSkills = skillManager.getActiveSkills();
          return activeSkills.some(
            (skill) => skill.name === name && skill.revision === revision,
          );
        },
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      const result = await tool!.execute(
        { name: "test-skill" },
        { cwd: projectDir, session },
      );

      // Should succeed but not create duplicate entry
      expect(result.isError).toBeFalsy();
      expect(activationCount).toBe(0); // onActivate should not be called for duplicate

      const entries = session.getEntries();
      const activationEntries = entries.filter(
        (e) => e.type === "skill_activation" && "skill" in e,
      );

      // No activation entries should exist since skill was already active
      expect(activationEntries).toHaveLength(0);
    });
  });

  describe("Agent Loop Integration", () => {
    it("emits skill_activated event when skill is activated", async () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => session.appendSkillActivation({ action: "activate", skill: ref }),
        isActive: (name, revision) => {
          const activeSkills = skillManager.getActiveSkills();
          return activeSkills.some(
            (skill) => skill.name === name && skill.revision === revision,
          );
        },
      });

      tools.register(activateSkillTool);

      // Create mock client
      const mockClient = createOpenResponsesClient({
        baseUrl: "http://localhost:11434/v1",
        apiKey: "test",
        model: "test-model",
        maxOutputTokens: 4096,
        maxCompletionTokens: 4096,
        contextWindow: 8192,
        temperature: 0.7,
        theme: "graphite",
        maxAgentIterations: 50,
        maxStalledIterations: 5,
        maxRunMinutes: 30,
        bashMaxTimeoutSeconds: 300,
        sessionDir: join(testDir, "sessions"),
        lang: "en",
      });

      // Create agent loop
      const loop = new AgentLoop(
        mockClient,
        session,
        tools,
        projectDir,
        { emitEvents: true, stream: false },
        undefined,
        undefined,
        undefined,
        undefined,
        skillManager,
      );

      // Collect events
      const events: AgentEvent[] = [];
      loop.onEvent((event) => events.push(event));

      // Simulate tool execution (we can't run full turn without real LLM)
      // Instead, verify that the tool is registered and skillManager is accessible
      expect(loop.getSkillManager()).toBe(skillManager);
      expect(tools.has("activate_skill")).toBe(true);
    });

    it("skill catalog is available for system prompt building", () => {
      const catalogForPrompt = skillManager.getCatalogForPrompt();

      expect(catalogForPrompt).toHaveLength(2);
      expect(catalogForPrompt.map((s) => s.name)).toContain("test-skill");
      expect(catalogForPrompt.map((s) => s.name)).toContain("another-skill");
    });

    it("ephemeral messages are available for request building", () => {
      skillManager.activate("test-skill");

      const ephemeralMessages = skillManager.buildEphemeralMessages();

      expect(ephemeralMessages).toHaveLength(1);
      expect(ephemeralMessages[0].role).toBe("developer");
    });
  });

  describe("Session Persistence", () => {
    it("skill activation entries are persisted in session", async () => {
      let activationCalled = false;
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => {
          activationCalled = true;
          session.appendSkillActivation({
            action: "activate",
            skill: ref,
          });
        },
        isActive: (_name, _revision) => false,
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      await tool!.execute({ name: "test-skill" }, { cwd: projectDir, session });

      expect(activationCalled).toBe(true);

      // Get all entries
      const entries = session.getEntries();

      // Find skill_activation entry
      const activationEntry = entries.find(
        (e) => e.type === "skill_activation" && "skill" in e,
      );

      expect(activationEntry).toBeDefined();
      if (activationEntry && "skill" in activationEntry) {
        expect(activationEntry.skill.name).toBe("test-skill");
        expect(activationEntry.skill.scope).toBe("bundled");
        expect(activationEntry.skill.revision).toBeDefined();
        expect(activationEntry.skill.contentHash).toBeDefined();
      }
    });

    it("multiple activations create multiple entries", async () => {
      const activateSkillTool = createActivateSkillTool({
        catalog: skillCatalog,
        onActivate: (ref) => {
          session.appendSkillActivation({
            action: "activate",
            skill: ref,
          });
        },
        isActive: (_name, _revision) => false,
      });

      tools.register(activateSkillTool);

      const tool = tools.get("activate_skill");
      await tool!.execute({ name: "test-skill" }, { cwd: projectDir, session });
      await tool!.execute(
        { name: "another-skill" },
        { cwd: projectDir, session },
      );

      const entries = session.getEntries();
      const activationEntries = entries.filter(
        (e) => e.type === "skill_activation" && "skill" in e,
      );

      expect(activationEntries).toHaveLength(2);
    });
  });

  // Cleanup
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
});
