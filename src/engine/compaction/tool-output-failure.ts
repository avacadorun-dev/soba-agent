import type { ItemParam } from "../../kernel/transcript/types";

const FAILURE_LINE = /^(?:error\b|failed\b|failure\b|exception\b|fatal\b|panic\b|✖\s*error\b)/i;

/**
 * Return a failure output only when the tool item carries an explicit failure
 * signal. Source code often contains words such as `Error` or `failed`; broad
 * substring matching turns ordinary file reads into fake active blockers.
 */
export function toolFailureOutput(item: ItemParam): string | null {
  if (item.type !== "function_call_output" && item.type !== "local_shell_call_output") return null;

  const output = item.type === "function_call_output"
    ? (typeof item.output === "string"
      ? item.output
      : item.output
          .filter((content): content is Extract<typeof content, { text: string }> => "text" in content)
          .map((content) => content.text)
          .join("\n"))
    : item.output;

  if (item.status !== undefined && item.status !== null) {
    return item.status === "failed" ? output : null;
  }
  if (item.type === "local_shell_call_output" && item.exit_code !== undefined) {
    return item.exit_code === 0 ? null : output;
  }

  // Compatibility for older transcript entries that did not persist status.
  // Only trust the first meaningful line: inspected source code can legitimately
  // contain declarations such as `error: string` deeper in the output.
  const firstMeaningfulLine = output
    .replaceAll(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstMeaningfulLine && FAILURE_LINE.test(firstMeaningfulLine) ? output : null;
}
