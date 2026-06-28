import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTrustStore } from "../../../src/application/skills/project-trust-store";
import { parseInitCommandArgs, runInitCommand } from "../../../src/apps/cli/init-command";
import { I18n } from "../../../src/shared/i18n/i18n";

let tempDir: string;
let projectRoot: string;
let sobaDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "soba-init-command-"));
  projectRoot = join(tempDir, "project");
  sobaDir = join(tempDir, ".soba");
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("soba init command", () => {
  test("parseInitCommandArgs recognises check, yes and skip flags", () => {
    expect(parseInitCommandArgs(["--check", "--yes", "--skip-provider", "--skip-trust", "--skip-mcp"])).toEqual({
      yes: true,
      check: true,
      skipProvider: true,
      skipTrust: true,
      skipMcp: true,
      help: false,
    });
  });

  test("--check reports setup state without approving project trust", async () => {
    const result = await runInitCommand(
      {
        ...parseInitCommandArgs(["--check", "--skip-provider", "--skip-mcp"]),
        cwd: projectRoot,
        sobaDir,
      },
      new I18n("en"),
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const identity = ProjectTrustStore.computeProjectIdentity(projectRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("Project trust: not trusted");
    expect(trustStore.isTrusted(identity)).toBe(false);
  });

  test("--yes approves project trust without prompting", async () => {
    const result = await runInitCommand(
      {
        ...parseInitCommandArgs(["--yes", "--skip-provider", "--skip-mcp"]),
        cwd: projectRoot,
        sobaDir,
        ask: async () => {
          throw new Error("ask should not be called with --yes");
        },
      },
      new I18n("en"),
    );

    const trustStore = new ProjectTrustStore({ sobaDir });
    const identity = ProjectTrustStore.computeProjectIdentity(projectRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("Project trust: approved");
    expect(trustStore.isTrusted(identity)).toBe(true);
  });

  test("detects canonical MCP config during init checks", async () => {
    mkdirSync(join(projectRoot, ".soba"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".soba", "mcp.json"),
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "docs",
            transport: "stdio",
            command: "echo",
            args: ["ok"],
          },
        ],
      }),
      "utf-8",
    );

    const result = await runInitCommand(
      {
        ...parseInitCommandArgs(["--check", "--skip-provider", "--skip-trust"]),
        cwd: projectRoot,
        sobaDir,
      },
      new I18n("en"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("MCP: ready (1 server");
  });

  test("--yes copies detected non-canonical MCP config into .soba/mcp.json", async () => {
    writeFileSync(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "docs",
            transport: "stdio",
            command: "echo",
            args: ["ok"],
          },
        ],
      }),
      "utf-8",
    );

    const result = await runInitCommand(
      {
        ...parseInitCommandArgs(["--yes", "--skip-provider", "--skip-trust"]),
        cwd: projectRoot,
        sobaDir,
      },
      new I18n("en"),
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(projectRoot, ".soba", "mcp.json"))).toBe(true);
    expect(result.stdout.join("\n")).toContain("MCP: ready (1 server");
  });

  test("help output is concise and non-interactive", async () => {
    const result = await runInitCommand(
      {
        ...parseInitCommandArgs(["--help"]),
        cwd: projectRoot,
        sobaDir,
      },
      new I18n("en"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toContain("Usage: soba init");
  });
});
