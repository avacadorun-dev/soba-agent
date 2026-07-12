import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { verifyEvidenceProof } from "../../../src/application/commands/verify";
import { FilesystemEvidenceProofStorage } from "../../../src/infrastructure/persistence/evidence/proof-storage";
import { redactSecrets } from "../../../src/kernel/tools/errors";

export type EvalVariant = "baseline" | "soba_gated";

export interface RealModelEvalProfile {
  version: 1;
  id: string;
  comparisonMode: "policy_smoke" | "agent_comparison";
  provider: string;
  model: string;
  revision: string;
  repetitions?: number;
  tasks: string[];
  baseline: { command: string[] };
  sobaGated: { command: string[] };
}

export interface RealModelEvalTask {
  version: 1;
  id: string;
  fixture: string;
  prompt: string;
  allowedChanges?: string[];
  acceptance: string[][];
}

export interface CommandArtifact {
  command: string[];
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutDigest: string;
  stderrDigest: string;
  timedOut: boolean;
}

export interface RealModelEvalResult {
  runId: string;
  profileId: string;
  provider: string;
  model: string;
  revision: string;
  taskId: string;
  fixtureTree: string;
  repetition: number;
  variant: EvalVariant;
  producer: CommandArtifact;
  acceptance: CommandArtifact[];
  acceptancePassed: boolean;
  changedPaths: string[];
  scopePassed: boolean;
  scopeViolations: string[];
  completionClaimed: boolean;
  proofPath?: string;
  proofValid?: boolean;
  proofAccepted?: boolean;
  proofStatus?: string;
  proofOutcome?: string;
  proofReasons: string[];
  automatedReviewTimeMs: number;
  humanReviewTimeMs: number | null;
  falseCompletion: boolean;
  missedDefects: number;
  verifiedSuccess: boolean;
  interventionCount: number | null;
  modelCalls: number | null;
  tokens: number | null;
  wallTimeMs: number;
  diff: string;
}

export interface ComparativeMetrics {
  tasks: number;
  attempts: number;
  falseCompletions: number;
  falseCompletionRate: number;
  verifiedSuccesses: number;
  verifiedSuccessRate: number;
  acceptanceSuccesses: number;
  acceptanceSuccessRate: number;
  scopeSuccesses: number;
  scopeSuccessRate: number;
  scopeViolations: number;
  interventions: number | null;
  missedDefects: number;
  automatedReviewTimeMs: number;
  humanReviewTimeMs: number | null;
  totalWallTimeMs: number;
  tokens: number | null;
  modelCalls: number | null;
}

export interface RealModelEvalReport {
  version: 1;
  runId: string;
  createdAt: string;
  profile: Pick<RealModelEvalProfile, "id" | "comparisonMode" | "provider" | "model" | "revision">;
  results: RealModelEvalResult[];
  metrics: Record<EvalVariant, ComparativeMetrics>;
}

export async function runRealModelComparativeEval(input: {
  projectRoot: string;
  profilePath: string;
  outputDir: string;
  timeoutMs?: number;
  retainWorkspaces?: boolean;
}): Promise<RealModelEvalReport> {
  const projectRoot = resolve(input.projectRoot);
  const profilePath = resolve(projectRoot, input.profilePath);
  const profile = readJson<RealModelEvalProfile>(profilePath);
  validateProfile(profile);
  const runId = `eval_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runOutputDir = resolve(projectRoot, input.outputDir, runId);
  mkdirSync(runOutputDir, { recursive: true });
  const results: RealModelEvalResult[] = [];

  for (const taskPath of profile.tasks) {
    const task = readJson<RealModelEvalTask>(resolve(projectRoot, taskPath));
    validateTask(task);
    for (let repetition = 1; repetition <= (profile.repetitions ?? 1); repetition += 1) {
      for (const variant of ["baseline", "soba_gated"] as const) {
        const workspace = join(runOutputDir, "workspaces", task.id, `${repetition}-${variant}`);
        await prepareWorkspace(resolve(projectRoot, task.fixture), workspace);
        const fixtureTreeArtifact = await runCommand(["git", "rev-parse", "HEAD^{tree}"], workspace, 30_000);
        const fixtureTree = fixtureTreeArtifact.exitCode === 0 ? fixtureTreeArtifact.stdout.trim() : "unknown";
        const startedAt = performance.now();
        const template = variant === "baseline" ? profile.baseline.command : profile.sobaGated.command;
        const producer = await runCommand(
          expandCommand(template, { projectRoot, workspace, prompt: task.prompt, model: profile.model, provider: profile.provider }),
          workspace,
          input.timeoutMs ?? 15 * 60_000,
        );
        const changedPathsArtifact = await runCommand(["git", "diff", "--name-only", "--"], workspace, 30_000);
        const changedPaths = changedPathsArtifact.exitCode === 0
          ? changedPathsArtifact.stdout.split("\n").map((path) => path.trim()).filter(Boolean)
          : [];
        const scopeViolations = findScopeViolations(changedPaths, task.allowedChanges);
        const scopePassed = changedPathsArtifact.exitCode === 0 && scopeViolations.length === 0;
        const acceptance: CommandArtifact[] = [];
        for (const command of task.acceptance) {
          acceptance.push(await runCommand(expandCommand(command, { projectRoot, workspace, prompt: task.prompt, model: profile.model, provider: profile.provider }), workspace, input.timeoutMs ?? 15 * 60_000));
        }
        const acceptancePassed = acceptance.length > 0 && acceptance.every((artifact) => artifact.exitCode === 0);
        const proof = variant === "soba_gated" ? verifyLatestProof(workspace) : undefined;
        const proofArtifactName = proof ? `${task.id}-${repetition}-${variant}.proof.json` : undefined;
        if (proof && proofArtifactName) {
          writeOwnerOnly(join(runOutputDir, proofArtifactName), `${JSON.stringify(proof.bundle, null, 2)}\n`);
        }
        const completionClaimed = producer.exitCode === 0 && !producer.timedOut;
        const falseCompletion = completionClaimed &&
          (!acceptancePassed || !scopePassed || (variant === "soba_gated" && proof?.accepted !== true));
        const diffArtifact = await runCommand(["git", "diff", "--no-ext-diff", "--"], workspace, 30_000);
        const result: RealModelEvalResult = {
          runId,
          profileId: profile.id,
          provider: profile.provider,
          model: profile.model,
          revision: profile.revision,
          taskId: task.id,
          fixtureTree,
          repetition,
          variant,
          producer,
          acceptance,
          acceptancePassed,
          changedPaths,
          scopePassed,
          scopeViolations,
          completionClaimed,
          proofPath: proofArtifactName,
          proofValid: proof?.valid,
          proofAccepted: variant === "soba_gated" ? proof?.accepted ?? false : undefined,
          proofStatus: variant === "soba_gated" ? proof?.status ?? "missing" : undefined,
          proofOutcome: variant === "soba_gated" ? proof?.outcome ?? "missing" : undefined,
          proofReasons: proof?.reasons ?? (variant === "soba_gated" ? ["missing_proof"] : []),
          automatedReviewTimeMs: proof?.reviewTimeMs ?? 0,
          humanReviewTimeMs: null,
          falseCompletion,
          missedDefects: completionClaimed
            ? acceptance.filter((artifact) => artifact.exitCode !== 0).length + scopeViolations.length
            : 0,
          verifiedSuccess: variant === "soba_gated" && acceptancePassed && scopePassed && proof?.accepted === true,
          interventionCount: extractMetric(
            `${producer.stdout}\n${producer.stderr}`,
            /interventions?\s*[:=]?\s*([\d,]+)/i,
          ) ?? proof?.interventionCount ?? null,
          modelCalls: extractMetric(
            `${producer.stdout}\n${producer.stderr}`,
            /model calls?\s*[:=]?\s*([\d,]+)/i,
          ) ?? proof?.modelCalls ?? null,
          tokens: extractMetric(
            `${producer.stdout}\n${producer.stderr}`,
            /tokens?(?:\s+used)?\s*[:=]?\s*([\d,]+)/i,
          ) ?? proof?.tokens ?? null,
          wallTimeMs: Math.round(performance.now() - startedAt),
          diff: redactSecrets(diffArtifact.stdout),
        };
        results.push(result);
        writeOwnerOnly(
          join(runOutputDir, `${task.id}-${repetition}-${variant}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        if (!input.retainWorkspaces) rmSync(workspace, { recursive: true, force: true });
      }
    }
  }
  if (!input.retainWorkspaces) rmSync(join(runOutputDir, "workspaces"), { recursive: true, force: true });

  const report: RealModelEvalReport = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      comparisonMode: profile.comparisonMode,
      provider: profile.provider,
      model: profile.model,
      revision: profile.revision,
    },
    results,
    metrics: {
      baseline: aggregateMetrics(results.filter((result) => result.variant === "baseline")),
      soba_gated: aggregateMetrics(results.filter((result) => result.variant === "soba_gated")),
    },
  };
  writeOwnerOnly(join(runOutputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeOwnerOnly(join(runOutputDir, "report.md"), renderComparativeReport(report));
  return report;
}

export function aggregateMetrics(results: RealModelEvalResult[]): ComparativeMetrics {
  const attempts = results.length;
  const falseCompletions = results.filter((result) => result.falseCompletion).length;
  const verifiedSuccesses = results.filter((result) => result.verifiedSuccess).length;
  const acceptanceSuccesses = results.filter((result) => result.acceptancePassed).length;
  const scopeSuccesses = results.filter((result) => result.scopePassed).length;
  const scopeViolations = results.reduce((sum, result) => sum + result.scopeViolations.length, 0);
  const tokenValues = results.map((result) => result.tokens).filter((value): value is number => value !== null);
  const callValues = results.map((result) => result.modelCalls).filter((value): value is number => value !== null);
  const interventionValues = results
    .map((result) => result.interventionCount)
    .filter((value): value is number => value !== null);
  return {
    tasks: new Set(results.map((result) => result.taskId)).size,
    attempts,
    falseCompletions,
    falseCompletionRate: rate(falseCompletions, attempts),
    verifiedSuccesses,
    verifiedSuccessRate: rate(verifiedSuccesses, attempts),
    acceptanceSuccesses,
    acceptanceSuccessRate: rate(acceptanceSuccesses, attempts),
    scopeSuccesses,
    scopeSuccessRate: rate(scopeSuccesses, attempts),
    scopeViolations,
    interventions: interventionValues.length === results.length
      ? interventionValues.reduce((sum, value) => sum + value, 0)
      : null,
    missedDefects: results.reduce((sum, result) => sum + result.missedDefects, 0),
    automatedReviewTimeMs: results.reduce((sum, result) => sum + result.automatedReviewTimeMs, 0),
    humanReviewTimeMs: null,
    totalWallTimeMs: results.reduce((sum, result) => sum + result.wallTimeMs, 0),
    tokens: tokenValues.length === results.length ? tokenValues.reduce((sum, value) => sum + value, 0) : null,
    modelCalls: callValues.length === results.length ? callValues.reduce((sum, value) => sum + value, 0) : null,
  };
}

export function renderComparativeReport(report: RealModelEvalReport): string {
  const rows = (["baseline", "soba_gated"] as const).map((variant) => {
    const metrics = report.metrics[variant];
    return `| ${variant} | ${metrics.attempts} | ${metrics.acceptanceSuccesses} | ${metrics.scopeSuccesses} | ${metrics.scopeViolations} | ${metrics.falseCompletions} | ${metrics.missedDefects} | ${metrics.verifiedSuccesses} | ${metrics.interventions ?? "unknown"} | ${metrics.automatedReviewTimeMs} | ${metrics.humanReviewTimeMs ?? "unknown"} | ${metrics.totalWallTimeMs} | ${metrics.tokens ?? "unknown"} |`;
  });
  return [
    "# SOBA real-model comparative eval",
    "",
    `- Run: \`${report.runId}\``,
    `- Profile: \`${report.profile.id}\``,
    `- Comparison mode: \`${report.profile.comparisonMode}\``,
    `- Provider/model: \`${report.profile.provider}/${report.profile.model}\``,
    `- Revision: \`${report.profile.revision}\``,
    "",
    "| Variant | Attempts | Acceptance pass | Scope pass | Scope violations | False completion | Missed defects | Verified success | Interventions | Auto review ms | Human review ms | Wall time ms | Tokens |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
  ].join("\n");
}

function verifyLatestProof(workspace: string):
  | {
      path: string;
      valid: boolean;
      accepted: boolean;
      status: string;
      outcome: string;
      reasons: string[];
      reviewTimeMs: number;
      bundle: Record<string, unknown>;
      interventionCount: number | null;
      modelCalls: number | null;
      tokens: number | null;
    }
  | undefined {
  const storage = new FilesystemEvidenceProofStorage({ projectRoot: workspace });
  const proof = storage.readLatestEvidenceBundle();
  if (!proof) return undefined;
  const startedAt = performance.now();
  const verification = verifyEvidenceProof(proof);
  const metrics = isRecord(proof.bundle.metrics) ? proof.bundle.metrics : undefined;
  const tokenMetrics = metrics && isRecord(metrics.tokens) ? metrics.tokens : undefined;
  const approvals = Array.isArray(proof.bundle.approvals) ? proof.bundle.approvals : [];
  return {
    path: relative(workspace, proof.path),
    valid: verification.valid,
    accepted: verification.accepted,
    status: typeof proof.bundle.status === "string" ? proof.bundle.status : "unknown",
    outcome: verification.outcome,
    reasons: verification.issues.length > 0
      ? verification.issues.map((issue) => issue.code)
      : verification.accepted ? [] : [verification.reason],
    reviewTimeMs: Math.round(performance.now() - startedAt),
    bundle: proof.bundle,
    interventionCount: approvals.filter((approval) =>
      isRecord(approval) && typeof approval.decision === "string" && approval.decision !== "auto"
    ).length,
    modelCalls: metrics && typeof metrics.modelCalls === "number" ? metrics.modelCalls : null,
    tokens: tokenMetrics && typeof tokenMetrics.total === "number" ? tokenMetrics.total : null,
  };
}

async function prepareWorkspace(fixture: string, workspace: string): Promise<void> {
  const parent = resolve(workspace, "..");
  mkdirSync(parent, { recursive: true });
  const copy = await runCommand(["cp", "-R", fixture, workspace], parent, 30_000);
  if (copy.exitCode !== 0) throw new Error(`Failed to copy fixture ${fixture}: ${copy.stderr}`);
  for (const command of [
    ["git", "init", "-q"],
    ["git", "config", "user.email", "eval@soba.local"],
    ["git", "config", "user.name", "SOBA Eval"],
    ["git", "add", "."],
    ["git", "commit", "-qm", "fixture baseline"],
  ]) {
    const result = await runCommand(command, workspace, 30_000);
    if (result.exitCode !== 0) throw new Error(`Fixture git setup failed: ${result.stderr}`);
  }
}

async function runCommand(command: string[], cwd: string, timeoutMs: number): Promise<CommandArtifact> {
  const startedAt = performance.now();
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const redactedStdout = sanitizeEvalText(stdout, cwd);
  const redactedStderr = sanitizeEvalText(stderr, cwd);
  return {
    command: sanitizeEvalCommand(command, cwd),
    exitCode,
    durationMs: Math.round(performance.now() - startedAt),
    stdout: boundedOutput(redactedStdout),
    stderr: boundedOutput(redactedStderr),
    stdoutDigest: sha256(redactedStdout),
    stderrDigest: sha256(redactedStderr),
    timedOut,
  };
}

function expandCommand(command: string[], values: Record<string, string>): string[] {
  return command.map((argument) =>
    Object.entries(values).reduce((expanded, [key, value]) => expanded.replaceAll(`{${key}}`, value), argument)
  );
}

function extractMetric(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match?.[1] ? Number.parseInt(match[1].replaceAll(",", ""), 10) : null;
}

export function findScopeViolations(
  changedPaths: readonly string[],
  allowedChanges: readonly string[] | undefined,
): string[] {
  if (allowedChanges === undefined) return [];
  const matchers = allowedChanges.map((pattern) => new Bun.Glob(pattern));
  return changedPaths.filter((path) => !matchers.some((matcher) => matcher.match(path)));
}

function boundedOutput(value: string, maxChars = 12_000): string {
  if (value.length <= maxChars) return value;
  const half = Math.floor(maxChars / 2);
  return `${value.slice(0, half)}\n[Eval output truncated]\n${value.slice(-half)}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sanitizeEvalText(value: string, workspace: string): string {
  let sanitized = redactSecrets(value).replaceAll(workspace, "{workspace}");
  if (process.env.HOME) sanitized = sanitized.replaceAll(process.env.HOME, "{home}");
  return sanitized.replaceAll(/(session id:\s*)[a-f0-9-]+/gi, "$1[REDACTED-ID]");
}

function sanitizeEvalCommand(command: string[], workspace: string): string[] {
  const secretFlag = /^--?(?:api[-_]?key|token|password|secret|authorization|cookie|credential)$/i;
  let redactNext = false;
  return command.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    if (secretFlag.test(argument)) {
      redactNext = true;
      return argument;
    }
    return sanitizeEvalText(argument, workspace);
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeOwnerOnly(path: string, content: string): void {
  writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function validateProfile(profile: RealModelEvalProfile): void {
  if (
    profile.version !== 1 ||
    !profile.id ||
    !["policy_smoke", "agent_comparison"].includes(profile.comparisonMode) ||
    !profile.provider ||
    !profile.model ||
    !profile.revision
  ) {
    throw new Error("Invalid real-model eval profile metadata.");
  }
  if (!profile.tasks?.length || !profile.baseline?.command?.length || !profile.sobaGated?.command?.length) {
    throw new Error("Eval profile requires tasks, baseline.command, and sobaGated.command.");
  }
  if (profile.provider !== "fixture") {
    for (const [variant, command] of [["baseline", profile.baseline.command], ["soba_gated", profile.sobaGated.command]] as const) {
      if (!command.some((argument) => argument.includes("{model}"))) {
        throw new Error(`${variant} command must consume the pinned {model} identity.`);
      }
    }
  }
  if (
    profile.comparisonMode === "agent_comparison" &&
    JSON.stringify(profile.baseline.command) === JSON.stringify(profile.sobaGated.command)
  ) {
    throw new Error("agent_comparison requires distinct baseline and sobaGated producer commands.");
  }
}

function validateTask(task: RealModelEvalTask): void {
  if (task.version !== 1 || !task.id || !task.fixture || !task.prompt || !task.acceptance?.length) {
    throw new Error(`Invalid real-model eval task: ${task.id || "unknown"}.`);
  }
  if (
    task.allowedChanges !== undefined &&
    (!Array.isArray(task.allowedChanges) ||
      task.allowedChanges.some((pattern) =>
        typeof pattern !== "string" || pattern.length === 0 || pattern.startsWith("/") || pattern.includes("..")
      ))
  ) {
    throw new Error(`Invalid allowedChanges for real-model eval task: ${task.id}.`);
  }
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
