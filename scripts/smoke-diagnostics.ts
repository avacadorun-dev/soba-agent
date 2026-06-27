import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SmokeProfile = "local" | "terminal-bench" | "all";
export type SmokeStepStatus = "planned" | "passed" | "failed" | "skipped";
export type SobaEntrypointMode = "linux-x64-binary" | "bun-dist" | "bun-source";

type RuntimePlatform = typeof process.platform;
type SmokeEnvironment = Record<string, string | undefined>;

export interface SmokeDiagnosticsCliOptions {
  profile: SmokeProfile;
  dryRun: boolean;
  json: boolean;
  runExternal: boolean;
  requireExternal: boolean;
  help: boolean;
}

export interface SobaEntrypoint {
  mode: SobaEntrypointMode;
  command: string[];
  description: string;
}

export interface SmokePlanStep {
  id: string;
  title: string;
  command: string[];
  required: boolean;
  external: boolean;
  requiresRunExternal?: boolean;
  prerequisite?: string;
  metadataOnly?: boolean;
}

export interface SmokePlan {
  profile: SmokeProfile;
  cwd: string;
  entrypoint: SobaEntrypoint;
  steps: SmokePlanStep[];
}

export interface SmokeCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface SmokeStepResult extends SmokePlanStep {
  status: SmokeStepStatus;
  exitCode?: number;
  durationMs?: number;
  reason?: string;
  stdout?: string;
  stderr?: string;
}

export interface SmokeRunResult {
  profile: SmokeProfile;
  cwd: string;
  entrypoint: SobaEntrypoint;
  steps: SmokeStepResult[];
  exitCode: number;
}

export interface BuildSmokePlanOptions {
  cwd?: string;
  profile?: SmokeProfile;
  platform?: RuntimePlatform;
  arch?: string;
}

export interface RunSmokeDiagnosticsOptions extends BuildSmokePlanOptions {
  dryRun?: boolean;
  env?: SmokeEnvironment;
  runExternal?: boolean;
  requireExternal?: boolean;
  commandExists?: (command: string) => boolean;
  runCommand?: (command: readonly string[], options: { cwd: string; env?: SmokeEnvironment }) => SmokeCommandResult;
}

const DEFAULT_OPTIONS: SmokeDiagnosticsCliOptions = {
  profile: "local",
  dryRun: false,
  json: false,
  runExternal: false,
  requireExternal: false,
  help: false,
};

const MAX_CAPTURED_OUTPUT_LENGTH = 4000;

export function parseSmokeDiagnosticsArgs(argv: readonly string[]): SmokeDiagnosticsCliOptions {
  const options: SmokeDiagnosticsCliOptions = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--run-external") {
      options.runExternal = true;
      continue;
    }
    if (arg === "--require-external") {
      options.requireExternal = true;
      continue;
    }
    if (arg === "--profile") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --profile");
      options.profile = parseSmokeProfile(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = parseSmokeProfile(arg.slice("--profile=".length));
      continue;
    }
    throw new Error(`Unknown smoke diagnostics option: ${arg}`);
  }

  return options;
}

export function buildSmokePlan(options: BuildSmokePlanOptions = {}): SmokePlan {
  const cwd = resolve(options.cwd ?? process.cwd());
  const profile = options.profile ?? "local";
  const entrypoint = resolveSobaEntrypoint({
    arch: options.arch,
    cwd,
    platform: options.platform,
  });
  const steps: SmokePlanStep[] = [];

  if (profile === "local" || profile === "all") {
    const localCliCommand = resolveLocalCliCommand(cwd);
    steps.push(
      {
        id: "agent-loop-eval-seed",
        title: "Agent Loop eval seed suite",
        command: ["bun", "test", "tests/evals/agent-loop"],
        required: true,
        external: false,
      },
      {
        id: "skill-eval-seed",
        title: "Bundled skills eval seed suite",
        command: ["bun", "test", "tests/evals/skills"],
        required: true,
        external: false,
      },
      {
        id: "cli-one-shot-help",
        title: "SOBA one-shot CLI help path",
        command: [...localCliCommand, "--help"],
        required: true,
        external: false,
      },
    );
  }

  if (profile === "terminal-bench" || profile === "all") {
    steps.push(
      {
        id: "terminal-bench-entrypoint",
        title: "Resolve SOBA Terminal-Bench entrypoint",
        command: entrypoint.command,
        required: true,
        external: false,
        metadataOnly: true,
      },
      {
        id: "harbor-cli",
        title: "Harbor CLI availability",
        command: ["harbor", "--help"],
        required: false,
        external: true,
        prerequisite: "harbor",
      },
      {
        id: "terminal-bench-oracle-smoke",
        title: "Terminal-Bench 2.0 oracle one-task smoke",
        command: ["harbor", "run", "-d", "terminal-bench/terminal-bench-2", "-a", "oracle", "-l", "1"],
        required: false,
        external: true,
        prerequisite: "harbor",
        requiresRunExternal: true,
      },
    );
  }

  return {
    profile,
    cwd,
    entrypoint,
    steps,
  };
}

export function resolveSobaEntrypoint(options: BuildSmokePlanOptions = {}): SobaEntrypoint {
  const cwd = resolve(options.cwd ?? process.cwd());
  const binary = findLatestVersionedBinary(join(cwd, "dist", "bin"), "soba-linux-x64-v");
  if (binary) {
    return {
      mode: "linux-x64-binary",
      command: [binary],
      description: "Linux x64 standalone binary for Harbor/Terminal-Bench containers.",
    };
  }

  const distCli = join(cwd, "dist", "cli.js");
  if (existsSync(distCli)) {
    return {
      mode: "bun-dist",
      command: ["bun", distCli],
      description: "Bun fallback using the built dist/cli.js entrypoint.",
    };
  }

  return {
    mode: "bun-source",
    command: ["bun", join(cwd, "src", "cli.ts")],
    description: "Bun fallback using the source CLI entrypoint.",
  };
}

export function runSmokeDiagnostics(options: RunSmokeDiagnosticsOptions = {}): SmokeRunResult {
  const plan = buildSmokePlan(options);
  const dryRun = options.dryRun ?? false;
  const runExternal = options.runExternal ?? false;
  const requireExternal = options.requireExternal ?? false;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const steps: SmokeStepResult[] = [];

  for (const step of plan.steps) {
    if (dryRun) {
      steps.push({ ...step, status: "planned", reason: "dry run" });
      continue;
    }

    if (step.metadataOnly) {
      steps.push({
        ...step,
        status: "passed",
        reason: plan.entrypoint.description,
      });
      continue;
    }

    if (step.prerequisite && !commandExists(step.prerequisite)) {
      steps.push({
        ...step,
        status: requireExternal ? "failed" : "skipped",
        reason: `${step.prerequisite} is not available on PATH`,
      });
      continue;
    }

    if (step.requiresRunExternal && !runExternal) {
      steps.push({
        ...step,
        status: requireExternal ? "failed" : "skipped",
        reason: "pass --run-external to run Docker/Harbor workload",
      });
      continue;
    }

    const startedAt = Date.now();
    const result = runCommand(step.command, { cwd: plan.cwd, env: options.env });
    const durationMs = Date.now() - startedAt;
    steps.push({
      ...step,
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      durationMs,
      stdout: truncateCapturedOutput(result.stdout),
      stderr: truncateCapturedOutput(result.stderr),
    });
  }

  const exitCode = steps.some((step) => step.status === "failed") ? 1 : 0;
  return {
    profile: plan.profile,
    cwd: plan.cwd,
    entrypoint: plan.entrypoint,
    steps,
    exitCode,
  };
}

export function formatSmokeRunResult(result: SmokeRunResult): string {
  const lines = [
    "SOBA smoke diagnostics",
    `Profile: ${result.profile}`,
    `Entrypoint: ${formatCommand(result.entrypoint.command)} (${result.entrypoint.mode})`,
    "",
  ];

  for (const step of result.steps) {
    const suffix = step.reason ? ` - ${step.reason}` : "";
    const duration = typeof step.durationMs === "number" ? ` (${step.durationMs}ms)` : "";
    lines.push(`[${step.status}] ${step.id}: ${formatCommand(step.command)}${duration}${suffix}`);
  }

  lines.push("", `Result: ${result.exitCode === 0 ? "pass" : "fail"}`);
  return lines.join("\n");
}

export function printSmokeDiagnosticsHelp(): string {
  return [
    "Usage: bun run scripts/smoke-diagnostics.ts [options]",
    "",
    "Options:",
    "  --profile local|terminal-bench|all  Smoke profile to run. Default: local.",
    "  --dry-run                           Print planned commands without running them.",
    "  --json                              Emit machine-readable JSON.",
    "  --run-external                      Allow Docker/Harbor workload execution.",
    "  --require-external                  Fail when optional external smoke steps are unavailable or skipped.",
    "  --help, -h                          Show this help.",
    "",
    "Package shortcuts:",
    "  bun run smoke:diagnostics",
    "  bun run smoke:terminal-bench -- --dry-run",
    "  bun run smoke:terminal-bench -- --run-external",
  ].join("\n");
}

function resolveLocalCliCommand(cwd: string): string[] {
  const distCli = join(cwd, "dist", "cli.js");
  if (existsSync(distCli)) return ["bun", distCli];
  return ["bun", join(cwd, "src", "cli.ts")];
}

function parseSmokeProfile(value: string): SmokeProfile {
  if (value === "local" || value === "terminal-bench" || value === "all") return value;
  throw new Error(`Unsupported smoke diagnostics profile: ${value}`);
}

function findLatestVersionedBinary(directory: string, prefix: string): string | undefined {
  if (!existsSync(directory)) return undefined;

  const candidates = readdirSync(directory)
    .filter((entry) => entry.startsWith(prefix))
    .sort((left, right) => left.localeCompare(right));

  const latest = candidates.at(-1);
  return latest ? join(directory, latest) : undefined;
}

function defaultCommandExists(command: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["sh", "-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`],
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

function defaultRunCommand(
  command: readonly string[],
  options: { cwd: string; env?: SmokeEnvironment },
): SmokeCommandResult {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: decodeOutput(result.stdout),
    stderr: decodeOutput(result.stderr),
  };
}

function decodeOutput(output: string | ArrayBuffer | Uint8Array | undefined): string | undefined {
  if (!output) return undefined;
  if (typeof output === "string") return output;
  if (output instanceof ArrayBuffer) return Buffer.from(new Uint8Array(output)).toString("utf-8");
  return Buffer.from(output).toString("utf-8");
}

function truncateCapturedOutput(output: string | undefined): string | undefined {
  if (!output) return undefined;
  if (output.length <= MAX_CAPTURED_OUTPUT_LENGTH) return output;
  return `${output.slice(0, MAX_CAPTURED_OUTPUT_LENGTH)}\n[truncated]`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command: readonly string[]): string {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function main(): void {
  try {
    const options = parseSmokeDiagnosticsArgs(process.argv.slice(2));
    if (options.help) {
      console.log(printSmokeDiagnosticsHelp());
      process.exit(0);
    }

    const result = runSmokeDiagnostics({
      dryRun: options.dryRun,
      profile: options.profile,
      requireExternal: options.requireExternal,
      runExternal: options.runExternal,
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatSmokeRunResult(result));
    process.exit(result.exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
