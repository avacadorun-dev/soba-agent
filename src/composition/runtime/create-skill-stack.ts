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
import { resolveBundledSkillsPath } from "../../infrastructure/persistence/skills/bundled-skill-source";
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
import type { ToolContext } from "../../kernel/tools/types";

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
    bundledSkillsPath: resolveBundledSkillsPath({ sobaDir }),
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
      availableTools: input.toolRegistry.getNames(),
    }),
    catalog: skillCatalog,
    files: new FilesystemSkillFileOperations(),
    userSkillsPath: join(sobaDir, "skills"),
    projectSkillsPath: join(input.projectPath, ".soba", "skills"),
  });
  skillManager.refresh();
  reconcileActiveSkills(skillManager, input.session);

  if (skillCatalog.getModelInvocable().length > 0) {
    const { createActivateSkillTool, createDeactivateSkillTool } = await import("../../infrastructure/tools/local/activate-skill");
    input.toolRegistry.register(createActivateSkillTool({
      catalog: skillCatalog,
      onActivate: (ref, context) => {
        skillManager.activate(ref.name);
        sessionFromToolContext(context, input.session).appendSkillActivation({ action: "activate", skill: ref });
      },
      isActive: (name, revision) => skillManager.getActiveSkills().some(
        (skill) => skill.name === name && skill.revision === revision,
      ),
    }));
    input.toolRegistry.register(createDeactivateSkillTool({
      getActiveSkill: (name) => skillManager.getActiveSkills().find((skill) => skill.name === name),
      deactivate: (name) => skillManager.deactivate(name),
      onDeactivate: (ref, context) => {
        sessionFromToolContext(context, input.session).appendSkillActivation({ action: "deactivate", skill: ref });
      },
    }));
  }

  return {
    skillManager,
    skillCommands,
    skillCatalog,
    trustStore,
  };
}

export function reconcileActiveSkills(skillManager: SkillManager, session: SessionManager): void {
  const result = skillManager.restoreActiveSkills(session.getActiveSkillRefs());
  for (const rejected of result.rejected) {
    session.appendSkillActivation({ action: "deactivate", skill: rejected });
  }
}

function sessionFromToolContext(context: ToolContext, fallback: SessionManager): SessionManager {
  const candidate = context.session as Partial<SessionManager> | undefined;
  return candidate && typeof candidate.appendSkillActivation === "function"
    ? candidate as SessionManager
    : fallback;
}
