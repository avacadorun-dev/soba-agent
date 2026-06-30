import { executeVerifyCommand, renderVerifyCommandView, verifyCommandExitCode } from "../../application/commands/verify";
import { FilesystemEvidenceProofStorage } from "../../infrastructure/persistence/evidence/proof-storage";

export interface FilesystemVerifyCommandResult {
  exitCode: number;
  output: string;
  stream: "stdout" | "stderr";
}

export function runFilesystemVerifyCommand(input: {
  args: string[];
  projectRoot: string;
}): FilesystemVerifyCommandResult {
  const storage = new FilesystemEvidenceProofStorage({ projectRoot: input.projectRoot });
  const view = executeVerifyCommand({
    args: input.args,
    reader: storage,
    evidenceDir: storage.getEvidenceDir(),
  });
  const output = ensureTrailingNewline(renderVerifyCommandView(view));

  return {
    exitCode: verifyCommandExitCode(view),
    output,
    stream: view.kind === "verification" && view.verification.valid ? "stdout" : "stderr",
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
