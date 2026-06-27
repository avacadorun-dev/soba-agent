import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../../../src/core/session/session-manager";

describe("Session flight records", () => {
  test("persists redacted sidecar artifacts outside the conversation tree", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-flight-record-"));
    const session = SessionManager.create("/repo", tmpDir);
    const itemId = session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });

    session.appendFlightRecord({
      version: 1,
      kind: "tool_call",
      turn: 1,
      payload: {
        toolName: "bash",
        apiKey: "sk-secret",
        nested: { token: "secret-token", visible: "ok" },
      },
    });

    expect(session.getBranch().map((entry) => entry.id)).toEqual([itemId]);
    expect(session.getFlightRecords()).toHaveLength(1);
    expect(JSON.stringify(session.getFlightRecords())).not.toContain("sk-secret");
    expect(JSON.stringify(session.getFlightRecords())).not.toContain("secret-token");
    expect(session.getFlightRecords()[0]?.data.payload).toEqual({
      toolName: "bash",
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]", visible: "ok" },
    });

    const reopened = SessionManager.open(session.getSessionFile()!, tmpDir);
    expect(reopened.getBranch().map((entry) => entry.id)).toEqual([itemId]);
    expect(reopened.getFlightRecords()).toHaveLength(1);
  });
});
