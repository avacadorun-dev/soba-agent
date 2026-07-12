/**
 * Activate Skill Tool — Phase 2
 *
 * Allows the model to activate skills on-demand.
 * Returns skill metadata and resources without executing scripts.
 * Full SKILL.md content is injected ephemerally in the next request.
 *
 * Spec: internal-design-notes § Activation
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillCatalog } from "../../../application/skills/catalog";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import type { ActivatedSkillRef } from "../../../kernel/transcript/types-v2";

export interface ActivateSkillToolOptions {
  catalog: SkillCatalog;
  /** Callback to persist activation in session */
  onActivate: (ref: ActivatedSkillRef, context: ToolContext) => void;
  /** Callback to check if skill is already active */
  isActive: (name: string, revision: string) => boolean;
}

export interface ActivateSkillArgs {
  name: string;
}

/**
 * Create the activate_skill tool definition.
 */
export function createActivateSkillTool(options: ActivateSkillToolOptions): ToolDefinition<ActivateSkillArgs> {
  return {
    name: "activate_skill",
    label: "Activate Skill",
    toolType: "function",
    description:
      "Activate a skill to get specialized instructions for the current task. Use only when the task clearly matches the skill description; do not activate skills for generic exploration. The full skill content will be available in the next request.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the skill to activate",
        },
      },
      required: ["name"],
    },
    async execute(args, context): Promise<ToolResult> {
      const { name } = args;

      // Try to activate the skill
      const result = options.catalog.activate(name);

      if (!result.success || !result.skill) {
        return {
          content: [
            {
              type: "text",
              text: result.error || "Failed to activate skill",
            },
          ],
          isError: true,
        };
      }

      const skill = result.skill;

      // Check if already active (deduplication)
      if (skill.revision && options.isActive(name, skill.revision)) {
        const resources = listResources(skill.skillPath);
        return {
          content: [
            {
              type: "text",
              text: `Skill '${skill.name}' (revision ${skill.revision}) is already active.\n\nDescription: ${skill.description}\nPath: ${skill.skillPath}\nResources: ${resources.length > 0 ? resources.join(", ") : "none"}`,
            },
          ],
          isError: false,
        };
      }

      // Create activation reference
      const ref: ActivatedSkillRef = {
        name: skill.name,
        scope: skill.scope,
        revision: skill.revision || "unknown",
        contentHash: skill.contentHash || "unknown",
      };

      // Persist activation
      options.onActivate(ref, context);

      const resources = listResources(skill.skillPath);
      return {
        content: [
          {
            type: "text",
            text: `Activated skill '${skill.name}' (revision ${skill.revision}) from ${skill.scope} scope.\n\nDescription: ${skill.description}\nPath: ${skill.skillPath}\nResources: ${resources.length > 0 ? resources.join(", ") : "none"}\n\nThe full skill content will be available in the next request.`,
          },
        ],
        isError: false,
      };
    },
  };
}

export interface DeactivateSkillToolOptions {
  getActiveSkill: (name: string) => ActivatedSkillRef | undefined;
  deactivate: (name: string) => boolean;
  onDeactivate: (ref: ActivatedSkillRef, context: ToolContext) => void;
}

export interface DeactivateSkillArgs {
  name: string;
}

/** Create the deactivate_skill control tool for session-scoped skill lifecycle. */
export function createDeactivateSkillTool(options: DeactivateSkillToolOptions): ToolDefinition<DeactivateSkillArgs> {
  return {
    name: "deactivate_skill",
    label: "Deactivate Skill",
    toolType: "function",
    semantics: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
    description:
      "Deactivate a session-scoped skill when it no longer applies. This stops its full instructions from being injected into later model requests.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the active skill to deactivate",
        },
      },
      required: ["name"],
    },
    async execute(args, context): Promise<ToolResult> {
      const ref = options.getActiveSkill(args.name);
      if (!ref || !options.deactivate(args.name)) {
        return {
          content: [{ type: "text", text: `Skill '${args.name}' is not active.` }],
          isError: true,
        };
      }

      options.onDeactivate(ref, context);
      return {
        content: [{ type: "text", text: `Deactivated skill '${args.name}'.` }],
        isError: false,
      };
    },
  };
}

/**
 * List available resources in a skill directory.
 */
function listResources(skillPath: string): string[] {
  const resources: string[] = [];
  const resourceDirs = ["scripts", "references", "assets"];

  for (const dir of resourceDirs) {
    const dirPath = join(skillPath, dir);
    if (existsSync(dirPath)) {
      try {
        const files = readdirSync(dirPath);
        for (const file of files) {
          resources.push(join(dir, file));
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return resources;
}

/**
 * Read full SKILL.md content for ephemeral injection.
 */
export function readSkillContent(skillPath: string): string | null {
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return null;
  }

  try {
    return readFileSync(skillMdPath, "utf-8");
  } catch {
    return null;
  }
}
