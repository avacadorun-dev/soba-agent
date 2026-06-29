import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ObservationConfig,
  WorkflowObservationStore,
  WorkflowPattern,
} from "../../../application/skills/observer";

export interface FilesystemWorkflowObservationStoreOptions {
  observationsPath: string;
}

export class FilesystemWorkflowObservationStore implements WorkflowObservationStore {
  private readonly observationsPath: string;

  constructor(options: FilesystemWorkflowObservationStoreOptions) {
    this.observationsPath = options.observationsPath;
    if (!existsSync(this.observationsPath)) {
      mkdirSync(this.observationsPath, { recursive: true });
    }
  }

  readConfig(): ObservationConfig | null {
    const configPath = join(this.observationsPath, "config.json");
    if (!existsSync(configPath)) return null;

    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return null;
    }
  }

  writeConfig(config: ObservationConfig): void {
    const configPath = join(this.observationsPath, "config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  readPatterns(): WorkflowPattern[] {
    const patternsPath = join(this.observationsPath, "patterns.json");
    if (!existsSync(patternsPath)) return [];

    try {
      const data = JSON.parse(readFileSync(patternsPath, "utf-8"));
      return Array.isArray(data.patterns) ? data.patterns : [];
    } catch {
      return [];
    }
  }

  writePatterns(patterns: WorkflowPattern[]): void {
    const patternsPath = join(this.observationsPath, "patterns.json");
    writeFileSync(patternsPath, JSON.stringify({ patterns }, null, 2), "utf-8");
  }
}
