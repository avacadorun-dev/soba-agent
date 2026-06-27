import { Buffer } from "node:buffer";
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

  async readTextFile(input: { cwd: string; path: string }): Promise<string | undefined> {
    if (!this.capabilities.fsReadTextFile) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/read_text_file", {
      cwd: input.cwd,
      path: input.path,
    });
    return textFromResponse(response);
  }

  async writeTextFile(input: { cwd: string; path: string; content: string }): Promise<{ bytes?: number; lines?: number } | undefined> {
    if (!this.capabilities.fsWriteTextFile) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;
    const response = await requestClient("fs/write_text_file", {
      cwd: input.cwd,
      path: input.path,
      content: input.content,
    });
    return writeResultFromResponse(response, input.content);
  }

  async runTerminal(input: { cwd: string; command: string; timeout?: number; signal?: AbortSignal }) {
    if (!hasTerminalDelegation(this.capabilities)) return undefined;
    const requestClient = this.getRequestClient();
    if (!requestClient) return undefined;

    const createResponse = await requestClient("terminal/create", {
      cwd: input.cwd,
      command: input.command,
      timeout: input.timeout ?? null,
    });
    const terminalId = terminalIdFromResponse(createResponse);
    let killed = false;
    const killOnAbort = () => {
      killed = true;
      void requestClient("terminal/kill", { terminalId });
    };
    input.signal?.addEventListener("abort", killOnAbort, { once: true });

    try {
      const firstOutput = await requestClient("terminal/output", { terminalId });
      const exit = await requestClient("terminal/wait_for_exit", {
        terminalId,
        timeout: input.timeout ?? null,
      });
      const finalOutput = await requestClient("terminal/output", { terminalId });
      return {
        terminalId,
        output: [textFromResponse(firstOutput), textFromResponse(finalOutput)].filter(Boolean).join(""),
        exitCode: exitCodeFromResponse(exit),
        signalCode: killed ? "SIGTERM" : null,
        timedOut: timedOutFromResponse(exit),
      };
    } finally {
      input.signal?.removeEventListener("abort", killOnAbort);
      await requestClient("terminal/release", { terminalId });
    }
  }
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
