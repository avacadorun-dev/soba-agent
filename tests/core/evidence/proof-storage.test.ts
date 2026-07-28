import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofDigest } from "../../../src/application/evidence/public";
import { FilesystemEvidenceProofStorage } from "../../../src/infrastructure/persistence/evidence/proof-storage";

describe("FilesystemEvidenceProofStorage", () => {
  test("writes evidence bundles as soba proof json files", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const bundle = validBundle({
      sessionId: "sess:one",
      turnId: "turn/0",
      summary: "Verified work.",
      createdAt: "2026-06-30T10:20:30.000Z",
    });

    const receipt = storage.saveEvidenceBundle(bundle);
    const proofPath = requireProofPath(receipt.path);

    expect(receipt.saved).toBe(true);
    expect(receipt.validation.outcome).toBe("verified");
    expect(proofPath).toContain(join(projectRoot, ".soba", "evidence"));
    expect(receipt.proofId).toBe(persistedProofId(proofPath));
    expect(proofPath.endsWith(".soba-proof.json")).toBe(true);
    expect(proofPath).not.toContain(":");
    const persisted = JSON.parse(readFileSync(proofPath, "utf-8"));
    expect(persisted).toMatchObject(bundle);
    expect(persisted.runId).toMatch(/^run_[a-f0-9]{24}$/);
    expect(persisted.proofId).toMatch(/^proof_[a-f0-9]{24}$/);
    expect(persisted.integrity).toEqual({ algorithm: "sha256", digest: proofDigest(persisted) });
    expect(statSync(proofPath).mode & 0o777).toBe(0o600);
  });

  test("redacts secrets before persistence and integrity hashing", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-redaction-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });

    const receipt = storage.saveEvidenceBundle(validBundle({
      sessionId: "sess_secret",
      turnId: "turn_1",
      createdAt: "2026-07-12T00:00:00.000Z",
      prompt: "Use api_key=sk-abcdefghijklmnop",
      env: { SOBA_API_KEY: "sk-abcdefghijklmnop", PATH: "/usr/bin" },
      output: "authorization: Bearer sk-abcdefghijklmnop",
      extensions: {
        github: "ghp_abcdefghijklmnopqrstuvwxyz123456",
        aws: "AKIAABCDEFGHIJKLMNOP",
        slack: "xoxb-1234567890-abcdefghijkl",
        jwt: "eyJheader.payload.signature",
        database: "postgres://admin:hunter2@localhost/db",
        pem: "-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----",
      },
    }));
    const proofPath = requireProofPath(receipt.path);

    const raw = readFileSync(proofPath, "utf-8");
    const persisted = JSON.parse(raw);
    expect(raw).not.toContain("sk-abcdefghijklmnop");
    expect(raw).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(raw).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("secret material");
    expect(persisted.prompt).toBe("Use api_key=[REDACTED]");
    expect(persisted.env).toEqual({ SOBA_API_KEY: "[REDACTED]", PATH: "/usr/bin" });
    expect(persisted.integrity.digest).toBe(proofDigest(persisted));
  });

  test("restores owner-only permissions when overwriting an existing receipt", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-mode-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const bundle = validBundle({
      sessionId: "sess_mode",
      turnId: "turn_1",
      createdAt: "2026-07-12T00:00:00.000Z",
    });

    const first = storage.saveEvidenceBundle(bundle);
    const firstPath = requireProofPath(first.path);
    chmodSync(firstPath, 0o644);
    const overwritten = storage.saveEvidenceBundle(bundle);
    const overwrittenPath = requireProofPath(overwritten.path);

    expect(overwrittenPath).toBe(firstPath);
    expect(statSync(overwrittenPath).mode & 0o777).toBe(0o600);
  });

  test("rejects a structurally invalid producer proof before persistence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-invalid-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const receipt = storage.saveEvidenceBundle(validBundle({
      commands: [{ id: "cmd_1", command: "bun test", status: "passed", exitCode: 0 }],
      checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
    }));

    expect(receipt.saved).toBe(false);
    expect(receipt.path).toBeUndefined();
    expect(receipt.validation.valid).toBe(false);
    expect(receipt.validation.reason).toBe("missing_output_digest");
    expect(storage.readLatestEvidenceBundle()).toBeNull();
    expect(existsSync(join(projectRoot, ".soba", "evidence"))).toBe(false);
  });

  test("captures real git operations and line stats for mutated paths", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-git-snapshot-"));
    const sourceDir = join(projectRoot, "src");
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, "app.ts"), "export const value = 1;\n", "utf-8");
    runGit(projectRoot, ["init", "-q"]);
    runGit(projectRoot, ["add", "src/app.ts"]);
    runGit(projectRoot, [
      "-c",
      "user.name=SOBA Test",
      "-c",
      "user.email=soba@example.invalid",
      "commit",
      "-qm",
      "baseline",
    ]);

    writeFileSync(join(sourceDir, "app.ts"), "export const value = 2;\nexport const next = 3;\n", "utf-8");
    writeFileSync(join(sourceDir, "new.ts"), "one\ntwo\n", "utf-8");
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });

    expect(storage.captureEvidenceChangedFiles(["src/app.ts", "src/new.ts"])).toEqual([
      {
        path: "src/app.ts",
        operation: "modified",
        source: "git",
        added: 2,
        removed: 1,
        mutationIds: [],
        remainsChanged: true,
      },
      {
        path: "src/new.ts",
        operation: "created",
        source: "git",
        added: 2,
        removed: 0,
        mutationIds: [],
        remainsChanged: true,
      },
    ]);
  });

  test("reads the latest proof by filesystem mtime", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-latest-"));
    const evidenceDir = join(projectRoot, ".soba", "evidence");
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const oldReceipt = storage.saveEvidenceBundle(validBundle({
      sessionId: "old",
      turnId: "turn_1",
      createdAt: "2026-06-30T10:00:00.000Z",
    }));
    const oldProofPath = requireProofPath(oldReceipt.path);
    const latestPath = join(evidenceDir, "manual-latest.soba-proof.json");
    writeFileSync(latestPath, JSON.stringify({ version: 1, sessionId: "latest", turnId: "turn_2" }), "utf-8");
    const oldTime = new Date("2026-06-30T10:00:00.000Z");
    const latestTime = new Date("2026-06-30T12:00:00.000Z");
    utimesSync(oldProofPath, oldTime, oldTime);
    utimesSync(latestPath, latestTime, latestTime);

    const latest = storage.readLatestEvidenceBundle();

    expect(latest?.path).toBe(latestPath);
    expect(latest?.bundle.sessionId).toBe("latest");
  });
});

function persistedProofId(path: string): string {
  return JSON.parse(readFileSync(path, "utf-8")).proofId as string;
}

function validBundle(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    sessionId: "sess_1",
    turnId: "turn_1",
    status: "verified",
    summary: "Verified work.",
    evidence: [],
    claims: [],
    changedFiles: [],
    commands: [],
    checks: [],
    approvals: [],
    risks: [],
    reviewActions: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function requireProofPath(path: string | undefined): string {
  if (!path) throw new Error("Expected proof to be persisted.");
  return path;
}

function runGit(projectRoot: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: projectRoot, stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
}
