import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("soba npm bin wrapper", () => {
  test("uses Bun's hoisted global bun dependency when package managers do not nest dependencies", async () => {
    const root = mkdtempSync(join(tmpdir(), "soba-bin-wrapper-"));
    tempRoots.push(root);

    const globalNodeModules = join(root, "install", "global", "node_modules");
    const packageRoot = join(globalNodeModules, "soba-agent");
    const packageBin = join(packageRoot, "bin");
    const packageDist = join(packageRoot, "dist");
    const hoistedBunBin = join(globalNodeModules, "bun", "bin");
    const binHome = join(root, "bin");
    const capturePath = join(root, "capture.json");

    mkdirSync(packageBin, { recursive: true });
    mkdirSync(packageDist, { recursive: true });
    mkdirSync(hoistedBunBin, { recursive: true });
    mkdirSync(binHome, { recursive: true });

    const wrapperPath = join(packageBin, "soba.js");
    writeFileSync(wrapperPath, readFileSync(join(process.cwd(), "bin", "soba.js"), "utf8"));
    chmodSync(wrapperPath, 0o755);
    symlinkSync(wrapperPath, join(binHome, "soba"));

    const cliEntry = join(packageDist, "cli.js");
    writeFileSync(cliEntry, "// built cli placeholder\n");

    const hoistedBun = join(hoistedBunBin, "bun.exe");
    writeFileSync(
      hoistedBun,
      [
        "#!/bin/sh",
        'printf \'{"argv":["%s","%s"],"packageRoot":"%s","skillsPath":"%s"}\' \\',
        '  "$1" "$2" "$SOBA_PACKAGE_ROOT" "$SOBA_BUNDLED_SKILLS_PATH" > "$SOBATEST_CAPTURE_PATH"',
      ].join("\n"),
    );
    chmodSync(hoistedBun, 0o755);

    const nodePath = Bun.which("node");
    expect(nodePath).toBeTruthy();
    const nodeOnlyPath = dirname(nodePath as string);
    const proc = Bun.spawn([join(binHome, "soba"), "--version"], {
      env: {
        PATH: nodeOnlyPath,
        SOBATEST_CAPTURE_PATH: capturePath,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(code).toBe(0);
    expect(stdout + stderr).not.toContain("SOBA Agent requires the Bun runtime");
    expect(JSON.parse(readFileSync(capturePath, "utf8"))).toEqual({
      argv: [cliEntry, "--version"],
      packageRoot,
      skillsPath: join(packageRoot, "skills"),
    });
  });
});
