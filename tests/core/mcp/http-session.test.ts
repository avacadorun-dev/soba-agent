import { describe, expect, test } from "bun:test";
import { MCP_SESSION_ID_HEADER, McpHttpSession, McpHttpSessionError } from "../../../src/core/mcp/http-session";

describe("MCP HTTP session", () => {
  test("captures and applies a visible ASCII session id", () => {
    const session = new McpHttpSession();
    const incoming = new Headers({
      [MCP_SESSION_ID_HEADER]: "session-123_ABC",
    });

    expect(session.capture(incoming)).toBe("captured");
    expect(session.active).toBe(true);
    expect(session.redacted).toBe("<redacted>");

    const outgoing = new Headers();
    session.apply(outgoing);
    expect(outgoing.get(MCP_SESSION_ID_HEADER)).toBe("session-123_ABC");
  });

  test("rejects empty, control, whitespace, and non-ASCII session ids", () => {
    for (const value of ["", "has space", "line\nbreak", "таблица"]) {
      const session = new McpHttpSession();

      expect(() => session.capture(fakeSessionHeaders(value))).toThrow(McpHttpSessionError);
    }
  });

  test("reset clears the active session", () => {
    const session = new McpHttpSession();
    session.capture(new Headers({ [MCP_SESSION_ID_HEADER]: "session-123" }));

    session.reset();

    const outgoing = new Headers();
    session.apply(outgoing);
    expect(session.active).toBe(false);
    expect(session.redacted).toBeNull();
    expect(outgoing.get(MCP_SESSION_ID_HEADER)).toBeNull();
  });
});

function fakeSessionHeaders(value: string): Headers {
  return {
    get: (name: string) => (name.toLowerCase() === MCP_SESSION_ID_HEADER.toLowerCase() ? value : null),
  } as Headers;
}
