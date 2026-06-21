/**
 * Edit tool.
 *
 * Makes precise text replacements in a file using exact string matching (oldText → newText).
 * Supports multiple disjoint edits in a single call.
 * All edits are matched against the original file, not incrementally.
 * Edits must not overlap.
 */

import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyEditError, classifyFileSystemError, createToolErrorResult } from "./errors";
import { isProjectMemoryPath, PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION } from "./protected-paths";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

// ─── Types ───

export interface EditEntry {
  /** Exact text to find and replace. Must be unique in the file. */
  oldText: string;
  /** Replacement text */
  newText: string;
}

export interface EditArgs {
  path: string;
  edits: EditEntry[];
}

// ─── Helpers ───

/**
 * Find all occurrences of oldText in content.
 * Returns array of { start: byte offset, end: byte offset }.
 */
function findAllOccurrences(content: string, oldText: string): Array<{ start: number; end: number }> {
  const occurrences: Array<{ start: number; end: number }> = [];
  let pos = 0;

  while (pos < content.length) {
    const idx = content.indexOf(oldText, pos);
    if (idx === -1) break;
    occurrences.push({ start: idx, end: idx + oldText.length });
    pos = idx + 1;
  }

  return occurrences;
}

/**
 * Check if two ranges overlap.
 */
function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Apply edits to the file content.
 * Throws descriptive errors for:
 * - oldText not found
 * - oldText not unique
 * - Overlapping edits
 * - Empty oldText
 */
function applyEdits(originalContent: string, edits: EditEntry[]): string {
  if (edits.length === 0) {
    throw new Error("Edit tool input is invalid: edits must contain at least one replacement.");
  }

  // Validate: find all occurrences for each edit
  const occurrencesPerEdit: Array<{
    edit: EditEntry;
    index: number;
    occurrences: Array<{ start: number; end: number }>;
  }> = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    if (!edit.oldText) {
      throw new Error(`Edit ${i + 1}: oldText cannot be empty.`);
    }

    const occurrences = findAllOccurrences(originalContent, edit.oldText);

    if (occurrences.length === 0) {
      // Show context for debugging
      const snippet = originalContent.length > 200 ? `${originalContent.slice(0, 200)}...` : originalContent;
      throw new Error(
        `Edit ${i + 1}: oldText not found in file.\n` +
          `oldText: "${edit.oldText.slice(0, 100)}${edit.oldText.length > 100 ? "..." : ""}"\n` +
          `File preview:\n${snippet}`,
      );
    }

    if (occurrences.length > 1) {
      throw new Error(
        `Edit ${i + 1}: oldText is not unique — found ${occurrences.length} occurrences in file. ` +
          `oldText must match exactly one location. Make it more specific.`,
      );
    }

    occurrencesPerEdit.push({ edit, index: i, occurrences });
  }

  // Validate: no overlapping edits
  for (let i = 0; i < occurrencesPerEdit.length; i++) {
    for (let j = i + 1; j < occurrencesPerEdit.length; j++) {
      const a = occurrencesPerEdit[i].occurrences[0];
      const b = occurrencesPerEdit[j].occurrences[0];
      if (rangesOverlap(a, b)) {
        throw new Error(
          `Edits ${i + 1} and ${j + 1} overlap. ` +
            `Edit ${i + 1} range: [${a.start}, ${a.end}), ` +
            `Edit ${j + 1} range: [${b.start}, ${b.end}). ` +
            `Merge these edits into one.`,
        );
      }
    }
  }

  // Sort edits by start position (descending) to apply from end to start
  const sorted = [...occurrencesPerEdit].sort((a, b) => b.occurrences[0].start - a.occurrences[0].start);

  // Apply edits
  let result = originalContent;
  for (const { edit, occurrences } of sorted) {
    const { start, end } = occurrences[0];
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }

  return result;
}

/**
 * Generate a diff summary. Highlighting is applied by the TUI renderer
 * (red background for -, green background for +).
 */
function generateDiffSummary(_original: string, _modified: string, edits: EditEntry[]): string {
  const lines: string[] = [];
  lines.push(`Applied ${edits.length} edit(s):`);
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const previewLen = 60;
    const oldPreview = edit.oldText.length > previewLen ? `${edit.oldText.slice(0, previewLen)}...` : edit.oldText;
    const newPreview = edit.newText.length > previewLen ? `${edit.newText.slice(0, previewLen)}...` : edit.newText;
    lines.push(`  ${i + 1}. - "${oldPreview}"`);
    lines.push(`     + "${newPreview}"`);
  }
  return lines.join("\n");
}

// ─── Tool Definition ───

export const editTool: ToolDefinition<EditArgs> = {
  name: "edit",
  label: "edit",
  description:
    "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead. Do not include large unchanged regions just to connect distant changes.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit (relative or absolute)",
      },
      edits: {
        type: "array",
        description:
          "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
        items: {
          type: "object",
          properties: {
            oldText: {
              type: "string",
              description:
                "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
            },
            newText: {
              type: "string",
              description: "Replacement text for this targeted edit.",
            },
          },
          required: ["oldText", "newText"],
          additionalProperties: false,
        },
      },
    },
    required: ["path", "edits"],
  },

  toolType: "function",

  prepareArgs(raw: Record<string, unknown>): EditArgs {
    let { edits } = raw;

    // Some models send edits as a JSON string instead of an array
    if (typeof edits === "string") {
      try {
        edits = JSON.parse(edits);
      } catch {
        // Leave as-is; validation will catch it
      }
    }

    // Legacy format: oldText + newText as top-level fields
    if (!Array.isArray(edits) && typeof raw.oldText === "string" && typeof raw.newText === "string") {
      edits = [{ oldText: raw.oldText, newText: raw.newText }];
    }

    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error("Edit tool input is invalid: edits must contain at least one replacement.");
    }

    return {
      path: raw.path as string,
      edits: edits as EditEntry[],
    };
  },

  async execute(args: EditArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    const absolutePath = resolve(context.cwd, args.path);
    if (isProjectMemoryPath(context.cwd, args.path)) {
      return createToolErrorResult({
        code: "project_memory_direct_edit_denied",
        category: "validation",
        message: `Direct edits to project memory store files are not allowed: ${args.path}`,
        nextAction: PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION,
        fingerprint: "validation:project_memory_direct_edit_denied",
      });
    }

    // Check if file exists and is writable
    try {
      await access(absolutePath, constants.R_OK | constants.W_OK);
    } catch (error) {
      const classification = classifyFileSystemError(error, "edit");
      return createToolErrorResult({
        ...classification,
        message: `Cannot edit file "${args.path}" — file does not exist or is not writable.`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }

    if (signal?.aborted) {
      return createToolErrorResult({
        code: "edit_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Do not retry automatically; inspect the file before attempting another edit.",
        fingerprint: "aborted:edit_aborted",
      });
    }

    try {
      // Read original file
      const buffer = await readFile(absolutePath);
      const originalContent = buffer.toString("utf-8");

      if (signal?.aborted) {
        return createToolErrorResult({
          code: "edit_aborted",
          category: "aborted",
          message: "Operation aborted.",
          nextAction: "Do not retry automatically; inspect the file before attempting another edit.",
          fingerprint: "aborted:edit_aborted",
        });
      }

      // Apply edits
      const modifiedContent = applyEdits(originalContent, args.edits);

      // Write back
      await writeFile(absolutePath, modifiedContent, "utf-8");

      // Generate summary
      const summary = generateDiffSummary(originalContent, modifiedContent, args.edits);

      return {
        content: [
          {
            type: "text",
            text: `Successfully applied ${args.edits.length} edit(s) to ${args.path}.\n\n${summary}`,
          },
        ],
        isError: false,
        details: { editCount: args.edits.length },
      };
    } catch (error) {
      const classification = classifyEditError(error);
      return createToolErrorResult({
        ...classification,
        message: `Error editing file "${args.path}": ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }
  },
};
