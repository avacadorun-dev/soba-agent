export type DiagnosticTool = "bun-test" | "biome" | "typescript" | "build" | "unknown";

export interface ParsedDiagnostic {
  tool: DiagnosticTool;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface DiagnosticReport {
  tool: DiagnosticTool;
  command: string;
  summary: string;
  diagnostics: ParsedDiagnostic[];
  fingerprint: string;
}

export type FixUntilGreenFinalStatus = "passed" | "blocked" | "max_iterations" | "unsafe";

export type FixUntilGreenDecision =
  | {
      action: "recover";
      iteration: number;
      status: "recovering";
      diagnostic: DiagnosticReport;
      message: string;
    }
  | {
      action: "stop";
      iteration: number;
      status: Exclude<FixUntilGreenFinalStatus, "passed">;
      diagnostic: DiagnosticReport;
      message: string;
    }
  | {
      action: "passed";
      iteration: number;
      status: "passed";
      message: string;
    };

export interface VerificationFailureInput {
  command: string;
  output: string;
  proposedRecoveryCommand?: string;
}

export interface FixUntilGreenOptions {
  maxIterations?: number;
}
