import { executeProveCommand, proveCommandExitCode, renderProveCommandView } from "../../application/commands/prove";
import { FilesystemEvidenceProofStorage } from "../../infrastructure/persistence/evidence/proof-storage";

export interface FilesystemProveCommandResult {
  exitCode: number;
  output: string;
  stream: "stdout" | "stderr";
}

export function runFilesystemProveCommand(input: {
  args: string[];
  projectRoot: string;
}): FilesystemProveCommandResult {
  const storage = new FilesystemEvidenceProofStorage({ projectRoot: input.projectRoot });
  const view = executeProveCommand({
    args: input.args,
    reader: storage,
    evidenceDir: storage.getEvidenceDir(),
  });
  const output = ensureTrailingNewline(renderProveCommandView(view));

  return {
    exitCode: proveCommandExitCode(view),
    output,
    stream: view.kind === "proof" ? "stdout" : "stderr",
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
