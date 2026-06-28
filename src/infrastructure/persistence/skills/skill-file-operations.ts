import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillFileOperations } from "../../../application/skills/commands";

export class FilesystemSkillFileOperations implements SkillFileOperations {
  readSkillMarkdown(skillPath: string): string | null {
    const skillMdPath = join(skillPath, "SKILL.md");
    if (!existsSync(skillMdPath)) return null;
    return readFileSync(skillMdPath, "utf-8");
  }

  promoteDraft(input: {
    draftSkillPath: string;
    targetRootPath: string;
    name: string;
  }): { path: string } {
    const skillTargetPath = join(input.targetRootPath, input.name);
    mkdirSync(skillTargetPath, { recursive: true });

    const skillMdPath = join(input.draftSkillPath, "SKILL.md");
    const targetSkillMdPath = join(skillTargetPath, "SKILL.md");
    writeFileSync(targetSkillMdPath, readFileSync(skillMdPath, "utf-8"), "utf-8");

    const evalsPath = join(input.draftSkillPath, "evals");
    if (existsSync(evalsPath)) {
      const targetEvalsPath = join(skillTargetPath, "evals");
      mkdirSync(targetEvalsPath, { recursive: true });
      const casesPath = join(evalsPath, "cases.json");
      if (existsSync(casesPath)) {
        writeFileSync(join(targetEvalsPath, "cases.json"), readFileSync(casesPath, "utf-8"), "utf-8");
      }
    }

    return { path: skillTargetPath };
  }

  removeSkill(skillPath: string): void {
    rmSync(skillPath, { recursive: true, force: true });
  }
}
