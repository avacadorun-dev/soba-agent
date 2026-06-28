export const MCP_SESSION_ID_HEADER = "MCP-Session-Id";

export type HttpSessionCaptureResult = "captured" | "absent";

export class McpHttpSessionError extends Error {
  readonly code = "invalid_session_id";

  constructor(message: string) {
    super(message);
    this.name = "McpHttpSessionError";
  }
}

export class McpHttpSession {
  private sessionId: string | null = null;

  get active(): boolean {
    return this.sessionId !== null;
  }

  get redacted(): string | null {
    return this.sessionId === null ? null : "<redacted>";
  }

  capture(headers: Headers): HttpSessionCaptureResult {
    const sessionId = headers.get(MCP_SESSION_ID_HEADER);
    if (sessionId === null) {
      return "absent";
    }

    this.set(sessionId);
    return "captured";
  }

  apply(headers: Headers): void {
    if (this.sessionId !== null) {
      headers.set(MCP_SESSION_ID_HEADER, this.sessionId);
    }
  }

  reset(): void {
    this.sessionId = null;
  }

  private set(sessionId: string): void {
    if (!isVisibleAscii(sessionId)) {
      throw new McpHttpSessionError("MCP HTTP session id must contain visible ASCII characters only.");
    }

    this.sessionId = sessionId;
  }
}

function isVisibleAscii(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      return false;
    }
  }

  return true;
}
