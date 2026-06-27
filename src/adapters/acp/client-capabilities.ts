import type { JsonValue } from "./json-rpc";

export interface AcpClientCapabilities {
  requestPermission: boolean;
  fsReadTextFile: boolean;
  fsWriteTextFile: boolean;
  fsListDirectory: boolean;
  fsInspectTextFile: boolean;
  fsSearchFiles: boolean;
  terminalCreate: boolean;
  terminalOutput: boolean;
  terminalWaitForExit: boolean;
  terminalKill: boolean;
  terminalRelease: boolean;
}

export const EMPTY_ACP_CLIENT_CAPABILITIES: AcpClientCapabilities = {
  requestPermission: false,
  fsReadTextFile: false,
  fsWriteTextFile: false,
  fsListDirectory: false,
  fsInspectTextFile: false,
  fsSearchFiles: false,
  terminalCreate: false,
  terminalOutput: false,
  terminalWaitForExit: false,
  terminalKill: false,
  terminalRelease: false,
};

const METHOD_CAPABILITIES: Array<[keyof AcpClientCapabilities, string]> = [
  ["requestPermission", "session/request_permission"],
  ["fsReadTextFile", "fs/read_text_file"],
  ["fsWriteTextFile", "fs/write_text_file"],
  ["fsListDirectory", "fs/list_directory"],
  ["fsInspectTextFile", "fs/inspect_text_file"],
  ["fsSearchFiles", "fs/search_files"],
  ["terminalCreate", "terminal/create"],
  ["terminalOutput", "terminal/output"],
  ["terminalWaitForExit", "terminal/wait_for_exit"],
  ["terminalKill", "terminal/kill"],
  ["terminalRelease", "terminal/release"],
];

export function parseAcpClientCapabilities(value: JsonValue | undefined): AcpClientCapabilities {
  const parsed = Object.fromEntries(
    METHOD_CAPABILITIES.map(([key, method]) => [key, hasClientCapability(value, method)]),
  ) as unknown as AcpClientCapabilities;

  parsed.requestPermission = true;
  if (hasSpecTerminalCapability(value)) {
    parsed.terminalCreate = true;
    parsed.terminalOutput = true;
    parsed.terminalWaitForExit = true;
    parsed.terminalKill = true;
    parsed.terminalRelease = true;
  }
  return parsed;
}

export function hasTerminalDelegation(capabilities: AcpClientCapabilities): boolean {
  return capabilities.terminalCreate
    && capabilities.terminalOutput
    && capabilities.terminalWaitForExit
    && capabilities.terminalKill
    && capabilities.terminalRelease;
}

function hasClientCapability(value: JsonValue | undefined, method: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (method === "fs/read_text_file" && isRecord(value.fs) && value.fs.readTextFile === true) return true;
  if (method === "fs/write_text_file" && isRecord(value.fs) && value.fs.writeTextFile === true) return true;
  if (method === "fs/list_directory" && isRecord(value.fs) && value.fs.listDirectory === true) return true;
  if (method === "fs/inspect_text_file" && isRecord(value.fs) && value.fs.inspectTextFile === true) return true;
  if (method === "fs/search_files" && isRecord(value.fs) && value.fs.searchFiles === true) return true;
  if (value[method] === true) return true;
  if (value[method.replace("/", ".")] === true) return true;

  const methods = value.methods;
  if (Array.isArray(methods) && methods.includes(method)) return true;

  const [group, operation] = method.split("/");
  const groupValue = value[group];
  if (!groupValue || typeof groupValue !== "object" || Array.isArray(groupValue)) return false;

  const camelOperation = operation.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return groupValue[operation] === true
    || groupValue[camelOperation] === true
    || groupValue[method] === true;
}

function hasSpecTerminalCapability(value: JsonValue | undefined): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && value.terminal === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
