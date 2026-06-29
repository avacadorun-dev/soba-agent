export type ProjectCommandKind = "test" | "lint" | "typecheck" | "build" | "run" | "deadCode";

export type ProjectCommandSource = "project-instructions" | "package-json" | "known-config" | "soba-default";

export interface ProjectCommand {
  kind: ProjectCommandKind;
  command: string;
  source: ProjectCommandSource;
  reason: string;
}

export interface SkippedProjectCommand {
  kind: ProjectCommandKind;
  source: ProjectCommandSource;
  reason: string;
  command?: string;
}

export interface ProjectCommandSet {
  test: ProjectCommand[];
  lint: ProjectCommand[];
  typecheck: ProjectCommand[];
  build: ProjectCommand[];
  run: ProjectCommand[];
  deadCode: ProjectCommand[];
  skipped: SkippedProjectCommand[];
}

export interface ProjectCommandFileReader {
  readText(relativePath: string): Promise<string | null> | string | null;
  exists(relativePath: string): Promise<boolean> | boolean;
}

export interface DetectProjectCommandsOptions {
  cwd: string;
  projectFiles?: ProjectCommandFileReader;
  projectInstructions?: string[];
  includeFullGate?: boolean;
  includeReleaseGate?: boolean;
}
