import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FilesystemEvidenceProofStorage } from "../../../src/infrastructure/persistence/evidence/proof-storage";

const mode = process.argv[2] ?? "baseline";
const gated = mode !== "baseline";
writeFileSync(join(process.cwd(), "src", "math.ts"), "export function add(left: number, right: number): number {\n  return left + right;\n}\n");
if (!gated) process.exit(0);

const test = Bun.spawnSync(["bun", "run", "test"], {
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});
const output = `${test.stdout.toString()}${test.stderr.toString()}`;
const proof = {
  version: 1,
  sessionId: "sess_fake_eval",
  turnId: "turn_1",
  status: mode === "unverified" ? "unverified" : test.exitCode === 0 ? "verified" : "partially_verified",
  summary: "Fixed addition and ran the fixture tests.",
  evidence: [
    {
      id: "ev_mutation_1",
      kind: "mutation",
      status: "success",
      summary: "Changed src/math.ts",
      timestamp: 1,
      toolCallId: "edit_1",
      files: ["src/math.ts"],
    },
    {
      id: "ev_verification_1",
      kind: "verification",
      status: test.exitCode === 0 ? "success" : "failure",
      summary: "Ran fixture acceptance tests",
      timestamp: 2,
      toolCallId: "bash_1",
      command: "bun run test",
      mutationIds: ["ev_mutation_1"],
    },
  ],
  claims: [{ id: "claim_1", claim: "Fixture tests pass", status: "supported", evidenceIds: ["ev_verification_1"] }],
  changedFiles: [{ path: "src/math.ts", operation: "modified", source: "tool_edit", mutationIds: ["ev_mutation_1"] }],
  diff: {
    files: [{
      path: "src/math.ts",
      operation: "modified",
      added: 1,
      removed: 1,
      mutationIds: ["ev_mutation_1"],
      truncated: false,
    }],
    fileCount: 1,
    added: 1,
    removed: 1,
    truncated: false,
  },
  commands: [
    {
      id: "cmd_1",
      command: "bun run test",
      status: test.exitCode === 0 ? "passed" : "failed",
      exitCode: test.exitCode,
      outputDigest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    },
  ],
  checks: [{ id: "check_1", label: "Tests", status: test.exitCode === 0 ? "passed" : "failed", commandId: "cmd_1" }],
  approvals: [],
  risks: [],
  reviewActions: [],
  metrics: { modelCalls: 3, tokens: { input: 100, output: 20, total: 120 } },
  createdAt: "2026-07-12T00:00:00.000Z",
};
new FilesystemEvidenceProofStorage({ projectRoot: process.cwd() }).saveEvidenceBundle(proof);
