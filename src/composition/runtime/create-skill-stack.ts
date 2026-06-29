import { join } from "node:path";
import { SkillCatalog } from "../../application/skills/catalog";
import { SkillCommands } from "../../application/skills/commands";
import { SkillDiscovery } from "../../application/skills/discovery";
import { DraftStore } from "../../application/skills/drafts";
import { SkillEvaluator } from "../../application/skills/evaluator";
import type { ProjectTrustStore } from "../../application/skills/project-trust-store";
import { RevisionStore } from "../../application/skills/revisions";
import { SkillManager } from "../../application/skills/skill-manager";
import type { SessionManager } from "../../infrastructure/persistence/sessions/session-manager";
import { FilesystemDraftStorage } from "../../infrastructure/persistence/skills/draft-storage";
import { FilesystemSkillEvaluationStorage } from "../../infrastructure/persistence/skills/evaluation-storage";
import { createFilesystemProjectTrustStore } from "../../infrastructure/persistence/skills/project-trust-storage";
import { FilesystemRevisionStorage } from "../../infrastructure/persistence/skills/revision-storage";
import {
  FilesystemSkillFileOperations,
  readSkillContentFromDisk,
} from "../../infrastructure/persistence/skills/skill-file-operations";
import {
  computeSkillContentHashOnDisk,
  FilesystemSkillValidationFilesystem,
  validateSkillOnDisk,
} from "../../infrastructure/persistence/skills/skill-validation-filesystem";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";

export interface SkillStackInput {
  projectPath: string;
  homeDir: string;
  session: SessionManager;
  toolRegistry: ToolRegistry;
}

export interface SkillStack {
  skillManager: SkillManager;
  skillCommands: SkillCommands;
  skillCatalog: SkillCatalog;
  trustStore: ProjectTrustStore;
}

export async function createSkillStack(input: SkillStackInput): Promise<SkillStack> {
  const sobaDir = join(input.homeDir, ".soba");
  const trustStore = createFilesystemProjectTrustStore({ sobaDir });
  const skillValidationFiles = new FilesystemSkillValidationFilesystem();
  const skillDiscovery = new SkillDiscovery({
    projectPath: input.projectPath,
    userSkillsPath: join(sobaDir, "skills"),
    bundledSkillsPath: process.env.SOBA_BUNDLED_SKILLS_PATH ?? join(process.cwd(), "skills"),
    trustStore,
    files: skillValidationFiles,
    validateSkill: validateSkillOnDisk,
    computeSkillContentHash: computeSkillContentHashOnDisk,
  });
  const skillCatalog = new SkillCatalog({ discovery: skillDiscovery });
  const skillManager = new SkillManager({
    catalog: skillCatalog,
    discovery: skillDiscovery,
    trustStore,
    readSkillContent: readSkillContentFromDisk,
  });
  const skillCommands = new SkillCommands({
    draftStore: new DraftStore({
      storage: new FilesystemDraftStorage({ draftsPath: join(sobaDir, "skill-drafts") }),
      validateSkill: validateSkillOnDisk,
    }),
    revisionStore: new RevisionStore({
      storage: new FilesystemRevisionStorage({ revisionsPath: join(sobaDir, "skill-revisions") }),
    }),
    evaluator: new SkillEvaluator({
      storage: new FilesystemSkillEvaluationStorage({ evalRunsPath: join(sobaDir, "eval-runs") }),
      validateSkill: validateSkillOnDisk,
    }),
    catalog: skillCatalog,
    files: new FilesystemSkillFileOperations(),
    userSkillsPath: join(sobaDir, "skills"),
    projectSkillsPath: join(input.projectPath, ".soba", "skills"),
  });
  skillManager.refresh();

  if (skillCatalog.getModelInvocable().length > 0) {
    const { createActivateSkillTool } = await import("../../infrastructure/tools/local/activate-skill");
    input.toolRegistry.register(createActivateSkillTool({
      catalog: skillCatalog,
      onActivate: (ref) => {
        skillManager.activate(ref.name);
        input.session.appendSkillActivation({ action: "activate", skill: ref });
      },
      isActive: (name, revision) => skillManager.getActiveSkills().some(
        (skill) => skill.name === name && skill.revision === revision,
      ),
    }));
  }

  return {
    skillManager,
    skillCommands,
    skillCatalog,
    trustStore,
  };
}
