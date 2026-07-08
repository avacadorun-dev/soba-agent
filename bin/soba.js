#!/usr/bin/env node
import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binPath = realpathSync(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(binPath));
const bundledBun = join(packageRoot, "node_modules", "bun", "bin", "bun.exe");
const hoistedBun = join(packageRoot, "..", "bun", "bin", "bun.exe");
const bunExecutable = process.env.SOBA_BUN_PATH || firstExistingExecutable([bundledBun, hoistedBun]) || "bun";
const cliEntry = join(packageRoot, "dist", "cli.js");

const child = spawn(bunExecutable, [cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    SOBA_PACKAGE_ROOT: process.env.SOBA_PACKAGE_ROOT ?? packageRoot,
    SOBA_BUNDLED_SKILLS_PATH: process.env.SOBA_BUNDLED_SKILLS_PATH ?? join(packageRoot, "skills"),
  },
});

child.on("error", (error) => {
  if (error && "code" in error && error.code === "ENOENT") {
    console.error("SOBA Agent requires the Bun runtime.");
    console.error("Install Bun from https://bun.sh, or reinstall SOBA with npm so the bundled bun dependency is present.");
    process.exit(127);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function firstExistingExecutable(paths) {
  return paths.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
