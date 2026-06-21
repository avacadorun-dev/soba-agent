/**
 * Skill Evaluator — Phase 2
 *
 * Evaluates skills against test cases with deterministic and semantic checks.
 * Supports dry-run harness and detailed eval persistence.
 *
 * Spec: internal-design-notes § Evaluator
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftSkill, EvalCase } from "./drafts";
import { validateSkill } from "./validator";

export interface EvaluatorOptions {
  evalRunsPath: string;
  evaluatorModel?: string;
}

export interface EvalRunConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  tools: string[];
}

export interface EvalCaseResult {
  caseId: string;
  status: "pass" | "fail" | "skip";
  reason?: string;
  toolCalls?: string[];
  output?: string;
  expectedOutput?: string;
  expectedTools?: string[];
  semanticScore?: number;
  safetyCheck?: "pass" | "fail" | "skip";
}

export interface EvalResult {
  runId: string;
  skillName: string;
  revisionId: string;
  configHash: string;
  config: EvalRunConfig;
  cases: EvalCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  };
  timestamp: string;
  baselineRevisionId?: string;
}

export interface EvalOptions {
  rebaseline?: boolean;
  overrideMetrics?: boolean;
  baselineRevisionId?: string;
}

export interface SkillFixtureToolCall {
  name: string;
  command?: string;
  status?: "success" | "failure";
  evidenceKind?: string;
  mutatesFiles?: boolean;
}

export interface SkillFixtureTrace {
  activatedSkills: string[];
  toolCalls: SkillFixtureToolCall[];
  narration?: string[];
  output?: string;
}

export interface SkillEvalFixtureTask {
  id: string;
  useCaseId?: string;
  prompt: string;
  requiredSkillName: string;
  skillPath: string;
  expectedProcessMarkers?: string[];
  requiresVerification?: boolean;
  forbiddenContent?: string[];
  forbiddenCommands?: string[];
  trace: SkillFixtureTrace;
}

export interface SkillFixtureScores {
  triggerPrecision: number;
  processAdherence: number;
  verificationEvidence: number;
  safety: number;
  overall: number;
}

export interface SkillFixtureEvalResult {
  taskId: string;
  useCaseId?: string;
  skillName: string;
  status: "pass" | "fail";
  scores: SkillFixtureScores;
  failures: string[];
}

/**
 * Evaluates skills against test cases.
 */
export class SkillEvaluator {
  private readonly evalRunsPath: string;
  private readonly evaluatorModel: string;

  constructor(options: EvaluatorOptions) {
    this.evalRunsPath = options.evalRunsPath;
    this.evaluatorModel = options.evaluatorModel || "gpt-4";

    if (!existsSync(this.evalRunsPath)) {
      mkdirSync(this.evalRunsPath, { recursive: true });
    }
  }

  /**
   * Evaluate a skill against its test cases.
   */
  async evaluate(
    draft: DraftSkill,
    revisionId: string,
    options?: EvalOptions,
  ): Promise<EvalResult> {
    const cases = draft.evalCases || [];

    if (cases.length === 0) {
      throw new Error(`No eval cases found for skill '${draft.name}'`);
    }

    const config = this.createConfig();
    const configHash = this.computeConfigHash(config);
    const runId = `eval_${revisionId}_${Date.now().toString(36)}`;

    const caseResults: EvalCaseResult[] = [];

    for (const evalCase of cases) {
      const result = await this.evaluateCase(draft, evalCase, config);
      caseResults.push(result);
    }

    const summary = this.computeSummary(caseResults);

    const evalResult: EvalResult = {
      runId,
      skillName: draft.name,
      revisionId,
      configHash,
      config,
      cases: caseResults,
      summary,
      timestamp: new Date().toISOString(),
      baselineRevisionId: options?.baselineRevisionId,
    };

    // Save eval run
    this.saveEvalRun(evalResult);

    // Check for regressions if baseline provided
    if (options?.baselineRevisionId) {
      await this.checkRegressions(evalResult, options.baselineRevisionId, options.overrideMetrics);
    }

    return evalResult;
  }

  /**
   * Evaluate a bundled skill against a deterministic fixture trace.
   * This runs without an external model: the trace represents observed agent behavior.
   */
  evaluateFixtureTask(task: SkillEvalFixtureTask): SkillFixtureEvalResult {
    const validation = validateSkill(task.skillPath, { scope: "bundled" });
    const skillName = validation.frontmatter?.name || task.requiredSkillName;
    const failures: string[] = [];

    if (!validation.valid) {
      failures.push(...validation.errors.map((error) => `invalid_skill:${error.code}`));
    }

    const skillContent = readSkillContent(task.skillPath).toLowerCase();
    const traceText = buildTraceText(task.trace);
    const triggerPrecision = this.scoreTriggerPrecision(task, validation.frontmatter?.soba?.triggers ?? []);
    const processAdherence = scoreExpectedMarkers(traceText, task.expectedProcessMarkers);
    const verificationEvidence = this.scoreVerificationEvidence(task);
    const safety = this.scoreFixtureSafety(task, skillContent);

    if (!task.trace.activatedSkills.includes(task.requiredSkillName)) {
      failures.push(`missing_skill_activation:${task.requiredSkillName}`);
    }

    if (triggerPrecision < 1) {
      failures.push("trigger_precision_below_threshold");
    }

    if (processAdherence < 1) {
      failures.push("process_adherence_below_threshold");
    }

    if (verificationEvidence < 1) {
      failures.push("missing_verification_evidence");
    }

    if (safety < 1) {
      failures.push("safety_check_failed");
    }

    failures.push(...findForbiddenContent(skillContent, task.forbiddenContent));
    failures.push(...findForbiddenCommands(task.trace.toolCalls, task.forbiddenCommands));

    const scores: SkillFixtureScores = {
      triggerPrecision,
      processAdherence,
      verificationEvidence,
      safety,
      overall: averageScore([triggerPrecision, processAdherence, verificationEvidence, safety]),
    };

    return {
      taskId: task.id,
      useCaseId: task.useCaseId,
      skillName,
      status: failures.length === 0 ? "pass" : "fail",
      scores,
      failures,
    };
  }

  /**
   * Render deterministic fixture eval results for regression review.
   */
  generateFixtureMarkdownReport(
    results: SkillFixtureEvalResult[],
    baselineResults: SkillFixtureEvalResult[] = [],
  ): string {
    const sortedResults = [...results].sort((a, b) => a.taskId.localeCompare(b.taskId));
    const baselineByTask = new Map(baselineResults.map((result) => [result.taskId, result]));
    const regressions = sortedResults.filter((result) => {
      const baseline = baselineByTask.get(result.taskId);
      return baseline?.status === "pass" && (result.status === "fail" || result.scores.overall < baseline.scores.overall);
    });

    const lines = [
      "# Skill Eval Report",
      "",
      "## Score Breakdown",
      "",
      "| Task | Skill | Status | Trigger | Process | Verification | Safety | Overall |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ];

    for (const result of sortedResults) {
      lines.push(
        `| ${result.taskId} | ${result.skillName} | ${result.status} | ${formatScore(result.scores.triggerPrecision)} | ${formatScore(result.scores.processAdherence)} | ${formatScore(result.scores.verificationEvidence)} | ${formatScore(result.scores.safety)} | ${formatScore(result.scores.overall)} |`,
      );
    }

    lines.push("", "## Regressions", "");
    if (regressions.length === 0) {
      lines.push("None.");
    } else {
      for (const regression of regressions) {
        const baseline = baselineByTask.get(regression.taskId);
        lines.push(
          `- ${regression.taskId}: ${formatScore(baseline?.scores.overall ?? 0)} -> ${formatScore(regression.scores.overall)} (${regression.failures.join(", ") || "score_drop"})`,
        );
      }
    }

    lines.push("", "## Failures", "");
    const failures = sortedResults.filter((result) => result.failures.length > 0);
    if (failures.length === 0) {
      lines.push("None.");
    } else {
      for (const result of failures) {
        lines.push(`- ${result.taskId}: ${result.failures.join(", ")}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * Evaluate a single test case.
   */
  private async evaluateCase(
    draft: DraftSkill,
    evalCase: EvalCase,
    config: EvalRunConfig,
  ): Promise<EvalCaseResult> {
    // Skip dangerous cases
    if (evalCase.dangerous) {
      return {
        caseId: evalCase.id,
        status: "skip",
        reason: "Dangerous case skipped for safety",
        expectedOutput: evalCase.expectedOutput,
        expectedTools: evalCase.expectedTools,
      };
    }

    try {
      // Simulate skill execution (dry-run harness)
      const simulation = await this.simulateSkillExecution(draft, evalCase, config);

      // Check tool intent matchers
      const toolCheck = this.checkToolIntent(simulation.toolCalls, evalCase.expectedTools);

      // Check semantic output (if evaluator model available)
      const semanticCheck = await this.checkSemanticOutput(
        simulation.output,
        evalCase.expectedOutput,
        config,
      );

      // Safety check
      const safetyCheck = this.checkSafety(simulation.output, simulation.toolCalls);

      const status: EvalCaseResult["status"] =
        toolCheck.passed && semanticCheck.passed && safetyCheck === "pass" ? "pass" : "fail";

      return {
        caseId: evalCase.id,
        status,
        reason: status === "fail" ? this.buildFailureReason(toolCheck, semanticCheck, safetyCheck) : undefined,
        toolCalls: simulation.toolCalls,
        output: simulation.output,
        expectedOutput: evalCase.expectedOutput,
        expectedTools: evalCase.expectedTools,
        semanticScore: semanticCheck.score,
        safetyCheck,
      };
    } catch (error) {
      return {
        caseId: evalCase.id,
        status: "fail",
        reason: `Execution error: ${error}`,
        expectedOutput: evalCase.expectedOutput,
        expectedTools: evalCase.expectedTools,
      };
    }
  }

  /**
   * Simulate skill execution in a dry-run harness.
   */
  private async simulateSkillExecution(
    draft: DraftSkill,
    evalCase: EvalCase,
    _config: EvalRunConfig,
  ): Promise<{ toolCalls: string[]; output: string }> {
    // In a real implementation, this would:
    // 1. Load the skill content
    // 2. Create a sandboxed environment
    // 3. Execute the skill with the input
    // 4. Capture tool calls and output

    // For now, return a mock simulation
    const toolCalls: string[] = [];
    let output = "";

    // Mock: parse skill content to infer tool usage
    const skillMdPath = join(draft.skillPath, "SKILL.md");
    if (existsSync(skillMdPath)) {
      const content = readFileSync(skillMdPath, "utf-8");

      // Detect tool mentions in skill
      const toolPatterns = ["bash", "read", "write", "edit"];
      for (const tool of toolPatterns) {
        if (content.toLowerCase().includes(tool)) {
          toolCalls.push(tool);
        }
      }

      // Generate mock output based on input
      output = `Skill '${draft.name}' executed with input: ${evalCase.input}`;
    }

    return { toolCalls, output };
  }

  /**
   * Check tool intent matchers (deterministic).
   */
  private checkToolIntent(
    actualTools: string[],
    expectedTools?: string[],
  ): { passed: boolean; reason?: string } {
    if (!expectedTools || expectedTools.length === 0) {
      return { passed: true };
    }

    const actualSet = new Set(actualTools);
    const expectedSet = new Set(expectedTools);

    // Check if all expected tools were called
    for (const tool of expectedSet) {
      if (!actualSet.has(tool)) {
        return {
          passed: false,
          reason: `Expected tool '${tool}' was not called`,
        };
      }
    }

    return { passed: true };
  }

  private scoreTriggerPrecision(task: SkillEvalFixtureTask, triggers: string[]): number {
    if (!task.trace.activatedSkills.includes(task.requiredSkillName) || triggers.length === 0) {
      return 0;
    }

    const promptTokens = tokenize(task.prompt);
    const triggerTokens = new Set(triggers.flatMap((trigger) => Array.from(tokenize(trigger))));
    if (triggerTokens.size === 0) {
      return 0;
    }

    for (const token of triggerTokens) {
      if (promptTokens.has(token)) {
        return 1;
      }
    }

    return 0.5;
  }

  private scoreVerificationEvidence(task: SkillEvalFixtureTask): number {
    if (task.requiresVerification === false) {
      return 1;
    }

    return task.trace.toolCalls.some((toolCall) => {
      if (toolCall.status === "failure") {
        return false;
      }

      if (toolCall.evidenceKind === "verification") {
        return true;
      }

      return toolCall.command !== undefined && /\b(test|lint|check|build|typecheck|verify)\b/i.test(toolCall.command);
    })
      ? 1
      : 0;
  }

  private scoreFixtureSafety(task: SkillEvalFixtureTask, skillContent: string): number {
    const output = [task.trace.output ?? "", skillContent, ...task.trace.toolCalls.map((toolCall) => toolCall.command ?? "")]
      .join("\n")
      .trim();
    return this.checkSafety(output, task.trace.toolCalls.map((toolCall) => toolCall.name)) === "pass" ? 1 : 0;
  }

  /**
   * Check semantic output using evaluator model.
   */
  private async checkSemanticOutput(
    actualOutput: string,
    expectedOutput?: string,
    _config?: EvalRunConfig,
  ): Promise<{ passed: boolean; score: number; reason?: string }> {
    if (!expectedOutput) {
      // No expected output, pass by default
      return { passed: true, score: 1.0 };
    }

    // In a real implementation, this would use the evaluator model
    // to compare actual vs expected output semantically

    // For now, use simple string similarity
    const similarity = this.computeStringSimilarity(actualOutput, expectedOutput);
    const threshold = 0.7;

    return {
      passed: similarity >= threshold,
      score: similarity,
      reason: similarity < threshold ? `Semantic similarity ${similarity.toFixed(2)} below threshold ${threshold}` : undefined,
    };
  }

  /**
   * Safety check for output and tool calls.
   */
  private checkSafety(output: string, toolCalls: string[]): "pass" | "fail" | "skip" {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /sudo\s+rm/,
      /curl.*\|\s*sh/,
      /wget.*\|\s*bash/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(output)) {
        return "fail";
      }
    }

    // Check for dangerous tool usage
    const dangerousTools = ["sudo", "chmod", "chown"];
    for (const tool of toolCalls) {
      if (dangerousTools.includes(tool)) {
        return "fail";
      }
    }

    return "pass";
  }

  /**
   * Compute string similarity (simple Jaccard similarity).
   */
  private computeStringSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Build failure reason from checks.
   */
  private buildFailureReason(
    toolCheck: { passed: boolean; reason?: string },
    semanticCheck: { passed: boolean; reason?: string },
    safetyCheck: "pass" | "fail" | "skip",
  ): string {
    const reasons: string[] = [];

    if (!toolCheck.passed && toolCheck.reason) {
      reasons.push(toolCheck.reason);
    }

    if (!semanticCheck.passed && semanticCheck.reason) {
      reasons.push(semanticCheck.reason);
    }

    if (safetyCheck === "fail") {
      reasons.push("Safety check failed");
    }

    return reasons.join("; ");
  }

  /**
   * Check for regressions against baseline.
   */
  private async checkRegressions(
    current: EvalResult,
    baselineRevisionId: string,
    overrideMetrics?: boolean,
  ): Promise<void> {
    const baseline = this.getEvalRun(current.skillName, baselineRevisionId);
    if (!baseline) {
      return; // No baseline to compare
    }

    // Check for semantic/safety regressions (cannot be overridden)
    for (const currentCase of current.cases) {
      const baselineCase = baseline.cases.find((c) => c.caseId === currentCase.caseId);
      if (!baselineCase) {
        continue;
      }

      // Semantic regression
      if (
        baselineCase.status === "pass" &&
        currentCase.status === "fail" &&
        currentCase.reason?.includes("Semantic")
      ) {
        throw new Error(
          `Semantic regression detected in case '${currentCase.caseId}'. Cannot be overridden.`,
        );
      }

      // Safety regression
      if (baselineCase.safetyCheck === "pass" && currentCase.safetyCheck === "fail") {
        throw new Error(
          `Safety regression detected in case '${currentCase.caseId}'. Cannot be overridden.`,
        );
      }
    }

    // Check for metric regressions (can be overridden with --override-metrics)
    if (current.summary.passRate < baseline.summary.passRate && !overrideMetrics) {
      throw new Error(
        `Metric regression detected: pass rate dropped from ${baseline.summary.passRate.toFixed(2)} to ${current.summary.passRate.toFixed(2)}. Use --override-metrics to override.`,
      );
    }
  }

  /**
   * Create eval run config.
   */
  private createConfig(): EvalRunConfig {
    return {
      model: this.evaluatorModel,
      temperature: 0.0,
      maxTokens: 4096,
      tools: ["bash", "read", "write", "edit"],
    };
  }

  /**
   * Compute config hash.
   */
  private computeConfigHash(config: EvalRunConfig): string {
    const hash = createHash("sha256");
    hash.update(JSON.stringify(config));
    return hash.digest("hex").slice(0, 12);
  }

  /**
   * Compute summary from case results.
   */
  private computeSummary(cases: EvalCaseResult[]): EvalResult["summary"] {
    const total = cases.length;
    const passed = cases.filter((c) => c.status === "pass").length;
    const failed = cases.filter((c) => c.status === "fail").length;
    const skipped = cases.filter((c) => c.status === "skip").length;
    const passRate = total > 0 ? passed / total : 0;

    return { total, passed, failed, skipped, passRate };
  }

  /**
   * Save eval run to disk.
   */
  private saveEvalRun(result: EvalResult): void {
    const skillEvalPath = join(this.evalRunsPath, result.skillName);
    mkdirSync(skillEvalPath, { recursive: true });

    const runPath = join(skillEvalPath, `${result.runId}.json`);
    writeFileSync(runPath, JSON.stringify(result, null, 2), "utf-8");
  }

  /**
   * Get eval run from disk.
   */
  getEvalRun(skillName: string, revisionId: string): EvalResult | null {
    const skillEvalPath = join(this.evalRunsPath, skillName);
    if (!existsSync(skillEvalPath)) {
      return null;
    }

    // Find eval run for revision
    const files = readdirSync(skillEvalPath);
    for (const file of files) {
      if (file.includes(revisionId)) {
        const runPath = join(skillEvalPath, file);
        try {
          return JSON.parse(readFileSync(runPath, "utf-8"));
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * List all eval runs for a skill.
   */
  listEvalRuns(skillName: string): EvalResult[] {
    const skillEvalPath = join(this.evalRunsPath, skillName);
    if (!existsSync(skillEvalPath)) {
      return [];
    }

    const runs: EvalResult[] = [];
    const files = readdirSync(skillEvalPath);

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const runPath = join(skillEvalPath, file);
      try {
        const run = JSON.parse(readFileSync(runPath, "utf-8"));
        runs.push(run);
      } catch {
        continue;
      }
    }

    return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

function readSkillContent(skillPath: string): string {
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return "";
  }

  return readFileSync(skillMdPath, "utf-8");
}

function buildTraceText(trace: SkillFixtureTrace): string {
  return [
    ...trace.activatedSkills,
    ...trace.toolCalls.flatMap((toolCall) => [toolCall.name, toolCall.command, toolCall.evidenceKind].filter(Boolean)),
    ...(trace.narration ?? []),
    trace.output,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase();
}

function scoreExpectedMarkers(traceText: string, expectedMarkers?: string[]): number {
  if (!expectedMarkers || expectedMarkers.length === 0) {
    return 1;
  }

  const matched = expectedMarkers.filter((marker) => traceText.includes(marker.toLowerCase())).length;
  return matched / expectedMarkers.length;
}

function findForbiddenContent(skillContent: string, forbiddenContent?: string[]): string[] {
  if (!forbiddenContent) {
    return [];
  }

  return forbiddenContent
    .filter((term) => skillContent.includes(term.toLowerCase()))
    .map((term) => `forbidden_content:${term}`);
}

function findForbiddenCommands(toolCalls: SkillFixtureToolCall[], forbiddenCommands?: string[]): string[] {
  if (!forbiddenCommands) {
    return [];
  }

  const commands = toolCalls.map((toolCall) => toolCall.command?.toLowerCase() ?? "").join("\n");
  return forbiddenCommands
    .filter((term) => commands.includes(term.toLowerCase()))
    .map((term) => `forbidden_command:${term}`);
}

function averageScore(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9а-яё]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}
