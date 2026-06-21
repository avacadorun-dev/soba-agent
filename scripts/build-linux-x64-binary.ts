import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "soba-linux-x64-build-"));
const workspaceDir = join(tempRoot, "workspace");
const outputDir = join(repoRoot, "dist", "bin");
const image = process.env.SOBA_LINUX_BUILDER_IMAGE ?? `oven/bun:${Bun.version}`;
const excludedTopLevel = new Set([".git", "dist", "node_modules"]);

function assertDockerReady(): void {
  const result = Bun.spawnSync({
    cmd: ["docker", "info"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode === 0) return;

  const stderr = Buffer.from(result.stderr).toString().trim();
  console.error("Docker is required for Linux x64 binary builds from macOS. Start Docker Desktop and retry.");
  if (stderr) {
    console.error(stderr);
  }
  process.exit(result.exitCode ?? 1);
}

function copyWorkspace(): void {
  cpSync(repoRoot, workspaceDir, {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const rel = relative(repoRoot, source);
      if (!rel) return true;
      const topLevel = rel.split(sep)[0];
      return !excludedTopLevel.has(topLevel);
    },
  });
}

function runDockerBuild(): number {
  mkdirSync(outputDir, { recursive: true });

  const shellScript = [
    "set -e",
    "mkdir -p /tmp/workspace",
    "cp -a /source/. /tmp/workspace/",
    "cd /tmp/workspace",
    "bun install --frozen-lockfile",
    "bun run scripts/build-binary.ts bun-linux-x64",
    "cp dist/bin/soba-linux-x64-v* /out/",
  ].join(" && ");

  const result = Bun.spawnSync({
    cmd: [
      "docker",
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "-v",
      `${workspaceDir}:/source:ro`,
      "-v",
      `${outputDir}:/out`,
      "-w",
      "/tmp",
      image,
      "sh",
      "-lc",
      shellScript,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  return result.exitCode ?? 1;
}

try {
  if (!existsSync("bun.lock")) {
    console.error("bun.lock is required for reproducible Linux x64 binary builds.");
    process.exit(1);
  }

  assertDockerReady();
  copyWorkspace();
  const exitCode = runDockerBuild();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
  console.log(`Linux x64 binary copied to ${outputDir}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
