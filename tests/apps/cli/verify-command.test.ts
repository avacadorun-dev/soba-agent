import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = resolve("src/cli.ts");
const DIGEST = `sha256:${"b".repeat(64)}`;

describe("soba verify CLI", () => {
  test("verifies a proof without loading provider configuration", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-verify-cli-"));
    try {
      const evidenceDir = join(cwd, ".soba", "evidence");
      mkdirSync(evidenceDir, { recursive: true });
      const proofPath = join(evidenceDir, "proof.soba-proof.json");
      writeFileSync(
        proofPath,
        JSON.stringify({
          version: 1,
          sessionId: "sess_cli",
          turnId: "turn_1",
          status: "verified",
          summary: "CLI proof verified.",
          evidence: [
            {
              id: "ev_verification_cli",
              kind: "verification",
              status: "success",
              summary: "Verification command passed: bun test",
              timestamp: 1,
              toolCallId: "bash_1",
              command: "bun test",
            },
          ],
          claims: [
            {
              id: "claim_1",
              claim: "CLI proof verified",
              status: "supported",
              evidenceIds: ["ev_verification_cli"],
            },
          ],
          changedFiles: [],
          commands: [{ id: "cmd_1", command: "bun test", status: "passed", exitCode: 0, outputDigest: DIGEST }],
          checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
          approvals: [],
          risks: [],
          reviewActions: [],
          createdAt: "2026-06-30T10:20:30.000Z",
        }),
        "utf-8",
      );

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "verify", proofPath, "--format", "markdown"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("# SOBA Proof Verification");
      expect(stdout).toContain("`valid`");
      expect(stdout).toContain("Errors: 0");
      expect(stdout).toContain("Claims: 1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("returns non-zero and stderr for invalid proof", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-verify-cli-invalid-"));
    try {
      const proofPath = join(cwd, "invalid.soba-proof.json");
      writeFileSync(
        proofPath,
        JSON.stringify({
          version: 1,
          sessionId: "sess_cli",
          turnId: "turn_1",
          status: "verified",
          summary: "Invalid CLI proof.",
          evidence: [
            {
              id: "ev_verification_cli",
              kind: "verification",
              status: "success",
              summary: "Verification command passed: bun test",
              timestamp: 1,
              toolCallId: "bash_1",
              command: "bun test",
            },
          ],
          claims: [
            {
              id: "claim_1",
              claim: "Invalid CLI proof",
              status: "supported",
              evidenceIds: ["ev_verification_cli"],
            },
          ],
          changedFiles: [],
          commands: [{ id: "cmd_1", command: "bun test", status: "failed", exitCode: 1, outputDigest: DIGEST }],
          checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
          approvals: [],
          risks: [],
          reviewActions: [],
          createdAt: "2026-06-30T10:20:30.000Z",
        }),
        "utf-8",
      );

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "verify", proofPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("SOBA Proof Verification");
      expect(stderr).toContain("Result: invalid");
      expect(stderr).toContain("passed_check_without_passed_command");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
