/**
 * Skill Validator — Phase 2
 *
 * Validates skill structure, frontmatter, and security constraints.
 * Spec: internal-design-notes § Validation
 */

import { createHash } from "node:crypto";
import type {
  SkillDiagnostic,
  SkillFrontmatter,
  SkillValidationOptions,
  SobaSkillMemoryPolicy,
  SobaSkillMetadata,
  ValidationResult,
} from "./types";
import {
  MAX_COMPATIBILITY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  SKILL_NAME_PATTERN,
  SOBA_METADATA_PREFIX,
} from "./types";

const BUNDLED_REQUIRED_SECTIONS = [
  "Purpose",
  "Triggers",
  "Inputs To Inspect",
  "Procedure",
  "Verification Contract",
  "Failure Recovery",
  "Memory Policy",
  "Stop Conditions",
  "Anti-Patterns",
];

const SOBA_MEMORY_POLICIES = new Set<SobaSkillMemoryPolicy>(["none", "read", "write", "read-write"]);

export interface SkillFilesystemEntry {
  name: string;
  kind: "directory" | "file" | "symlink" | "other";
}

export interface SkillValidationFilesystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  basename(path: string): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  realpath(path: string): string;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  listEntries(path: string): SkillFilesystemEntry[];
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Simple parser that handles the common case without external dependencies.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: content };
  }

  const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n");

  const frontmatter: Record<string, unknown> = {};
  let currentTopKey: string | null = null;
  let currentNestedKey: string | null = null;

  for (const line of frontmatterLines) {
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }

    // Match top-level key (no indentation)
    const topLevelMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (topLevelMatch) {
      currentTopKey = topLevelMatch[1];
      currentNestedKey = null;
      const value = topLevelMatch[2].trim();
      frontmatter[currentTopKey] = value.length > 0 ? parseYamlScalar(value) : {};
      continue;
    }

    // Match indented key (nested object)
    const nestedMatch = line.match(/^\s+([a-zA-Z0-9._-]+):\s*(.*)$/);
    if (nestedMatch && currentTopKey) {
      const container = ensureObject(frontmatter, currentTopKey);
      const key = nestedMatch[1];
      const rawValue = nestedMatch[2].trim();
      currentNestedKey = key;
      container[key] = rawValue.length > 0 ? parseYamlScalar(rawValue) : [];
      continue;
    }

    // Match array item
    const arrayMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayMatch && currentTopKey) {
      const value = parseYamlScalar(arrayMatch[1].trim());

      if (currentNestedKey) {
        const container = ensureObject(frontmatter, currentTopKey);
        const currentValue = container[currentNestedKey];
        if (!Array.isArray(currentValue)) {
          container[currentNestedKey] = [];
        }
        (container[currentNestedKey] as unknown[]).push(value);
      } else {
        const currentValue = frontmatter[currentTopKey];
        if (!Array.isArray(currentValue)) {
          frontmatter[currentTopKey] = [];
        }
        (frontmatter[currentTopKey] as unknown[]).push(value);
      }
      continue;
    }
  }

  return { frontmatter, body };
}

function parseYamlScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) {
    return quoted[2];
  }

  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);

  return value;
}

function ensureObject(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = container[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const nextValue: Record<string, unknown> = {};
  container[key] = nextValue;
  return nextValue;
}

/**
 * Validate skill directory and return validation result.
 */
export function validateSkill(skillPath: string, options: SkillValidationOptions = {}): ValidationResult {
  const errors: SkillDiagnostic[] = [];
  const warnings: SkillDiagnostic[] = [];
  const files = options.files;

  if (!files) {
    errors.push({
      code: "FILESYSTEM_NOT_CONFIGURED",
      severity: "error",
      message: "Skill validation filesystem is not configured",
      path: skillPath,
    });
    return { valid: false, errors, warnings };
  }

  // Check if directory exists
  if (!files.exists(skillPath)) {
    errors.push({
      code: "SKILL_NOT_FOUND",
      severity: "error",
      message: `Skill directory does not exist: ${skillPath}`,
      path: skillPath,
    });
    return { valid: false, errors, warnings };
  }

  if (!files.isDirectory(skillPath)) {
    errors.push({
      code: "NOT_A_DIRECTORY",
      severity: "error",
      message: `Skill path is not a directory: ${skillPath}`,
      path: skillPath,
    });
    return { valid: false, errors, warnings };
  }

  // Check for SKILL.md
  const skillMdPath = files.join(skillPath, "SKILL.md");
  if (!files.exists(skillMdPath)) {
    errors.push({
      code: "MISSING_SKILL_MD",
      severity: "error",
      message: "Skill directory must contain SKILL.md",
      path: skillMdPath,
    });
    return { valid: false, errors, warnings };
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = files.readText(skillMdPath);
  } catch (error) {
    errors.push({
      code: "CANNOT_READ_SKILL_MD",
      severity: "error",
      message: `Failed to read SKILL.md: ${error}`,
      path: skillMdPath,
    });
    return { valid: false, errors, warnings };
  }

  const { body, frontmatter } = parseFrontmatter(content);

  // Validate required fields
  const name = frontmatter.name;
  if (!name || typeof name !== "string") {
    errors.push({
      code: "MISSING_NAME",
      severity: "error",
      message: "Frontmatter must contain 'name' field",
      path: skillMdPath,
    });
  } else {
    // Validate name format
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      errors.push({
        code: "NAME_TOO_LONG",
        severity: "error",
        message: `Skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters`,
        path: skillMdPath,
      });
    }

    if (!SKILL_NAME_PATTERN.test(name)) {
      errors.push({
        code: "INVALID_NAME_FORMAT",
        severity: "error",
        message: "Skill name must match pattern: lowercase-hyphen-name",
        path: skillMdPath,
      });
    }

    // Check name matches directory name
    const dirName = files.basename(skillPath);
    if (name !== dirName) {
      errors.push({
        code: "NAME_DIRECTORY_MISMATCH",
        severity: "error",
        message: `Skill name '${name}' does not match directory name '${dirName}'`,
        path: skillMdPath,
      });
    }
  }

  const description = frontmatter.description;
  if (!description || typeof description !== "string") {
    errors.push({
      code: "MISSING_DESCRIPTION",
      severity: "error",
      message: "Frontmatter must contain 'description' field",
      path: skillMdPath,
    });
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      code: "DESCRIPTION_TOO_LONG",
      severity: "error",
      message: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
      path: skillMdPath,
    });
  }

  // Validate optional fields
  if (frontmatter.compatibility !== undefined) {
    if (typeof frontmatter.compatibility !== "string") {
      errors.push({
        code: "INVALID_COMPATIBILITY",
        severity: "error",
        message: "Compatibility must be a string",
        path: skillMdPath,
      });
    } else if (frontmatter.compatibility.length > MAX_COMPATIBILITY_LENGTH) {
      errors.push({
        code: "COMPATIBILITY_TOO_LONG",
        severity: "error",
        message: `Compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} characters`,
        path: skillMdPath,
      });
    }
  }

  if (frontmatter.metadata !== undefined) {
    if (typeof frontmatter.metadata !== "object" || frontmatter.metadata === null) {
      errors.push({
        code: "INVALID_METADATA",
        severity: "error",
        message: "Metadata must be an object",
        path: skillMdPath,
      });
    } else {
      const metadata = frontmatter.metadata as Record<string, unknown>;
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== "string") {
          errors.push({
            code: "INVALID_METADATA_VALUE",
            severity: "error",
            message: `Metadata key '${key}' must have a string value`,
            path: skillMdPath,
          });
        }
      }
    }
  }

  const sobaValidation = validateSobaMetadata(frontmatter.soba, skillMdPath);
  errors.push(...sobaValidation.errors);
  warnings.push(...sobaValidation.warnings);

  const requiredSections = new Set(sobaValidation.metadata?.requiredSections ?? []);
  if (options.scope === "bundled") {
    for (const section of BUNDLED_REQUIRED_SECTIONS) {
      requiredSections.add(section);
    }
  }
  if (requiredSections.size > 0) {
    errors.push(...validateRequiredSections(body, skillMdPath, [...requiredSections], options.scope === "bundled"));
  }

  // Check for symlinks and path traversal
  const symlinkErrors = checkSymlinksAndTraversal(skillPath, files);
  errors.push(...symlinkErrors.errors);
  warnings.push(...symlinkErrors.warnings);

  // Check for unknown top-level fields
  const knownFields = new Set(["name", "description", "license", "compatibility", "metadata", "soba", "allowed-tools"]);
  for (const key of Object.keys(frontmatter)) {
    if (!knownFields.has(key)) {
      warnings.push({
        code: "UNKNOWN_FIELD",
        severity: "warning",
        message: `Unknown frontmatter field: ${key}`,
        path: skillMdPath,
      });
    }
  }

  // Check for SOBA-specific metadata
  if (frontmatter.metadata && typeof frontmatter.metadata === "object") {
    const metadata = frontmatter.metadata as Record<string, string>;
    for (const key of Object.keys(metadata)) {
      if (key.startsWith(SOBA_METADATA_PREFIX)) {
        warnings.push({
          code: "SOBA_SPECIFIC_METADATA",
          severity: "warning",
          message: `SOBA-specific metadata key '${key}' is not portable`,
          path: skillMdPath,
        });
      }
    }
  }

  // Parse frontmatter for return
  const parsedFrontmatter: SkillFrontmatter = {
    name: typeof frontmatter.name === "string" ? frontmatter.name : "",
    description: typeof frontmatter.description === "string" ? frontmatter.description : "",
  };

  if (typeof frontmatter.license === "string") {
    parsedFrontmatter.license = frontmatter.license;
  }

  if (typeof frontmatter.compatibility === "string") {
    parsedFrontmatter.compatibility = frontmatter.compatibility;
  }

  if (frontmatter.metadata && typeof frontmatter.metadata === "object") {
    parsedFrontmatter.metadata = frontmatter.metadata as Record<string, string>;
  }

  if (sobaValidation.metadata) {
    parsedFrontmatter.soba = sobaValidation.metadata;
  }

  if (Array.isArray(frontmatter["allowed-tools"])) {
    parsedFrontmatter.allowedTools = frontmatter["allowed-tools"] as string[];
    warnings.push({
      code: "ALLOWED_TOOLS_NOT_PRE_APPROVED",
      severity: "warning",
      message: "allowed-tools is parsed for compatibility but does not pre-approve tool calls",
      path: skillMdPath,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    frontmatter: parsedFrontmatter,
  };
}

function validateSobaMetadata(
  rawSoba: unknown,
  path: string,
): { errors: SkillDiagnostic[]; warnings: SkillDiagnostic[]; metadata?: SobaSkillMetadata } {
  const errors: SkillDiagnostic[] = [];
  const warnings: SkillDiagnostic[] = [];

  if (rawSoba === undefined) {
    return { errors, warnings };
  }

  if (typeof rawSoba !== "object" || rawSoba === null || Array.isArray(rawSoba)) {
    errors.push({
      code: "INVALID_SOBA_METADATA",
      severity: "error",
      message: "soba metadata must be an object",
      path,
    });
    return { errors, warnings };
  }

  const raw = rawSoba as Record<string, unknown>;
  const metadata: SobaSkillMetadata = {};
  const knownFields = new Set([
    "version",
    "triggers",
    "required-sections",
    "disable-model-invocation",
    "memory-policy",
  ]);

  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      warnings.push({
        code: "UNKNOWN_SOBA_METADATA_FIELD",
        severity: "warning",
        message: `Unknown soba metadata field: ${key}`,
        path,
      });
    }
  }

  if (raw.version !== undefined) {
    if (!Number.isInteger(raw.version) || Number(raw.version) < 1) {
      errors.push({
        code: "INVALID_SOBA_METADATA",
        severity: "error",
        message: "soba.version must be a positive integer",
        path,
      });
    } else {
      metadata.version = raw.version as number;
    }
  }

  if (raw.triggers !== undefined) {
    if (!isStringArray(raw.triggers)) {
      errors.push({
        code: "INVALID_SOBA_METADATA",
        severity: "error",
        message: "soba.triggers must be an array of non-empty strings",
        path,
      });
    } else {
      metadata.triggers = raw.triggers;
    }
  }

  if (raw["required-sections"] !== undefined) {
    if (!isStringArray(raw["required-sections"])) {
      errors.push({
        code: "INVALID_SOBA_METADATA",
        severity: "error",
        message: "soba.required-sections must be an array of non-empty strings",
        path,
      });
    } else {
      metadata.requiredSections = raw["required-sections"];
    }
  }

  if (raw["disable-model-invocation"] !== undefined) {
    if (typeof raw["disable-model-invocation"] !== "boolean") {
      errors.push({
        code: "INVALID_SOBA_METADATA",
        severity: "error",
        message: "soba.disable-model-invocation must be a boolean",
        path,
      });
    } else {
      metadata.disableModelInvocation = raw["disable-model-invocation"];
    }
  }

  if (raw["memory-policy"] !== undefined) {
    if (
      typeof raw["memory-policy"] !== "string" ||
      !SOBA_MEMORY_POLICIES.has(raw["memory-policy"] as SobaSkillMemoryPolicy)
    ) {
      errors.push({
        code: "INVALID_SOBA_METADATA",
        severity: "error",
        message: "soba.memory-policy must be one of: none, read, write, read-write",
        path,
      });
    } else {
      metadata.memoryPolicy = raw["memory-policy"] as SobaSkillMemoryPolicy;
    }
  }

  return { errors, warnings, metadata };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validateRequiredSections(
  body: string,
  path: string,
  requiredSections: string[],
  bundled: boolean,
): SkillDiagnostic[] {
  const sections = new Set(
    body
      .split("\n")
      .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1])
      .filter((section): section is string => section !== undefined)
      .map(normalizeSectionName),
  );

  return requiredSections.filter((section) => !sections.has(normalizeSectionName(section))).map((section) => ({
    code: bundled ? "MISSING_BUNDLED_SKILL_SECTION" : "MISSING_REQUIRED_SKILL_SECTION",
    severity: "error",
    message: `${bundled ? "Bundled skill" : "Skill"} must contain section: ${section}`,
    path,
  }));
}

function normalizeSectionName(section: string): string {
  return section.trim().toLowerCase();
}

/**
 * Check for symlinks and path traversal attacks.
 */
function checkSymlinksAndTraversal(
  skillPath: string,
  files: SkillValidationFilesystem,
): { errors: SkillDiagnostic[]; warnings: SkillDiagnostic[] } {
  const errors: SkillDiagnostic[] = [];
  const warnings: SkillDiagnostic[] = [];
  const realSkillPath = files.realpath(skillPath);

  function walk(dir: string): void {
    const entries = files.listEntries(dir);

    for (const entry of entries) {
      const fullPath = files.join(dir, entry.name);
      const relativePath = files.relative(skillPath, fullPath);

      // Check for symlinks
      if (entry.kind === "symlink") {
        errors.push({
          code: "SYMLINK_DETECTED",
          severity: "error",
          message: `Skill payload contains symlink: ${relativePath}`,
          path: fullPath,
        });
        continue;
      }

      // Check for path traversal
      const realFullPath = files.realpath(fullPath);
      if (!realFullPath.startsWith(realSkillPath + "/") && realFullPath !== realSkillPath) {
        errors.push({
          code: "PATH_TRAVERSAL",
          severity: "error",
          message: `Path traversal detected: ${relativePath} escapes skill directory`,
          path: fullPath,
        });
        continue;
      }

      // Recurse into directories
      if (entry.kind === "directory") {
        walk(fullPath);
      }
    }
  }

  try {
    walk(skillPath);
  } catch (error) {
    errors.push({
      code: "WALK_ERROR",
      severity: "error",
      message: `Failed to walk skill directory: ${error}`,
      path: skillPath,
    });
  }

  return { errors, warnings };
}

/**
 * Compute content hash for a skill directory.
 * Hash is computed over sorted relative paths and file contents.
 */
export function computeSkillContentHash(skillPath: string, files: SkillValidationFilesystem): string {
  const hash = createHash("sha256");
  const realSkillPath = files.realpath(skillPath);
  const skillFiles: Array<{ relativePath: string; content: Uint8Array }> = [];

  function walk(dir: string): void {
    const entries = files.listEntries(dir);

    for (const entry of entries) {
      const fullPath = files.join(dir, entry.name);

      // Skip symlinks
      if (entry.kind === "symlink") {
        continue;
      }

      if (entry.kind === "directory") {
        walk(fullPath);
      } else if (entry.kind === "file") {
        const relativePath = files.relative(realSkillPath, fullPath);
        const content = files.readBytes(fullPath);
        skillFiles.push({ relativePath, content });
      }
    }
  }

  walk(realSkillPath);

  // Sort by relative path for deterministic hashing
  skillFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of skillFiles) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest("hex");
}
