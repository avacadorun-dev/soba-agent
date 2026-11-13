/**
 * Project-declared required skill parsing.
 *
 * A project declares required skills in AGENTS.md inside a fenced
 * `soba-skills` code block:
 *
 * ```soba-skills
 * {
 *   "always": ["repo-guidelines"],
 *   "required": [
 *     { "name": "typescript-best-practices", "when": "typescript" }
 *   ]
 * }
 * ```
 *
 * - `always` skills activate for every session in this repository.
 * - `required` skills activate at session start when the user's prompt
 *   matches `when` (case-insensitive substring). Without `when` they always
 *   activate. Loading is deterministic; the model never decides it.
 *
 * A missing block is fine; a malformed block produces an actionable warning.
 */

export interface ProjectSkillDeclaration {
  name: string;
  when?: string;
  always: boolean;
}

export interface ProjectSkillDeclarations {
  declarations: ProjectSkillDeclaration[];
  warnings: string[];
}

export function parseProjectSkillDeclarations(agentsMdContent: string): ProjectSkillDeclarations {
  const warnings: string[] = [];
  const declarations: ProjectSkillDeclaration[] = [];

  const block = findDeclarationsBlock(agentsMdContent);
  if (!block) return { declarations, warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.body);
  } catch (error) {
    warnings.push(
      `AGENTS.md soba-skills block is not valid JSON (${error instanceof Error ? error.message : String(error)}). ` +
        "Fix the block or remove it; declared skills were not loaded.",
    );
    return { declarations, warnings };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push('AGENTS.md soba-skills block must be a JSON object like {"always": [...], "required": [...]}.');
    return { declarations, warnings };
  }

  const record = parsed as Record<string, unknown>;
  collectEntries(record.always, true, declarations, warnings);
  collectEntries(record.required, false, declarations, warnings);

  for (const key of Object.keys(record)) {
    if (key !== "always" && key !== "required") {
      warnings.push(`AGENTS.md soba-skills: unknown field "${key}" is ignored.`);
    }
  }

  return { declarations, warnings };
}

function findDeclarationsBlock(content: string): { body: string } | null {
  const fence = /```soba-skills\s*\n([\s\S]*?)```/.exec(content);
  if (!fence) return null;
  return { body: fence[1] };
}

function collectEntries(
  value: unknown,
  always: boolean,
  declarations: ProjectSkillDeclaration[],
  warnings: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    warnings.push(`AGENTS.md soba-skills: "${always ? "always" : "required"}" must be an array.`);
    return;
  }

  value.forEach((item, index) => {
    if (typeof item === "string") {
      if (item.trim().length === 0) {
        warnings.push(`AGENTS.md soba-skills: empty skill name at ${always ? "always" : "required"}[${index}].`);
        return;
      }
      declarations.push({ name: item.trim(), always });
      return;
    }
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      if (typeof record.name !== "string" || record.name.trim().length === 0) {
        warnings.push(
          `AGENTS.md soba-skills: ${always ? "always" : "required"}[${index}] must have a non-empty "name".`,
        );
        return;
      }
      if (record.when !== undefined && typeof record.when !== "string") {
        warnings.push(`AGENTS.md soba-skills: "${record.name}".when must be a string; entry ignored.`);
        return;
      }
      declarations.push({
        name: record.name.trim(),
        always,
        ...(typeof record.when === "string" && record.when.trim().length > 0
          ? { when: record.when.trim() }
          : {}),
      });
      return;
    }
    warnings.push(
      `AGENTS.md soba-skills: ${always ? "always" : "required"}[${index}] must be a skill name or an object with "name".`,
    );
  });
}
