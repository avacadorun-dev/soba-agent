import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bugFix from "../../../../skills/bug-fix/SKILL.md" with { type: "text" };
import codeReview from "../../../../skills/code-review/SKILL.md" with { type: "text" };
import codebaseOrientation from "../../../../skills/codebase-orientation/SKILL.md" with { type: "text" };
import commitMessage from "../../../../skills/commit-message/SKILL.md" with { type: "text" };
import contextHandoff from "../../../../skills/context-handoff/SKILL.md" with { type: "text" };
import featureImplementation from "../../../../skills/feature-implementation/SKILL.md" with { type: "text" };
import fixUntilGreen from "../../../../skills/fix-until-green/SKILL.md" with { type: "text" };
import gitSummary from "../../../../skills/git-summary/SKILL.md" with { type: "text" };
import lintFix from "../../../../skills/lint-fix/SKILL.md" with { type: "text" };
import memoryCapture from "../../../../skills/memory-capture/SKILL.md" with { type: "text" };
import prDescription from "../../../../skills/pr-description/SKILL.md" with { type: "text" };
import testAuthoring from "../../../../skills/test-authoring/SKILL.md" with { type: "text" };
import versionBump from "../../../../skills/version-bump/SKILL.md" with { type: "text" };

export const EMBEDDED_BUNDLED_SKILLS: Readonly<Record<string, string>> = Object.freeze({
  "bug-fix": bugFix,
  "code-review": codeReview,
  "codebase-orientation": codebaseOrientation,
  "commit-message": commitMessage,
  "context-handoff": contextHandoff,
  "feature-implementation": featureImplementation,
  "fix-until-green": fixUntilGreen,
  "git-summary": gitSummary,
  "lint-fix": lintFix,
  "memory-capture": memoryCapture,
  "pr-description": prDescription,
  "test-authoring": testAuthoring,
  "version-bump": versionBump,
});

export interface BundledSkillsPathOptions {
  sobaDir: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

/** Resolve package assets first, then materialize compile-time embedded skills for standalone binaries. */
export function resolveBundledSkillsPath(options: BundledSkillsPathOptions): string {
  const environment = options.environment ?? process.env;
  const configuredPath = environment.SOBA_BUNDLED_SKILLS_PATH;
  if (configuredPath) {
    return configuredPath;
  }
  const packageRoot = environment.SOBA_PACKAGE_ROOT;
  const candidates = [packageRoot ? join(packageRoot, "skills") : undefined];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  const bundleHash = embeddedBundleHash();
  const cachePath = join(options.sobaDir, "bundled-skills", bundleHash);
  try {
    return materializeEmbeddedBundledSkills(cachePath);
  } catch {
    return materializeEmbeddedBundledSkills(join(tmpdir(), "soba-bundled-skills", bundleHash));
  }
}

export function materializeEmbeddedBundledSkills(targetRoot: string): string {
  mkdirSync(targetRoot, { recursive: true });

  for (const [name, content] of Object.entries(EMBEDDED_BUNDLED_SKILLS)) {
    const skillDir = join(targetRoot, name);
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });

    if (existsSync(skillPath) && readFileSync(skillPath, "utf8") === content) {
      continue;
    }

    const temporaryPath = `${skillPath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryPath, content, "utf8");
      renameSync(temporaryPath, skillPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  return targetRoot;
}

function embeddedBundleHash(): string {
  const hash = createHash("sha256");
  for (const [name, content] of Object.entries(EMBEDDED_BUNDLED_SKILLS).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
