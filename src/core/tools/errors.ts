import type { ToolErrorCategory, ToolErrorInfo, ToolResult } from "./types";

export interface ToolErrorInput {
  code: string;
  category: ToolErrorCategory;
  message: string;
  nextAction: string;
  retryable?: boolean;
  fingerprint?: string;
  details?: Record<string, unknown>;
}

export function createToolErrorResult(input: ToolErrorInput): ToolResult {
  const error = createToolErrorInfo(input);
  return {
    content: [
      {
        type: "text",
        text: formatToolError(input.message, error),
      },
    ],
    isError: true,
    error,
    details: input.details,
  };
}

export function createToolErrorInfo(input: Omit<ToolErrorInput, "message" | "details">): ToolErrorInfo {
  return {
    code: input.code,
    category: input.category,
    retryable: input.retryable ?? false,
    nextAction: input.nextAction,
    fingerprint: input.fingerprint ?? `${input.category}:${input.code}`,
  };
}

export function formatToolError(message: string, error: ToolErrorInfo): string {
  const retry = error.retryable ? "yes" : "no";
  return `Error [${error.code}]: ${redactSecrets(message)}\nCategory: ${error.category}. Retryable: ${retry}.\nNext action: ${error.nextAction}`;
}

export function classifyFileSystemError(
  error: unknown,
  operation: "read" | "write" | "edit" | "list",
): Pick<ToolErrorInput, "code" | "category" | "nextAction" | "retryable"> {
  const code = readNodeErrorCode(error);

  if (code === "ENOENT" || code === "ENOTDIR") {
    return {
      code: `${operation}_path_not_found`,
      category: "filesystem",
      retryable: false,
      nextAction: "Inspect the parent path or list nearby files, then retry with the corrected path.",
    };
  }

  if (code === "EACCES" || code === "EPERM") {
    return {
      code: `${operation}_permission_denied`,
      category: "permission",
      retryable: false,
      nextAction: "Use an allowed path or ask the user to adjust permissions before retrying.",
    };
  }

  if (code === "EISDIR") {
    return {
      code: `${operation}_target_is_directory`,
      category: "filesystem",
      retryable: false,
      nextAction: "List the directory and choose a concrete file path.",
    };
  }

  return {
    code: `${operation}_failed`,
    category: "unknown",
    retryable: false,
    nextAction: "Inspect the target and error details, then change the approach before retrying.",
  };
}

export function classifyEditError(error: unknown): Pick<ToolErrorInput, "code" | "category" | "nextAction" | "retryable"> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("oldText not found")) {
    return {
      code: "edit_old_text_not_found",
      category: "validation",
      retryable: false,
      nextAction: "Read the current file content and build a new exact replacement from the latest text.",
    };
  }
  if (message.includes("oldText is not unique")) {
    return {
      code: "edit_old_text_not_unique",
      category: "validation",
      retryable: false,
      nextAction: "Make oldText more specific by including enough surrounding unchanged lines.",
    };
  }
  if (message.includes("overlap")) {
    return {
      code: "edit_overlapping_replacements",
      category: "validation",
      retryable: false,
      nextAction: "Merge overlapping or adjacent replacements into one edit.",
    };
  }
  if (message.includes("oldText cannot be empty") || message.includes("edits must contain")) {
    return {
      code: "edit_invalid_input",
      category: "validation",
      retryable: false,
      nextAction: "Provide at least one edit with a non-empty exact oldText value.",
    };
  }
  return classifyFileSystemError(error, "edit");
}

export function commandErrorInfo(options: {
  exitCode: number | null;
  signalCode?: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
}): ToolErrorInfo | undefined {
  if (options.aborted) {
    return createToolErrorInfo({
      code: "command_aborted",
      category: "aborted",
      retryable: false,
      nextAction: "Do not restart the same command automatically; choose a shorter command or ask before retrying.",
      fingerprint: "aborted:command_aborted",
    });
  }
  if (options.timedOut) {
    return createToolErrorInfo({
      code: "command_timeout",
      category: "timeout",
      retryable: true,
      nextAction: "Use a narrower command, increase timeout only when justified, or inspect partial output first.",
      fingerprint: "timeout:command_timeout",
    });
  }
  if (options.exitCode === 127) {
    return createToolErrorInfo({
      code: "command_not_found",
      category: "command",
      retryable: false,
      nextAction:
        "Check whether the command exists or use an available project tool; do not retry the same command unchanged.",
      fingerprint: "command:command_not_found",
    });
  }
  if (options.exitCode !== null && options.exitCode !== 0) {
    return createToolErrorInfo({
      code: "command_exit_nonzero",
      category: "command",
      retryable: false,
      nextAction: "Read stdout/stderr, fix the underlying cause, then rerun a relevant verification command.",
      fingerprint: `command:exit_${options.exitCode}`,
    });
  }
  if (options.signalCode) {
    return createToolErrorInfo({
      code: "command_terminated_by_signal",
      category: "command",
      retryable: false,
      nextAction:
        "The shell was killed by a signal. Inspect the command for self-matching process kills such as pkill -f, then use a safer targeted command.",
      fingerprint: `command:signal_${options.signalCode}`,
    });
  }
  return undefined;
}

export function redactSecrets(text: string): string {
  return text
    .replaceAll(/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, "$1[REDACTED]")
    .replaceAll(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?)[^\s"'`]+/gi, "$1[REDACTED]")
    .replaceAll(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function readNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
