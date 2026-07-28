import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sealProofBundle } from "../../../src/application/evidence/public";

const CLI_PATH = resolve("src/cli.ts");
const DIGEST = `sha256:${"a".repeat(64)}`;

describe("soba prove CLI", () => {
  test("renders latest proof without loading provider configuration", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-prove-cli-"));
    try {
      const evidenceDir = join(cwd, ".soba", "evidence");
      mkdirSync(evidenceDir, { recursive: true });
      const proofPath = join(evidenceDir, "proof.soba-proof.json");
      writeFileSync(
        proofPath,
        JSON.stringify(sealProofBundle({
          version: 1,
          sessionId: "sess_cli",
          turnId: "turn_1",
          status: "verified",
          summary: "CLI proof rendered.",
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
              claim: "CLI proof rendered",
              status: "supported",
              evidenceIds: ["ev_verification_cli"],
            },
          ],
          changedFiles: [],
          commands: [{
            id: "cmd_1",
            command: "bun test",
            status: "passed",
            exitCode: 0,
            outputDigest: DIGEST,
          }],
          checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
          approvals: [],
          risks: [],
          reviewActions: [],
          createdAt: "2026-06-30T10:20:30.000Z",
        })),
        "utf-8",
      );

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "prove", proofPath, "--format", "markdown"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("# SOBA Proof · Verified");
      expect(stdout).toContain("CLI proof rendered.");
      expect(stdout).toContain("✓ 1. CLI proof rendered · supported");
      expect(stdout).not.toContain("ev_verification_cli");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("returns non-zero when no proof files exist", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-prove-cli-empty-"));
    try {
      const missingProofPath = join(cwd, ".soba", "evidence", "missing.soba-proof.json");
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "prove", missingProofPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("Proof error:");
      expect(stderr).toContain("missing.soba-proof.json");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
