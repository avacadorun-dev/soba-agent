import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLifecycleService } from "../../../src/application/session-lifecycle";
import { type CommandContext, executeCommand } from "../../../src/apps/cli/commands";
import { DEFAULT_CONFIG } from "../../../src/core/config/types";
import { I18n } from "../../../src/core/i18n/i18n";
import { SessionManager } from "../../../src/core/session/session-manager";

let tempHome: string;
let projectRoot: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "soba-sessions-command-home-"));
  projectRoot = join(tempHome, "project");
  mkdirSync(projectRoot, { recursive: true });
  previousHome = process.env.HOME;
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("/sessions command", () => {
  test("list показывает сессии и evidence summary из flight recorder", async () => {
    const service = new SessionLifecycleService(projectRoot);
    const first = service.createSessionManager({ cwd: projectRoot });
    const second = service.createSessionManager({ cwd: projectRoot });
    second.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });
    second.appendFlightRecord({
      version: 1,
      kind: "evidence_bundle",
      payload: { status: "verified" },
    });
    const output: Array<{ type: string; message?: string }> = [];

    await executeCommand("/sessions list", makeContext(first, service, output));

    const message = output[0]?.message ?? "";
    expect(output[0]?.type).toBe("info");
    expect(message).toContain(first.getSessionId().slice(0, 8));
    expect(message).toContain(second.getSessionId().slice(0, 8));
    expect(message).toContain("active");
    expect(message).toContain("evidence=verified");
  });

  test("resume переключает active SessionManager", async () => {
    const service = new SessionLifecycleService(projectRoot);
    const first = service.createSessionManager({ cwd: projectRoot });
    const second = service.createSessionManager({ cwd: projectRoot });
    const output: Array<{ type: string; message?: string }> = [];
    let active = first;
    const context = makeContext(active, service, output, (next) => {
      active = next;
      context.session = next;
    });

    await executeCommand(`/sessions resume ${second.getSessionId().slice(0, 8)}`, context);

    expect(active.getSessionId()).toBe(second.getSessionId());
    expect(output[0]?.message).toContain("Session resumed");
  });

  test("delete удаляет неактивную сессию и блокирует активную", async () => {
    const service = new SessionLifecycleService(projectRoot);
    const first = service.createSessionManager({ cwd: projectRoot });
    const second = service.createSessionManager({ cwd: projectRoot });
    const secondFile = second.getSessionFile();
    const output: Array<{ type: string; message?: string }> = [];
    const context = makeContext(first, service, output);

    await executeCommand(`/sessions delete ${first.getSessionId().slice(0, 8)}`, context);
    await executeCommand(`/sessions delete ${second.getSessionId().slice(0, 8)}`, context);

    expect(output[0]?.type).toBe("error");
    expect(output[0]?.message).toContain("Cannot delete the active session");
    expect(output[1]?.type).toBe("info");
    expect(existsSync(secondFile ?? "")).toBe(false);
  });
});

function makeContext(
  session: SessionManager,
  sessionLifecycle: SessionLifecycleService,
  output: Array<{ type: string; message?: string }>,
  setSession?: (session: SessionManager) => void,
): CommandContext {
  return {
    session,
    sessionLifecycle,
    setSession,
    config: { ...DEFAULT_CONFIG },
    i18n: new I18n("en"),
    renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
  } as unknown as CommandContext;
}
