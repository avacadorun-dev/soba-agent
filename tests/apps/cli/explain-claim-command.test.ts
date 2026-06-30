import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = resolve("src/cli.ts");
const DIGEST = `sha256:${"e".repeat(64)}`;

describe("soba explain-claim CLI", () => {
  test("explains a claim without loading provider configuration", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-explain-claim-cli-"));
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
          summary: "CLI claim explained.",
          evidence: [
            {
              id: "ev_verification_cli",
              kind: "verification",
              status: "success",
              summary: "Verification command passed: bun test",
              timestamp: 1,
              command: "bun test",
            },
          ],
          claims: [
            {
              id: "claim_1",
              claim: "CLI claim explained",
              status: "supported",
              evidenceIds: ["ev_verification_cli", "cmd_1"],
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

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "explain-claim", "claim_1", "--proof", proofPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("SOBA Claim Explanation");
      expect(stdout).toContain("Claim: CLI claim explained");
      expect(stdout).toContain("ev_verification_cli: verification success");
      expect(stdout).toContain(`cmd_1: command passed: bun test exit=0 digest=${DIGEST}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
