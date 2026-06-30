import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(receipt.path.endsWith(".soba-proof.json")).toBe(true);
    expect(receipt.path).not.toContain(":");
    const persisted = JSON.parse(readFileSync(receipt.path, "utf-8"));
    expect(persisted).toEqual(bundle);
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
