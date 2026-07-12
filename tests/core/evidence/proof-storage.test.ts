import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofDigest } from "../../../src/application/evidence/public";
import { FilesystemEvidenceProofStorage } from "../../../src/infrastructure/persistence/evidence/proof-storage";

describe("FilesystemEvidenceProofStorage", () => {
  test("writes evidence bundles as soba proof json files", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const bundle = {
      version: 1,
      sessionId: "sess:one",
      turnId: "turn/0",
      status: "verified",
      summary: "Verified work.",
      changedFiles: [],
      commands: [],
      checks: [],
      approvals: [],
      risks: [],
      reviewActions: [],
      createdAt: "2026-06-30T10:20:30.000Z",
    };

    const receipt = storage.saveEvidenceBundle(bundle);

    expect(receipt.path).toContain(join(projectRoot, ".soba", "evidence"));
    expect(receipt.proofId).toBe(persistedProofId(receipt.path));
    expect(receipt.path.endsWith(".soba-proof.json")).toBe(true);
    expect(receipt.path).not.toContain(":");
    const persisted = JSON.parse(readFileSync(receipt.path, "utf-8"));
    expect(persisted).toMatchObject(bundle);
    expect(persisted.runId).toMatch(/^run_[a-f0-9]{24}$/);
    expect(persisted.proofId).toMatch(/^proof_[a-f0-9]{24}$/);
    expect(persisted.integrity).toEqual({ algorithm: "sha256", digest: proofDigest(persisted) });
    expect(statSync(receipt.path).mode & 0o777).toBe(0o600);
  });

  test("redacts secrets before persistence and integrity hashing", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-redaction-"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });

    const receipt = storage.saveEvidenceBundle({
      version: 1,
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
    });

    const raw = readFileSync(receipt.path, "utf-8");
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
    const bundle = {
      version: 1,
      sessionId: "sess_mode",
      turnId: "turn_1",
      createdAt: "2026-07-12T00:00:00.000Z",
    };

    const first = storage.saveEvidenceBundle(bundle);
    chmodSync(first.path, 0o644);
    const overwritten = storage.saveEvidenceBundle(bundle);

    expect(overwritten.path).toBe(first.path);
    expect(statSync(overwritten.path).mode & 0o777).toBe(0o600);
  });

  test("reads the latest proof by filesystem mtime", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-proof-latest-"));
    const evidenceDir = join(projectRoot, ".soba", "evidence");
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const oldReceipt = storage.saveEvidenceBundle({
      version: 1,
      sessionId: "old",
      turnId: "turn_1",
      createdAt: "2026-06-30T10:00:00.000Z",
    });
    const latestPath = join(evidenceDir, "manual-latest.soba-proof.json");
    writeFileSync(latestPath, JSON.stringify({ version: 1, sessionId: "latest", turnId: "turn_2" }), "utf-8");
    const oldTime = new Date("2026-06-30T10:00:00.000Z");
    const latestTime = new Date("2026-06-30T12:00:00.000Z");
    utimesSync(oldReceipt.path, oldTime, oldTime);
    utimesSync(latestPath, latestTime, latestTime);

    const latest = storage.readLatestEvidenceBundle();

    expect(latest?.path).toBe(latestPath);
    expect(latest?.bundle.sessionId).toBe("latest");
  });
});

function persistedProofId(path: string): string {
  return JSON.parse(readFileSync(path, "utf-8")).proofId as string;
}
