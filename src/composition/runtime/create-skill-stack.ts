import { join } from "node:path";
import { SkillCatalog } from "../../application/skills/catalog";
import { SkillCommands } from "../../application/skills/commands";
import { SkillDiscovery } from "../../application/skills/discovery";
import { DraftStore } from "../../application/skills/drafts";
import { SkillEvaluator } from "../../application/skills/evaluator";
import { ProjectTrustStore } from "../../application/skills/project-trust-store";
import { RevisionStore } from "../../application/skills/revisions";
import { SkillManager } from "../../application/skills/skill-manager";
import type { SessionManager } from "../../infrastructure/persistence/sessions/session-manager";
import { FilesystemSkillFileOperations } from "../../infrastructure/persistence/skills/skill-file-operations";
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
  const trustStore = new ProjectTrustStore({ sobaDir });
  const skillDiscovery = new SkillDiscovery({
    projectPath: input.projectPath,
    userSkillsPath: join(sobaDir, "skills"),
    bundledSkillsPath: process.env.SOBA_BUNDLED_SKILLS_PATH ?? join(process.cwd(), "skills"),
    trustStore,
  });
  const skillCatalog = new SkillCatalog({ discovery: skillDiscovery });
  const skillManager = new SkillManager({
    catalog: skillCatalog,
    discovery: skillDiscovery,
    trustStore,
  });
  const skillCommands = new SkillCommands({
    draftStore: new DraftStore({ draftsPath: join(sobaDir, "skill-drafts") }),
    revisionStore: new RevisionStore({ revisionsPath: join(sobaDir, "skill-revisions") }),
    evaluator: new SkillEvaluator({ evalRunsPath: join(sobaDir, "eval-runs") }),
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
