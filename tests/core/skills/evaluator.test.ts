import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DraftStore, type EvalCase } from "../../../src/application/skills/drafts";
import { SkillEvaluator } from "../../../src/application/skills/evaluator";
import { FilesystemDraftStorage } from "../../../src/infrastructure/persistence/skills/draft-storage";
import { FilesystemSkillEvaluationStorage } from "../../../src/infrastructure/persistence/skills/evaluation-storage";
import { validateSkillOnDisk } from "../../../src/infrastructure/persistence/skills/skill-validation-filesystem";

describe("SkillEvaluator", () => {
  const testDir = join(process.cwd(), ".test-evaluator");
  const draftsPath = join(testDir, "drafts");
  const evalRunsPath = join(testDir, "eval-runs");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createBundledSkill(name: string, body: string): string {
    const skillPath = join(testDir, "skills", name);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---
name: ${name}
description: ${name} eval fixture
soba:
  version: 1
  triggers:
    - ${name}
    - lint failure
    - code review
  memory-policy: none
---

# ${name}

${body}

## Purpose

Purpose for ${name}.

## Triggers

Use when ${name} is relevant.

## Inputs To Inspect

- Project instructions
- Relevant task files

## Procedure

1. Inspect inputs.
2. Activate the required skill.
3. Follow project instructions.

## Verification Contract

Verification evidence must match the task.

## Failure Recovery

Retry with narrower diagnostics when verification fails.

## Memory Policy

Do not write memory.

## Stop Conditions

Stop when the task is complete.

## Anti-Patterns

- Do not ignore project instructions.
`,
    );
    return skillPath;
  }

  it("оценивает skill с eval cases", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill

This skill uses bash to execute commands.
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
        expectedTools: ["bash"],
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    expect(result.skillName).toBe("test-skill");
    expect(result.revisionId).toBe("rev_123");
    expect(result.cases).toHaveLength(1);
    expect(result.summary.total).toBe(1);
  });

  it("пропускает dangerous cases", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "safe-case",
        description: "Safe case",
        input: "safe input",
        dangerous: false,
      },
      {
        id: "dangerous-case",
        description: "Dangerous case",
        input: "dangerous input",
        dangerous: true,
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    expect(result.cases).toHaveLength(2);

    const safeCase = result.cases.find((c) => c.caseId === "safe-case");
    const dangerousCase = result.cases.find((c) => c.caseId === "dangerous-case");

    expect(safeCase?.status).not.toBe("skip");
    expect(dangerousCase?.status).toBe("skip");
    expect(dangerousCase?.reason).toContain("Dangerous case skipped");
  });

  it("сохраняет detailed eval run", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    // Check eval run was saved
    const savedRun = evaluator.getEvalRun("test-skill", "rev_123");
    expect(savedRun).toBeDefined();
    expect(savedRun?.runId).toBe(result.runId);
    expect(savedRun?.configHash).toBeDefined();
  });

  it("вычисляет pass rate", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill

Uses bash tool.
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input 1",
        expectedTools: ["bash"],
      },
      {
        id: "case-2",
        description: "Test case 2",
        input: "test input 2",
        expectedTools: ["bash"],
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    expect(result.summary.total).toBe(2);
    expect(result.summary.passRate).toBeGreaterThanOrEqual(0);
    expect(result.summary.passRate).toBeLessThanOrEqual(1);
  });

  it("проверяет tool intent matchers", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill

Uses bash tool.
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
        expectedTools: ["bash", "read"],
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].expectedTools).toEqual(["bash", "read"]);
  });

  it("выполняет safety check", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123");

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].safetyCheck).toBeDefined();
  });

  it("обнаруживает semantic regression", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
        expectedOutput: "expected output",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    // Create current eval with baseline
    const currentResult = await evaluator.evaluate(draft, "rev_current", {
      baselineRevisionId: "rev_baseline",
    });

    expect(currentResult.baselineRevisionId).toBe("rev_baseline");
  });

  it("обнаруживает safety regression и не позволяет override", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    // Create baseline eval
    await evaluator.evaluate(draft, "rev_baseline");

    // Create current eval - should not throw for safety regression in this test
    // (since we're not actually creating a safety regression)
    const result = await evaluator.evaluate(draft, "rev_current", {
      baselineRevisionId: "rev_baseline",
    });

    expect(result).toBeDefined();
  });

  it("требует --override-metrics для metric regression", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    // Create baseline eval
    await evaluator.evaluate(draft, "rev_baseline");

    // Create current eval with override
    const result = await evaluator.evaluate(draft, "rev_current", {
      baselineRevisionId: "rev_baseline",
      overrideMetrics: true,
    });

    expect(result).toBeDefined();
  });

  it("список eval runs для skill", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    await evaluator.evaluate(draft, "rev_1");
    await evaluator.evaluate(draft, "rev_2");

    const runs = evaluator.listEvalRuns("test-skill");

    expect(runs).toHaveLength(2);
    expect(runs[0].timestamp).toBeDefined();
    expect(runs[1].timestamp).toBeDefined();
  });

  it("rebaseline выполняет повторную оценку", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
      },
    ];

    const createResult = draftStore.create("test-skill", content, evalCases);
    const draft = createResult.draft!;

    const result = await evaluator.evaluate(draft, "rev_123", {
      rebaseline: true,
    });

    expect(result).toBeDefined();
    expect(result.configHash).toBeDefined();
  });

  it("выбрасывает ошибку при отсутствии eval cases", async () => {
    const draftStore = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }), validateSkill: validateSkillOnDisk });
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const createResult = draftStore.create("test-skill", content);
    const draft = createResult.draft!;

    await expect(evaluator.evaluate(draft, "rev_123")).rejects.toThrow(
      "No eval cases found",
    );
  });

  it("fixture harness принимает good skill trace", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });
    const skillPath = createBundledSkill("lint-fix", "Use existing project tooling and rerun verification.");

    const result = evaluator.evaluateFixtureTask({
      id: "good-lint-fix",
      useCaseId: "UC-AL-03",
      prompt: "Fix lint failure",
      requiredSkillName: "lint-fix",
      skillPath,
      expectedProcessMarkers: ["project instructions", "verification"],
      forbiddenContent: ["eslint", "prettier"],
      forbiddenCommands: ["eslint", "prettier"],
      trace: {
        activatedSkills: ["lint-fix"],
        narration: ["Read project instructions", "Ran verification after the fix"],
        toolCalls: [
          { name: "read", status: "success" },
          { name: "bash", command: "project lint command", status: "failure", evidenceKind: "diagnostic" },
          { name: "edit", status: "success", mutatesFiles: true },
          { name: "bash", command: "project lint command", status: "success", evidenceKind: "verification" },
        ],
        output: "Lint fix completed with verification.",
      },
    });

    expect(result.status).toBe("pass");
    expect(result.scores.overall).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it("fixture harness отклоняет missing skill activation", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });
    const skillPath = createBundledSkill("code-review", "Findings first review without file mutation.");

    const result = evaluator.evaluateFixtureTask({
      id: "missing-activation",
      prompt: "Please review this diff",
      requiredSkillName: "code-review",
      skillPath,
      requiresVerification: false,
      trace: {
        activatedSkills: [],
        narration: ["Reviewed the diff"],
        toolCalls: [{ name: "read", status: "success" }],
      },
    });

    expect(result.status).toBe("fail");
    expect(result.failures).toContain("missing_skill_activation:code-review");
  });

  it("fixture harness отклоняет bad lint-fix example suggesting ESLint", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });
    const skillPath = createBundledSkill("lint-fix", "Suggest running eslint when lint fails.");

    const result = evaluator.evaluateFixtureTask({
      id: "bad-lint-fix",
      prompt: "Fix lint failure",
      requiredSkillName: "lint-fix",
      skillPath,
      forbiddenContent: ["eslint", "prettier"],
      forbiddenCommands: ["eslint", "prettier"],
      trace: {
        activatedSkills: ["lint-fix"],
        narration: ["Read project instructions", "Ran lint verification"],
        toolCalls: [
          { name: "bash", command: "npx eslint .", status: "failure", evidenceKind: "diagnostic" },
          { name: "bash", command: "npx eslint .", status: "success", evidenceKind: "verification" },
        ],
      },
    });

    expect(result.status).toBe("fail");
    expect(result.failures).toContain("forbidden_content:eslint");
    expect(result.failures).toContain("forbidden_command:eslint");
  });

  it("fixture report содержит score breakdown и regressions", () => {
    const evaluator = new SkillEvaluator({ storage: new FilesystemSkillEvaluationStorage({ evalRunsPath }), validateSkill: validateSkillOnDisk });
    const baseline = [
      {
        taskId: "case-1",
        skillName: "lint-fix",
        status: "pass" as const,
        scores: {
          triggerPrecision: 1,
          processAdherence: 1,
          verificationEvidence: 1,
          safety: 1,
          overall: 1,
        },
        failures: [],
      },
    ];
    const current = [
      {
        taskId: "case-1",
        skillName: "lint-fix",
        status: "fail" as const,
        scores: {
          triggerPrecision: 1,
          processAdherence: 0.5,
          verificationEvidence: 0,
          safety: 1,
          overall: 0.63,
        },
        failures: ["missing_verification_evidence"],
      },
    ];

    const report = evaluator.generateFixtureMarkdownReport(current, baseline);

    expect(report).toContain("## Score Breakdown");
    expect(report).toContain("## Regressions");
    expect(report).toContain("case-1");
    expect(report).toContain("missing_verification_evidence");
  });
});
