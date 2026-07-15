export type TuiInputMode = "message" | "slash-command" | "shell" | "shell-silent" | "empty";

export interface ParsedTuiInput {
  mode: TuiInputMode;
  content: string;
}

/**
 * Classify input once for both the composer UI and submit path.
 * The first line chooses the mode for the entire input.
 */
export function parseTuiInput(rawInput: string): ParsedTuiInput {
  const input = rawInput.trim();
  if (!input) return { mode: "empty", content: "" };
  if (input.startsWith("//")) return { mode: "message", content: input };
  if (input.startsWith("/")) return { mode: "slash-command", content: input };
  if (input.startsWith("!!")) {
    return { mode: "shell-silent", content: normalizeShellCommand(input) };
  }
  if (input.startsWith("!")) {
    return { mode: "shell", content: normalizeShellCommand(input) };
  }
  return { mode: "message", content: input };
}

export function isShellInput(rawInput: string): boolean {
  const mode = parseTuiInput(rawInput).mode;
  return mode === "shell" || mode === "shell-silent";
}

/**
 * Turn a pasted list of shell shortcuts into one shell script:
 *
 *   !pwd              pwd
 *   !git status  ->   git status
 *   //server/path     //server/path
 *
 * A leading ! or !! is removed independently from every command line. All
 * remaining shell syntax is preserved verbatim. The first line still
 * determines whether output is visible or silent.
 */
function normalizeShellCommand(input: string): string {
  return input
    .split("\n")
    .map((line) => line.replace(/^(\s*)!!?/, "$1"))
    .join("\n")
    .trim();
}
