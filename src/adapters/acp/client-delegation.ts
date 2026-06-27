import { Buffer } from "node:buffer";
import { isAbsolute, resolve } from "node:path";
import type { RuntimeToolDelegation } from "../../application/tool-delegation";
import {
  type AcpClientCapabilities,
  EMPTY_ACP_CLIENT_CAPABILITIES,
  hasTerminalDelegation,
  parseAcpClientCapabilities,
} from "./client-capabilities";
import type { JsonValue } from "./json-rpc";

export type AcpClientRequester = (method: string, params: JsonValue) => JsonValue | Promise<JsonValue>;

export class AcpClientToolDelegation implements RuntimeToolDelegation {
  private capabilities: AcpClientCapabilities = EMPTY_ACP_CLIENT_CAPABILITIES;
  private readonly getRequestClient: () => AcpClientRequester | undefined;

  constructor(getRequestClient: () => AcpClientRequester | undefined) {
    this.getRequestClient = getRequestClient;
  }

  updateCapabilities(value: JsonValue | undefined): void {
    this.capabilities = parseAcpClientCapabilities(value);
  }

  async readTextFile(input: { cwd: string; path: string; sessionId?: string }): Promise<string | undefined> {
    if (!this.capabilities.fsReadTextFile) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/read_text_file", {
      sessionId: requiredSessionId(input.sessionId),
      path: absolutePath(input.cwd, input.path),
    });
    return textFromResponse(response);
  }

  async writeTextFile(input: { cwd: string; path: string; content: string; sessionId?: string }): Promise<{ bytes?: number; lines?: number } | undefined> {
    if (!this.capabilities.fsWriteTextFile) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/write_text_file", {
      sessionId: requiredSessionId(input.sessionId),
      path: absolutePath(input.cwd, input.path),
      content: input.content,
    });
    return writeResultFromResponse(response, input.content);
  }

  async listDirectory(input: { cwd: string; path?: string; limit?: number; sessionId?: string }) {
    if (!this.capabilities.fsListDirectory) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/list_directory", jsonObject({
      sessionId: requiredSessionId(input.sessionId),
      path: absolutePath(input.cwd, input.path ?? "."),
      limit: input.limit,
    }));
    return listResultFromResponse(response);
  }

  async inspectTextFile(input: {
    cwd: string;
    path: string;
    startLine?: number;
    endLine?: number;
    aroundLine?: number;
    contextLines?: number;
    maxLines?: number;
    sessionId?: string;
  }) {
    if (!this.capabilities.fsInspectTextFile) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/inspect_text_file", jsonObject({
      sessionId: requiredSessionId(input.sessionId),
      path: absolutePath(input.cwd, input.path),
      startLine: input.startLine,
      endLine: input.endLine,
      aroundLine: input.aroundLine,
      contextLines: input.contextLines,
      maxLines: input.maxLines,
    }));
    return inspectResultFromResponse(response);
  }

  async searchFiles(input: {
    cwd: string;
    query: string;
    path?: string;
    glob?: string;
    caseSensitive?: boolean;
    maxMatches?: number;
    sessionId?: string;
  }) {
    if (!this.capabilities.fsSearchFiles) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/search_files", jsonObject({
      sessionId: requiredSessionId(input.sessionId),
      path: absolutePath(input.cwd, input.path ?? "."),
      query: input.query,
      glob: input.glob,
      caseSensitive: input.caseSensitive,
      maxMatches: input.maxMatches,
    }));
    return searchResultFromResponse(response);
  }

  async runTerminal(input: { cwd: string; command: string; timeout?: number; signal?: AbortSignal; sessionId?: string }) {
    if (!hasTerminalDelegation(this.capabilities)) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const sessionId = requiredSessionId(input.sessionId);

    const createResponse = await requestClient("terminal/create", {
      sessionId,
      cwd: input.cwd,
      command: input.command,
    });
    const terminalId = terminalIdFromResponse(createResponse);
    let killed = false;
    const killOnAbort = () => {
      killed = true;
      void requestClient("terminal/kill", { sessionId, terminalId });
    };
    input.signal?.addEventListener("abort", killOnAbort, { once: true });

    try {
      const firstOutput = await requestClient("terminal/output", { sessionId, terminalId });
      const exit = await requestClient("terminal/wait_for_exit", {
        sessionId,
        terminalId,
      });
      const finalOutput = await requestClient("terminal/output", { sessionId, terminalId });
      return {
        terminalId,
        output: [textFromResponse(firstOutput), textFromResponse(finalOutput)].filter(Boolean).join(""),
        exitCode: exitCodeFromResponse(exit),
        signalCode: killed ? "SIGTERM" : null,
        timedOut: timedOutFromResponse(exit),
      };
    } finally {
      input.signal?.removeEventListener("abort", killOnAbort);
      await requestClient("terminal/release", { sessionId, terminalId });
    }
  }
}

function absolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function requiredSessionId(sessionId: string | undefined): string {
  if (!sessionId) throw new Error("ACP client delegation requires a sessionId.");
  return sessionId;
}

function jsonObject(fields: Record<string, JsonValue | undefined>): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function textFromResponse(value: JsonValue): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of ["text", "content", "output", "stdout"]) {
    const field = value[key];
    if (typeof field === "string") return field;
  }
  return undefined;
}

function writeResultFromResponse(value: JsonValue, content: string): { bytes?: number; lines?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      bytes: Buffer.byteLength(content, "utf-8"),
      lines: content.split("\n").length,
    };
  }
  return {
    bytes: typeof value.bytes === "number" ? value.bytes : undefined,
    lines: typeof value.lines === "number" ? value.lines : undefined,
  };
}

function listResultFromResponse(value: JsonValue): string | { text?: string; entries?: string[]; entryCount?: number; truncated?: boolean } | undefined {
  const text = textFromResponse(value);
  if (text !== undefined) return text;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Array.isArray(value.entries)
    ? value.entries.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    entries,
    entryCount: typeof value.entryCount === "number" ? value.entryCount : entries?.length,
    truncated: value.truncated === true,
  };
}

function inspectResultFromResponse(value: JsonValue): string | { text: string; totalLines?: number; startLine?: number; endLine?: number; truncated?: boolean } | undefined {
  const text = textFromResponse(value);
  if (text === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return text;
  return {
    text,
    totalLines: typeof value.totalLines === "number" ? value.totalLines : undefined,
    startLine: typeof value.startLine === "number" ? value.startLine : undefined,
    endLine: typeof value.endLine === "number" ? value.endLine : undefined,
    truncated: value.truncated === true,
  };
}

function searchResultFromResponse(value: JsonValue): string | { text: string; matchCount?: number; truncated?: boolean } | undefined {
  const text = textFromResponse(value);
  if (text === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return text;
  return {
    text,
    matchCount: typeof value.matchCount === "number" ? value.matchCount : undefined,
    truncated: value.truncated === true,
  };
}

function terminalIdFromResponse(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "terminal";
  for (const key of ["terminalId", "id"]) {
    const field = value[key];
    if (typeof field === "string") return field;
  }
  return "terminal";
}

function exitCodeFromResponse(value: JsonValue): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return typeof value.exitCode === "number" ? value.exitCode : 0;
}

function timedOutFromResponse(value: JsonValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.timedOut === true;
}
