import type { EvidenceChangedFileOperation } from "./evidence-bundle";

export interface EvidenceDiffFileInput {
  path: string;
  operation: EvidenceChangedFileOperation;
  oldPath?: string;
  oldText?: string | null;
  newText?: string | null;
  added?: number;
  removed?: number;
  mutationIds?: string[];
}

export interface EvidenceDiffFileSummary {
  path: string;
  operation: EvidenceChangedFileOperation;
  oldPath?: string;
  added: number;
  removed: number;
  mutationIds: string[];
  inlineDiff?: string;
  truncated: boolean;
}

export interface EvidenceDiffSummary {
  files: EvidenceDiffFileSummary[];
  fileCount: number;
  added: number;
  removed: number;
  truncated: boolean;
}

export interface BuildEvidenceDiffSummaryInput {
  files: EvidenceDiffFileInput[];
  maxInlineDiffChars?: number;
}

const DEFAULT_MAX_INLINE_DIFF_CHARS = 12_000;

export function buildEvidenceDiffSummary(input: BuildEvidenceDiffSummaryInput): EvidenceDiffSummary {
  const maxInlineDiffChars = normalizeMaxInlineDiffChars(input.maxInlineDiffChars);
  const files = input.files.map((file) => buildFileSummary(file, maxInlineDiffChars));

  return {
    files,
    fileCount: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    truncated: files.some((file) => file.truncated),
  };
}

function buildFileSummary(file: EvidenceDiffFileInput, maxInlineDiffChars: number): EvidenceDiffFileSummary {
  const oldText = file.oldText ?? null;
  const newText = file.newText ?? null;
  const inline = buildInlineDiff(file.operation, oldText, newText);
  const truncatedInline = inline ? truncateInlineDiff(inline, maxInlineDiffChars) : { text: undefined, truncated: false };
  const stats = diffStats(file, oldText, newText);

  return {
    path: file.path,
    operation: file.operation,
    oldPath: file.oldPath,
    added: stats.added,
    removed: stats.removed,
    mutationIds: file.mutationIds?.slice() ?? [],
    inlineDiff: truncatedInline.text,
    truncated: truncatedInline.truncated,
  };
}

function buildInlineDiff(
  operation: EvidenceChangedFileOperation,
  oldText: string | null,
  newText: string | null,
): string | undefined {
  if (oldText === null && newText === null) return undefined;
  if (operation === "created" || oldText === null) {
    return prefixLines("+", newText ?? "");
  }
  if (operation === "deleted" || newText === null) {
    return prefixLines("-", oldText);
  }
  if (oldText === newText) return undefined;
  return [prefixLines("-", oldText), prefixLines("+", newText)].filter(Boolean).join("\n");
}

function diffStats(file: EvidenceDiffFileInput, oldText: string | null, newText: string | null): { added: number; removed: number } {
  if (file.added !== undefined || file.removed !== undefined) {
    return {
      added: Math.max(0, Math.floor(file.added ?? 0)),
      removed: Math.max(0, Math.floor(file.removed ?? 0)),
    };
  }

  switch (file.operation) {
    case "created":
      return { added: countLines(newText ?? ""), removed: 0 };
    case "deleted":
      return { added: 0, removed: countLines(oldText ?? "") };
    case "renamed":
      return {
        added: oldText !== null && newText !== null && oldText !== newText ? countLines(newText) : 0,
        removed: oldText !== null && newText !== null && oldText !== newText ? countLines(oldText) : 0,
      };
    case "modified":
    case "unknown":
      return {
        added: newText !== null ? countLines(newText) : 0,
        removed: oldText !== null ? countLines(oldText) : 0,
      };
  }
}

function prefixLines(prefix: "+" | "-", text: string): string {
  const lines = splitLines(text);
  if (lines.length === 0) return `${prefix}`;
  return lines.map((line) => `${prefix}${line}`).join("\n");
}

function truncateInlineDiff(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n[Diff truncated]`,
    truncated: true,
  };
}

function countLines(text: string): number {
  return splitLines(text).length;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function normalizeMaxInlineDiffChars(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_INLINE_DIFF_CHARS;
  return Math.max(200, Math.floor(value));
}
