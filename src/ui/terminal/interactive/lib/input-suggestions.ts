import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { RUNTIME_COMMANDS } from "../../../../application/command-service";
import type { I18n } from "../../../../core/i18n/i18n";
import type { TranslationKey } from "../../../../core/i18n/types";

export const VISIBLE_INPUT_SUGGESTIONS = 6;
const MAX_FILE_SUGGESTIONS = 200;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage"]);

export interface InputSuggestion {
  label: string;
  description: string;
  replacement: string;
  replacementStart: number;
  replacementEnd: number;
}

export function formatInputSuggestion(suggestion: InputSuggestion, selected: boolean): string {
  return `${selected ? "› " : "  "}${suggestion.label}  ${suggestion.description}`;
}

export function getVisibleInputSuggestions(
  suggestions: InputSuggestion[],
  selectedIndex: number,
  visibleCount = VISIBLE_INPUT_SUGGESTIONS,
): { suggestions: InputSuggestion[]; startIndex: number } {
  if (suggestions.length === 0 || visibleCount <= 0) {
    return { suggestions: [], startIndex: 0 };
  }

  const normalizedSelectedIndex = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));
  const maxStartIndex = Math.max(0, suggestions.length - visibleCount);
  const preferredStartIndex = normalizedSelectedIndex - visibleCount + 1;
  const startIndex = Math.max(0, Math.min(preferredStartIndex, maxStartIndex));

  return {
    suggestions: suggestions.slice(startIndex, startIndex + visibleCount),
    startIndex,
  };
}

export function getInputSuggestions(input: string, cursor: number, cwd: string, i18n?: I18n): InputSuggestion[] {
  if (typeof input !== "string") return [];
  const beforeCursor = input.slice(0, cursor);
  if (/^\/\S*$/.test(beforeCursor)) {
    const query = beforeCursor.toLowerCase();
    return RUNTIME_COMMANDS.filter((command) => command.surfaces.includes("tui") && command.name.startsWith(query))
      .map((command) => ({
        label: command.name,
        description: i18n?.t(command.descriptionKey as TranslationKey) ?? command.descriptionKey,
        replacement: `${command.name} `,
        replacementStart: 0,
        replacementEnd: cursor,
      }));
  }

  const mention = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
  if (!mention || mention.index === undefined) return [];

  const query = mention[1].toLowerCase();
  const replacementStart = mention.index + mention[0].indexOf("@");
  return listProjectFiles(cwd)
    .filter((path) => path.toLowerCase().includes(query))
    .slice(0, MAX_FILE_SUGGESTIONS)
    .map((path) => ({
      label: `@${path}`,
      description: i18n?.t("tui.suggestion.projectFile") ?? "Project file",
      replacement: `@${path} `,
      replacementStart,
      replacementEnd: cursor,
    }));
}

export function applyInputSuggestion(input: string, suggestion: InputSuggestion): { value: string; cursor: number } {
  const value =
    input.slice(0, suggestion.replacementStart) + suggestion.replacement + input.slice(suggestion.replacementEnd);
  return { value, cursor: suggestion.replacementStart + suggestion.replacement.length };
}

function listProjectFiles(cwd: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    if (files.length >= 5000) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(relative(cwd, absolutePath));
      if (files.length >= 5000) break;
    }
  };
  visit(cwd);
  return files.sort();
}
