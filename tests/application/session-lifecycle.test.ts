import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentSessionLifecycleService } from "../../src/infrastructure/persistence/sessions/session-lifecycle-service";
import { SessionManager } from "../../src/infrastructure/persistence/sessions/session-manager";

let testHome: string;
let projectRoot: string;
let previousHome: string | undefined;

beforeEach(() => {
  testHome = join(tmpdir(), `soba-session-lifecycle-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  projectRoot = join(tmpdir(), `soba-session-lifecycle-project-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  previousHome = process.env.HOME;
  process.env.HOME = testHome;
});

afterEach(() => {
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("PersistentSessionLifecycleService", () => {
  test("creates, lists, loads, resumes, and deletes project sessions", () => {
    const service = new PersistentSessionLifecycleService(projectRoot);
    const created = service.createSession({ cwd: projectRoot });
    const session = SessionManager.openById(projectRoot, created.id);
    session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });

    const listed = service.listSessions({ cwd: projectRoot });
    expect(listed.map((item) => item.id)).toContain(created.id);

    const loaded = service.loadSession({ sessionId: created.id.slice(0, 8) });
    expect(loaded.info.id).toBe(created.id);
    expect(loaded.entries.length).toBe(1);

    const resumed = service.resumeSession({ sessionId: created.id });
    expect(resumed.cwd).toBe(projectRoot);

    const filePath = session.getSessionFile();
    expect(filePath).toBeDefined();
    service.deleteSession(created.id);
    expect(existsSync(filePath ?? "")).toBe(false);
  });
});
