import {
  executeExplainClaimCommand,
  explainClaimCommandExitCode,
  renderExplainClaimCommandView,
} from "../../application/commands/explain-claim";
import { FilesystemEvidenceProofStorage } from "../../infrastructure/persistence/evidence/proof-storage";

export interface FilesystemExplainClaimCommandResult {
  exitCode: number;
  output: string;
  stream: "stdout" | "stderr";
}

export function runFilesystemExplainClaimCommand(input: {
  args: string[];
  projectRoot: string;
}): FilesystemExplainClaimCommandResult {
  const storage = new FilesystemEvidenceProofStorage({ projectRoot: input.projectRoot });
  const view = executeExplainClaimCommand({
    args: input.args,
    reader: storage,
    evidenceDir: storage.getEvidenceDir(),
  });
  const output = ensureTrailingNewline(renderExplainClaimCommandView(view));

  return {
    exitCode: explainClaimCommandExitCode(view),
    output,
    stream: view.kind === "claim" ? "stdout" : "stderr",
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
