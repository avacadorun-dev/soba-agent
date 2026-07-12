import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoopRuntimeAdapter } from "../../../src/composition/runtime/agent-loop-runtime-adapter";
import { createSkillStack } from "../../../src/composition/runtime/create-skill-stack";
import type { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { ProviderRegistry } from "../../../src/infrastructure/llm/providers/registry";
import type { PersistentSessionLifecycleService } from "../../../src/infrastructure/persistence/sessions/session-lifecycle-service";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import {
  EMBEDDED_BUNDLED_SKILLS,
  resolveBundledSkillsPath,
} from "../../../src/infrastructure/persistence/skills/bundled-skill-source";
import { validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";

const temporaryPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("bundled skill runtime hardening", () => {
  test("materializes embedded bundled skills when package assets are unavailable", () => {
    const root = makeTempDir("soba-embedded-skills-");
    const sobaDir = join(root, ".soba");
    const resolved = resolveBundledSkillsPath({ sobaDir, environment: {} });

    expect(resolved).toStartWith(join(sobaDir, "bundled-skills"));
    expect(readdirSync(resolved).sort()).toEqual(Object.keys(EMBEDDED_BUNDLED_SKILLS).sort());
    for (const [name, content] of Object.entries(EMBEDDED_BUNDLED_SKILLS)) {
      const skillPath = join(resolved, name, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      expect(readFileSync(skillPath, "utf8")).toBe(content);
    }
  });

  test("prefers an installed package skill directory over embedded cache", () => {
    const root = makeTempDir("soba-package-skills-");
    const installedSkills = join(root, "package", "skills");
    const marker = join(installedSkills, "marker");
    mkdirSync(installedSkills, { recursive: true });
    writeFileSync(marker, "installed");

    const resolved = resolveBundledSkillsPath({
      sobaDir: join(root, ".soba"),
      environment: { SOBA_BUNDLED_SKILLS_PATH: installedSkills },
    });

    expect(resolved).toBe(installedSkills);
  });

  test("restores exact active skill refs into a fresh manager", async () => {
    const root = makeTempDir("soba-skill-restore-");
    const session = SessionManager.inMemory(root);
    const first = await createSkillStack({
      projectPath: root,
      homeDir: root,
      session,
      toolRegistry: new ToolRegistry(),
    });
    expect(first.skillManager.activate("bug-fix").success).toBe(true);
    const ref = first.skillManager.getActiveSkills()[0];
    session.appendSkillActivation({ action: "activate", skill: ref });

    const restored = await createSkillStack({
      projectPath: root,
      homeDir: root,
      session,
      toolRegistry: new ToolRegistry(),
    });

    expect(restored.skillManager.getActiveSkills()).toEqual([ref]);
    expect(restored.skillManager.buildEphemeralMessages()[0]?.content).toContain("SOBA Active Skill: bug-fix");
  });

  test("rejects and deactivates stale skill refs instead of substituting current content", async () => {
    const root = makeTempDir("soba-stale-skill-");
    const session = SessionManager.inMemory(root);
    session.appendSkillActivation({
      action: "activate",
      skill: { name: "bug-fix", scope: "bundled", revision: "stale", contentHash: "stale" },
    });

    const stack = await createSkillStack({
      projectPath: root,
      homeDir: root,
      session,
      toolRegistry: new ToolRegistry(),
    });

    expect(stack.skillManager.getActiveSkills()).toEqual([]);
    expect(stack.skillManager.buildEphemeralMessages()).toEqual([]);
    expect(session.getActiveSkillRefs()).toEqual([]);
  });

  test("activate and deactivate tools persist the complete session lifecycle", async () => {
    const root = makeTempDir("soba-skill-tools-");
    const session = SessionManager.inMemory(root);
    const tools = new ToolRegistry();
    const stack = await createSkillStack({ projectPath: root, homeDir: root, session, toolRegistry: tools });
    const context = { cwd: root, session };

    const activation = await tools.get("activate_skill")!.execute({ name: "code-review" }, context);
    expect(activation.isError).toBe(false);
    expect(stack.skillManager.isActive("code-review")).toBe(true);
    expect(session.getActiveSkillRefs().map((skill) => skill.name)).toEqual(["code-review"]);

    const deactivation = await tools.get("deactivate_skill")!.execute({ name: "code-review" }, context);
    expect(deactivation.isError).toBe(false);
    expect(stack.skillManager.isActive("code-review")).toBe(false);
    expect(stack.skillManager.buildEphemeralMessages()).toEqual([]);
    expect(session.getActiveSkillRefs()).toEqual([]);
  });

  test("reconciles active skills when the runtime switches sessions", async () => {
    const root = makeTempDir("soba-skill-session-switch-");
    const firstSession = SessionManager.inMemory(root);
    const secondSession = SessionManager.inMemory(root);
    const stack = await createSkillStack({
      projectPath: root,
      homeDir: root,
      session: firstSession,
      toolRegistry: new ToolRegistry(),
    });
    stack.skillManager.activate("code-review");
    const secondSessionRef = stack.skillManager.getActiveSkills()[0];
    secondSession.appendSkillActivation({ action: "activate", skill: secondSessionRef });
    stack.skillManager.deactivate("code-review");
    stack.skillManager.activate("bug-fix");

    const loop = { setSessionManager: () => {} } as unknown as AgentLoop;
    const adapter = new AgentLoopRuntimeAdapter(
      loop,
      firstSession,
      {} as PersistentSessionLifecycleService,
      {} as ProviderRegistry,
      stack.skillManager,
    );
    adapter.activateSessionManager(secondSession);

    expect(stack.skillManager.getActiveSkills()).toEqual([secondSessionRef]);
  });

  test("enforces active skill memory policy and combines multiple policies by union", async () => {
    const root = makeTempDir("soba-skill-memory-policy-");
    const stack = await createSkillStack({
      projectPath: root,
      homeDir: root,
      session: SessionManager.inMemory(root),
      toolRegistry: new ToolRegistry(),
    });

    stack.skillManager.activate("code-review");
    expect(stack.skillManager.getMemoryAccess()).toEqual({ read: false, write: false });
    expect(stack.skillManager.evaluateToolPolicy("read_project_memory").allowed).toBe(false);
    expect(stack.skillManager.evaluateToolPolicy("write_project_memory").allowed).toBe(false);

    stack.skillManager.activate("codebase-orientation");
    expect(stack.skillManager.getMemoryAccess()).toEqual({ read: true, write: false });

    stack.skillManager.activate("memory-capture");
    expect(stack.skillManager.getMemoryAccess()).toEqual({ read: true, write: true });
  });

  test("enforces custom soba.required-sections metadata", () => {
    const root = makeTempDir("soba-required-sections-");
    const skillPath = join(root, "custom-skill");
    const skillMarkdown = join(skillPath, "SKILL.md");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(skillMarkdown, `---
name: custom-skill
description: Test custom required sections
soba:
  required-sections:
    - Safety Notes
---

# Custom Skill
`);

    const missing = validateSkillOnDisk(skillPath, { scope: "user" });
    expect(missing.valid).toBe(false);
    expect(missing.errors).toContainEqual(expect.objectContaining({
      code: "MISSING_REQUIRED_SKILL_SECTION",
      message: "Skill must contain section: Safety Notes",
    }));

    writeFileSync(skillMarkdown, `${readFileSync(skillMarkdown, "utf8")}\n## Safety Notes\n\nStay scoped.\n`);
    expect(validateSkillOnDisk(skillPath, { scope: "user" }).valid).toBe(true);
  });
});
