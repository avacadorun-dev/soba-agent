import { executeMemoryCommand, memoryCommandExitCode, renderMemoryCommandView } from "../../application/commands/memory";
import { ProjectMemory } from "../../infrastructure/persistence/memory/project-memory";

export interface FilesystemMemoryCommandResult {
  exitCode: number;
  output: string;
  stream: "stdout" | "stderr";
}

export function runFilesystemMemoryCommand(input: {
  args: string[];
  projectRoot: string;
}): FilesystemMemoryCommandResult {
  const memory = new ProjectMemory({ projectRoot: input.projectRoot });
  const view = executeMemoryCommand({
    args: input.args,
    memory,
  });
  const output = ensureTrailingNewline(renderMemoryCommandView(view));

  return {
    exitCode: memoryCommandExitCode(view),
    output,
    stream: memoryCommandExitCode(view) === 0 ? "stdout" : "stderr",
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
