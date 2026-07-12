import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { SkillDiscovery } from "../../application/cli/public";
import {
  computeSkillContentHashOnDisk,
  createFilesystemProjectTrustStore,
  FilesystemSkillValidationFilesystem,
  getMcpConfigPath,
  loadMcpConfig,
  McpSecretStore,
  resolveBundledSkillsPath,
  validateSkillOnDisk,
} from "../../composition/cli/public";
import { firstTimeSetup, loadConfig, validateConfig } from "../../composition/config/config-loader";
import type { I18n } from "../../shared/i18n/i18n";

export interface InitCommandOptions {
  yes: boolean;
  check: boolean;
  skipProvider: boolean;
  skipTrust: boolean;
  skipMcp: boolean;
  help: boolean;
}

export interface RunInitCommandOptions extends InitCommandOptions {
  cwd?: string;
  sobaDir?: string;
  configPath?: string;
  ask?: (prompt: string) => Promise<string>;
}

export interface InitCommandResult {
  stdout: string[];
  stderr: string[];
  exitCode: number;
}

export function parseInitCommandArgs(argv: string[]): InitCommandOptions {
  const options: InitCommandOptions = {
    yes: false,
    check: false,
    skipProvider: false,
    skipTrust: false,
    skipMcp: false,
    help: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case "-y":
      case "--yes":
        options.yes = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--skip-provider":
        options.skipProvider = true;
        break;
      case "--skip-trust":
        options.skipTrust = true;
        break;
      case "--skip-mcp":
        options.skipMcp = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown init flag: ${arg}`);
    }
  }

  return options;
}

export async function runInitCommand(options: RunInitCommandOptions, i18n: I18n): Promise<InitCommandResult> {
  if (options.help) {
    return {
      stdout: [initHelp()],
      stderr: [],
      exitCode: 0,
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const sobaDir = options.sobaDir ?? join(homedir(), ".soba");
  const stdout = ["SOBA init"];
  const stderr: string[] = [];
  let exitCode = 0;

  const provider = await setupProvider(options, i18n);
  stdout.push(provider.message);
  if (!provider.ok) exitCode = 1;

  if (!options.skipTrust) {
    const trust = await setupProjectTrust({ ...options, cwd, sobaDir });
    stdout.push(trust);
  } else {
    stdout.push("Project trust: skipped");
  }

  if (!options.skipMcp) {
    stdout.push(await inspectMcpConfig({ ...options, cwd, sobaDir }));
  } else {
    stdout.push("MCP: skipped");
  }

  stdout.push("First task: soba \"Summarize this project and suggest the next safe task\"");

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function setupProvider(
  options: RunInitCommandOptions,
  i18n: I18n,
): Promise<{ ok: boolean; message: string }> {
  if (options.skipProvider) {
    return { ok: true, message: "Provider: skipped" };
  }

  const config = await loadConfig({}, { configPath: options.configPath });
  const missing = validateConfig(config);
  if (missing.length === 0) {
    const provider = config.registry?.defaultProvider ? `${config.registry.defaultProvider}/${config.registry.defaultModel}` : config.model;
    return { ok: true, message: `Provider: ready (${provider || "configured"})` };
  }

  if (options.check) {
    return {
      ok: false,
      message: `Provider: needs setup (${missing.join(", ")})`,
    };
  }

  if (options.yes) {
    return {
      ok: false,
      message: `Provider: needs interactive setup (${missing.join(", ")}). Run soba init without --yes or provide env/config first.`,
    };
  }

  const updated = await firstTimeSetup(config, i18n);
  const updatedMissing = validateConfig(updated);
  return updatedMissing.length === 0
    ? { ok: true, message: `Provider: configured (${updated.model || "model selected"})` }
    : { ok: false, message: `Provider: still missing ${updatedMissing.join(", ")}` };
}

async function setupProjectTrust(options: RunInitCommandOptions & { cwd: string; sobaDir: string }): Promise<string> {
  const trustStore = createFilesystemProjectTrustStore({ sobaDir: options.sobaDir });
  const identity = trustStore.computeProjectIdentity(options.cwd);
  const discovery = new SkillDiscovery({
    projectPath: options.cwd,
    userSkillsPath: join(options.sobaDir, "skills"),
    bundledSkillsPath: resolveBundledSkillsPath({ sobaDir: options.sobaDir }),
    trustStore,
    files: new FilesystemSkillValidationFilesystem(),
    validateSkill: validateSkillOnDisk,
    computeSkillContentHash: computeSkillContentHashOnDisk,
  });
  const fingerprint = discovery.computeFingerprint(identity.canonicalRoot);
  const isTrusted = trustStore.isTrusted(identity);

  if (options.check) {
    return `Project trust: ${isTrusted ? "trusted" : "not trusted"} (${identity.canonicalRoot})`;
  }

  if (!options.yes && !isTrusted) {
    const answer = (await askUser(options.ask, `Trust project-local skills for ${identity.canonicalRoot}? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      return "Project trust: skipped";
    }
  }

  if (isTrusted) {
    trustStore.updateFingerprint(identity, fingerprint);
    return `Project trust: refreshed (${identity.canonicalRoot})`;
  }

  trustStore.approve(identity, fingerprint);
  return `Project trust: approved (${identity.canonicalRoot})`;
}

async function inspectMcpConfig(options: RunInitCommandOptions & { cwd: string; sobaDir: string }): Promise<string> {
  const canonicalPath = getMcpConfigPath(options.cwd);
  const candidates = [
    canonicalPath,
    join(options.cwd, ".mcp.json"),
    join(options.cwd, "mcp.json"),
    join(options.cwd, ".cursor", "mcp.json"),
    join(options.cwd, ".vscode", "mcp.json"),
  ];
  const detected = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate));

  if (!existsSync(canonicalPath)) {
    if (detected.length === 0) {
      return "MCP: no project config detected";
    }

    if (options.check) {
      return `MCP: found non-canonical config (${detected.join(", ")}); use ${canonicalPath} for Soba`;
    }

    const source = detected[0]!;
    if (!options.yes) {
      const answer = (await askUser(options.ask, `Copy MCP config from ${source} to ${canonicalPath}? [y/N] `)).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        return `MCP: found non-canonical config (${source}); skipped`;
      }
    }

    mkdirSync(dirname(canonicalPath), { recursive: true });
    await Bun.write(canonicalPath, await Bun.file(source).text());
  }

  try {
    const secretStore = new McpSecretStore({ homeDir: homeDirFromSobaDir(options.sobaDir) });
    const env = await secretStore.env();
    const config = await loadMcpConfig({ projectRoot: options.cwd, env, allowMissingEnv: true });
    const servers = config?.servers ?? [];
    return `MCP: ready (${servers.length} server${servers.length === 1 ? "" : "s"}; run /mcp status or /mcp reload in-session)`;
  } catch (error) {
    return `MCP: config found but invalid (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function askUser(ask: ((prompt: string) => Promise<string>) | undefined, prompt: string): Promise<string> {
  if (ask) {
    return ask(prompt);
  }
  if (!process.stdin.isTTY) {
    return "";
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    readline.question(prompt, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

function homeDirFromSobaDir(sobaDir: string): string {
  return basename(sobaDir) === ".soba" ? dirname(sobaDir) : homedir();
}

function initHelp(): string {
  return [
    "Usage: soba init [--check] [--yes] [--skip-provider] [--skip-trust] [--skip-mcp]",
    "",
    "Checks or prepares provider config, project trust, MCP config visibility, and a first task suggestion.",
  ].join("\n");
}
