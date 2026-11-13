import { renderDoctorReport } from "../../application/commands/doctor";
import { refreshCapabilityReport } from "../runtime/environment-capabilities";

export interface FilesystemDoctorCommandResult {
  exitCode: number;
  output: string;
  stream: "stdout" | "stderr";
}

/**
 * Run the environment capability preflight and persist the report under
 * `.soba/capabilities.json` so the runtime session context picks it up.
 */
export async function runFilesystemDoctorCommand(input: {
  projectRoot: string;
  model: string;
  visionSupported: boolean;
}): Promise<FilesystemDoctorCommandResult> {
  const report = await refreshCapabilityReport({
    projectRoot: input.projectRoot,
    model: input.model,
    visionSupported: input.visionSupported,
  });
  return {
    exitCode: 0,
    output: `${renderDoctorReport(report)}\n`,
    stream: "stdout",
  };
}
