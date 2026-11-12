/**
 * Loads known-failure exception declarations from a repository policy file.
 *
 * The policy file lives at `.soba/known-failures.json` in the project root:
 *
 * ```json
 * [
 *   {
 *     "declaredBy": "repo_policy",
 *     "command": "bun test",
 *     "failingTestIds": ["tests/foreign/workstream.test.ts"],
 *     "files": ["tests/foreign/fixture.json"],
 *     "note": "Owned by another workstream; tracked in issue #123."
 *   }
 * ]
 * ```
 *
 * The agent can cite these declarations but can never create them; a
 * declaration never covers a file the agent changed in the current session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnownFailureDeclaration } from "../../engine/verification/verification-baseline";

const POLICY_FILE = join(".soba", "known-failures.json");

export function knownFailuresPolicyPath(root: string): string {
  return join(root, POLICY_FILE);
}

export function parseKnownFailures(raw: unknown): { declarations: KnownFailureDeclaration[]; warnings: string[] } {
  const declarations: KnownFailureDeclaration[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(raw)) {
    warnings.push(`${POLICY_FILE} must be a JSON array of declarations; got ${typeof raw}.`);
    return { declarations, warnings };
  }

  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      warnings.push(`${POLICY_FILE}[${index}]: declaration must be an object; skipped.`);
      return;
    }
    const record = item as Record<string, unknown>;
    const declaredBy = record.declaredBy;
    if (declaredBy !== "user" && declaredBy !== "repo_policy") {
      warnings.push(
        `${POLICY_FILE}[${index}]: "declaredBy" must be "user" or "repo_policy"; got ${JSON.stringify(declaredBy)}. Skipped.`,
      );
      return;
    }
    if (record.command !== undefined && typeof record.command !== "string") {
      warnings.push(`${POLICY_FILE}[${index}]: "command" must be a string; skipped.`);
      return;
    }
    if (record.failingTestIds !== undefined && !isStringArray(record.failingTestIds)) {
      warnings.push(`${POLICY_FILE}[${index}]: "failingTestIds" must be an array of strings; skipped.`);
      return;
    }
    if (record.files !== undefined && !isStringArray(record.files)) {
      warnings.push(`${POLICY_FILE}[${index}]: "files" must be an array of strings; skipped.`);
      return;
    }
    declarations.push({
      declaredBy,
      ...(typeof record.command === "string" ? { command: record.command } : {}),
      ...(isStringArray(record.failingTestIds) ? { failingTestIds: record.failingTestIds } : {}),
      ...(isStringArray(record.files) ? { files: record.files } : {}),
      ...(typeof record.note === "string" ? { note: record.note } : {}),
    });
  });

  return { declarations, warnings };
}

export function loadKnownFailures(root: string): { declarations: KnownFailureDeclaration[]; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(knownFailuresPolicyPath(root), "utf-8"));
  } catch {
    return { declarations: [], warnings: [] };
  }
  return parseKnownFailures(raw);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
