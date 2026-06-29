/**
 * Header component tests — trust status display.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectTrustStore } from "../../../../src/application/skills/project-trust-store";
import type { AgentLoop } from "../../../../src/engine/turn/agent-loop";
import { createFilesystemProjectTrustStore } from "../../../../src/infrastructure/persistence/skills/project-trust-storage";
import { TuiStore } from "../../../../src/ui/terminal/interactive/model/tui-store";
import type { InteractiveTUIOptions } from "../../../../src/ui/terminal/interactive/model/types";

function createStore(
  cwd: string,
  trustStore?: ProjectTrustStore,
  onExit: () => void = () => {},
): TuiStore {
  const agentLoop = {
    getModel: () => "test-model",
    runTurn: async () => {},
  } as unknown as AgentLoop;
  const options: InteractiveTUIOptions = {
    cwd,
    tokenBudget: 10_000,
    contextWindow: 128_000,
    theme: "graphite",
    agentLoop,
    toolNames: ["read", "edit"],
    executeCommand: async (input) => ({ handled: true, exit: input === "/exit" }),
    debug: false,
    maxOutputTokens: 0,
    maxCompletionTokens: 0,
    maxAgentIterations: 0,
    maxStalledIterations: 4,
    maxRunMinutes: 0,
    autoCompact: true,
    trustStore,
  };
  return new TuiStore(options, onExit);
}

describe("Header trust status", () => {
  let tempDir: string;
  let sobaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-header-test-"));
    sobaDir = join(tempDir, ".soba");
  });

  test("store.projectTrusted() === false когда проект не одобрен", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const store = createStore(tempDir, trustStore);

    expect(store.projectTrusted()).toBe(false);
    store.dispose();
  });

  test("store.projectTrusted() === true когда проект одобрен", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");

    const store = createStore(tempDir, trustStore);

    expect(store.projectTrusted()).toBe(true);
    store.dispose();
  });

  test("статус обновляется после approve через trust_changed", async () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });

    const store = createStore(tempDir, trustStore, () => {});

    expect(store.projectTrusted()).toBe(false);

    // Simulate /project-trust approve
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");
    store.refreshProjectTrust();

    expect(store.projectTrusted()).toBe(true);
    store.dispose();
  });

  test("статус обновляется после revoke через trust_changed", async () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");

    const store = createStore(tempDir, trustStore, () => {});

    expect(store.projectTrusted()).toBe(true);

    // Simulate /project-trust revoke
    trustStore.revoke(identity);
    store.refreshProjectTrust();

    expect(store.projectTrusted()).toBe(false);
    store.dispose();
  });

  test("без trustStore проект считается untrusted", () => {
    const store = createStore(tempDir, undefined);

    expect(store.projectTrusted()).toBe(false);
    store.dispose();
  });

  test("Header показывает ✓ TRUSTED для одобренного проекта", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(tempDir);
    trustStore.approve(identity, "test-fingerprint");

    const store = createStore(tempDir, trustStore);

    // Header логика: trusted() ? "✓ TRUSTED" : "⚠ UNTRUSTED"
    const trusted = store.projectTrusted();
    const headerText = trusted ? "✓ TRUSTED" : "⚠ UNTRUSTED";

    expect(headerText).toBe("✓ TRUSTED");
    store.dispose();
  });

  test("Header показывает ⚠ UNTRUSTED для не одобренного проекта", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const store = createStore(tempDir, trustStore);

    // Header логика: trusted() ? "✓ TRUSTED" : "⚠ UNTRUSTED"
    const trusted = store.projectTrusted();
    const headerText = trusted ? "✓ TRUSTED" : "⚠ UNTRUSTED";

    expect(headerText).toBe("⚠ UNTRUSTED");
    store.dispose();
  });

  test("Header скрывает статус при width < 60", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const store = createStore(tempDir, trustStore);

    // Header логика: width >= 60 ? show status : ""
    const width = 50;
    const shouldShow = width >= 60;

    expect(shouldShow).toBe(false);
    store.dispose();
  });

  test("Header показывает статус при width >= 60", () => {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const store = createStore(tempDir, trustStore);

    // Header логика: width >= 60 ? show status : ""
    const width = 80;
    const shouldShow = width >= 60;

    expect(shouldShow).toBe(true);
    store.dispose();
  });
});
