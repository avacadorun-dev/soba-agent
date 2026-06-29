import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalResult, SkillEvaluationStorage } from "../../../application/skills/evaluator";

export interface FilesystemSkillEvaluationStorageOptions {
  evalRunsPath: string;
}

export class FilesystemSkillEvaluationStorage implements SkillEvaluationStorage {
  private readonly evalRunsPath: string;

  constructor(options: FilesystemSkillEvaluationStorageOptions) {
    this.evalRunsPath = options.evalRunsPath;
    if (!existsSync(this.evalRunsPath)) {
      mkdirSync(this.evalRunsPath, { recursive: true });
    }
  }

  saveEvalRun(result: EvalResult): void {
    const skillEvalPath = join(this.evalRunsPath, result.skillName);
    mkdirSync(skillEvalPath, { recursive: true });
    writeFileSync(join(skillEvalPath, `${result.runId}.json`), JSON.stringify(result, null, 2), "utf-8");
  }

  getEvalRun(skillName: string, revisionId: string): EvalResult | null {
    const skillEvalPath = join(this.evalRunsPath, skillName);
    if (!existsSync(skillEvalPath)) {
      return null;
    }

    const files = readdirSync(skillEvalPath);
    for (const file of files) {
      if (!file.includes(revisionId)) {
        continue;
      }

      try {
        return JSON.parse(readFileSync(join(skillEvalPath, file), "utf-8")) as EvalResult;
      } catch {
        continue;
      }
    }

    return null;
  }

  listEvalRuns(skillName: string): EvalResult[] {
    const skillEvalPath = join(this.evalRunsPath, skillName);
    if (!existsSync(skillEvalPath)) {
      return [];
    }

    const runs: EvalResult[] = [];
    for (const file of readdirSync(skillEvalPath)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        runs.push(JSON.parse(readFileSync(join(skillEvalPath, file), "utf-8")) as EvalResult);
      } catch {
        continue;
      }
    }

    return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  readSkillMarkdown(skillPath: string): string {
    const skillMdPath = join(skillPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      return "";
    }

    return readFileSync(skillMdPath, "utf-8");
  }
}
