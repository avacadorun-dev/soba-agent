import type { CapsuleRelevanceResult, MemoryCapsuleSourceState, MemoryDoctorCapsuleEntry, MemoryDoctorIssue, MemoryDoctorReport } from "../../kernel/memory/types";

export type MemoryCommandFormat = "text" | "markdown" | "json";

export interface MemoryCommandSource {
  doctor(): MemoryDoctorReport;
  getRelevantCapsules(query: { text: string; limit: number }): CapsuleRelevanceResult[];
  getMemoryDir(): string;
}

export interface MemoryExplainEntry {
  id: string;
  type: string;
  summary: string;
  priority: string;
  tags: string[];
  timestamp: string;
  score: number;
  sourceState: MemoryCapsuleSourceState;
  source?: Pick<MemoryDoctorCapsuleEntry, "sourcePath" | "sourceLines" | "sourceCommit" | "sourceConfidence" | "lastVerified" | "staleIfFilesChange">;
  issues: MemoryDoctorIssue[];
}

export interface MemoryExplainReport {
  query: string;
  generatedAt: string;
  memoryDir: string;
  safeToUse: boolean;
  matches: MemoryExplainEntry[];
}

export type MemoryCommandView =
  | { kind: "usage"; message: string }
  | { kind: "error"; message: string }
  | { kind: "doctor"; format: MemoryCommandFormat; report: MemoryDoctorReport }
  | { kind: "explain"; format: MemoryCommandFormat; report: MemoryExplainReport };

type ParsedMemoryArgs =
  | {
      kind: "parsed";
      subcommand: "doctor";
      format: MemoryCommandFormat;
    }
  | {
      kind: "parsed";
      subcommand: "explain";
      format: MemoryCommandFormat;
      query: string;
      limit: number;
    };

export function executeMemoryCommand(input: {
  args: string[];
  memory: MemoryCommandSource;
}): MemoryCommandView {
  const parsed = parseMemoryArgs(input.args);
  if (parsed.kind === "usage") return parsed;

  try {
    if (parsed.subcommand === "explain") {
      return {
        kind: "explain",
        format: parsed.format,
        report: explainMemory({
          memory: input.memory,
          query: parsed.query,
          limit: parsed.limit,
        }),
      };
    }

    return {
      kind: "doctor",
      format: parsed.format,
      report: input.memory.doctor(),
    };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderMemoryCommandView(view: MemoryCommandView): string {
  switch (view.kind) {
    case "usage":
      return view.message;
    case "error":
      return `Memory command error: ${view.message}`;
    case "doctor":
      return renderMemoryDoctorReport(view.report, view.format);
    case "explain":
      return renderMemoryExplainReport(view.report, view.format);
  }
}

export function memoryCommandExitCode(view: MemoryCommandView): number {
  if (view.kind === "doctor") return view.report.status === "healthy" ? 0 : 1;
  if (view.kind === "explain") return view.report.safeToUse && view.report.matches.length > 0 ? 0 : 1;
  return 1;
}

function parseMemoryArgs(args: string[]): ParsedMemoryArgs | Extract<MemoryCommandView, { kind: "usage" }> {
  let format: MemoryCommandFormat = "text";
  let subcommand: "doctor" | "explain" | undefined;
  let limit = 5;
  let limitProvided = false;
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "doctor" || arg === "explain") {
      if (subcommand) return usage("Only one memory subcommand can be provided.");
      subcommand = arg;
      continue;
    }
    if (arg === "--format") {
      const value = args[index + 1];
      if (!isMemoryCommandFormat(value)) {
        return usage(`Invalid --format value "${value ?? ""}".`);
      }
      format = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (!isMemoryCommandFormat(value)) {
        return usage(`Invalid --format value "${value}".`);
      }
      format = value;
      continue;
    }
    if (arg === "--limit") {
      const parsedLimit = parseLimit(args[index + 1]);
      if (parsedLimit === undefined) {
        return usage(`Invalid --limit value "${args[index + 1] ?? ""}".`);
      }
      limit = parsedLimit;
      limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = arg.slice("--limit=".length);
      const parsedLimit = parseLimit(value);
      if (parsedLimit === undefined) {
        return usage(`Invalid --limit value "${value}".`);
      }
      limit = parsedLimit;
      limitProvided = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return usage();
    }
    if (arg.startsWith("-")) {
      return usage(`Unknown memory flag "${arg}".`);
    }
    if (!subcommand) return usage(`Unknown memory subcommand "${arg}".`);
    if (subcommand === "doctor") return usage(`Unknown memory doctor argument "${arg}".`);
    queryParts.push(arg);
  }

  if (!subcommand) return usage("Missing memory subcommand.");
  if (subcommand === "doctor") {
    if (limitProvided) return usage("Memory doctor does not support --limit.");
    return { kind: "parsed", subcommand, format };
  }
  const query = queryParts.join(" ").trim();
  if (!query) return usage("Missing memory explain query.");
  return { kind: "parsed", subcommand, format, query, limit };
}

function usage(prefix?: string): Extract<MemoryCommandView, { kind: "usage" }> {
  const message = [
    prefix,
    "Usage:",
    "  soba memory doctor [--format text|markdown|json]",
    "  soba memory explain <query> [--limit n] [--format text|markdown|json]",
    "Examples:",
    "  soba memory doctor",
    "  soba memory doctor --format json",
    "  soba memory explain provider registry --format markdown",
  ].filter(Boolean).join("\n");
  return { kind: "usage", message };
}

function isMemoryCommandFormat(value: unknown): value is MemoryCommandFormat {
  return value === "text" || value === "markdown" || value === "json";
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return undefined;
  return parsed;
}

function explainMemory(input: {
  memory: MemoryCommandSource;
  query: string;
  limit: number;
}): MemoryExplainReport {
  const doctor = input.memory.doctor();
  const doctorCapsulesById = new Map(doctor.capsules.map((capsule) => [capsule.id, capsule]));
  const issuesByCapsuleId = new Map<string, MemoryDoctorIssue[]>();
  for (const issue of doctor.issues) {
    const current = issuesByCapsuleId.get(issue.target.id) ?? [];
    current.push(issue);
    issuesByCapsuleId.set(issue.target.id, current);
  }

  const matches = input.memory.getRelevantCapsules({ text: input.query, limit: input.limit }).map((result): MemoryExplainEntry => {
    const doctorCapsule = doctorCapsulesById.get(result.capsule.id);
    const sourceState = doctorCapsule?.sourceState ?? "untracked";
    const source = doctorCapsule ? capsuleSourceReceipt(doctorCapsule) : undefined;
    return {
      id: result.capsule.id,
      type: result.capsule.type,
      summary: result.capsule.summary,
      priority: result.capsule.priority,
      tags: result.capsule.tags,
      timestamp: result.capsule.context.timestamp,
      score: result.score,
      sourceState,
      ...(source ? { source } : {}),
      issues: issuesByCapsuleId.get(result.capsule.id) ?? [],
    };
  });

  return {
    query: input.query,
    generatedAt: doctor.generatedAt,
    memoryDir: doctor.memoryDir,
    safeToUse: matches.length > 0 && matches.every((match) => match.sourceState === "fresh" || match.sourceState === "untracked"),
    matches,
  };
}

function capsuleSourceReceipt(capsule: MemoryDoctorCapsuleEntry): MemoryExplainEntry["source"] | undefined {
  const source = {
    ...(capsule.sourcePath ? { sourcePath: capsule.sourcePath } : {}),
    ...(capsule.sourceLines ? { sourceLines: capsule.sourceLines } : {}),
    ...(capsule.sourceCommit ? { sourceCommit: capsule.sourceCommit } : {}),
    ...(capsule.sourceConfidence ? { sourceConfidence: capsule.sourceConfidence } : {}),
    ...(capsule.lastVerified ? { lastVerified: capsule.lastVerified } : {}),
    ...(capsule.staleIfFilesChange ? { staleIfFilesChange: capsule.staleIfFilesChange } : {}),
  };
  return Object.keys(source).length > 0 ? source : undefined;
}

function renderMemoryDoctorReport(report: MemoryDoctorReport, format: MemoryCommandFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return renderMemoryDoctorMarkdown(report);
  return renderMemoryDoctorText(report);
}

function renderMemoryDoctorText(report: MemoryDoctorReport): string {
  const lines = [
    "SOBA Memory Doctor",
    `Status: ${report.status}`,
    `Generated: ${report.generatedAt}`,
    `Memory: ${report.memoryDir}`,
    `Knowledge: ${report.summary.knowledgeFiles} files, ${report.summary.knowledgeTokens} estimated tokens`,
    `Capsules: total=${report.summary.capsules} fresh=${report.summary.freshCapsules} stale=${report.summary.staleCapsules} broken=${report.summary.brokenCapsules} untracked=${report.summary.untrackedCapsules}`,
    `Issues: ${report.summary.issues}`,
  ];

  appendTextIssues(lines, report.issues);
  return lines.join("\n");
}

function renderMemoryDoctorMarkdown(report: MemoryDoctorReport): string {
  return [
    "# SOBA Memory Doctor",
    "",
    `- Status: \`${report.status}\``,
    `- Generated: ${report.generatedAt}`,
    `- Memory: \`${report.memoryDir}\``,
    `- Knowledge: ${report.summary.knowledgeFiles} files, ${report.summary.knowledgeTokens} estimated tokens`,
    `- Capsules: total=${report.summary.capsules}, fresh=${report.summary.freshCapsules}, stale=${report.summary.staleCapsules}, broken=${report.summary.brokenCapsules}, untracked=${report.summary.untrackedCapsules}`,
    `- Issues: ${report.summary.issues}`,
    "",
    "## Issues",
    report.issues.length === 0 ? "- none" : report.issues.map(markdownIssue).join("\n"),
    "",
  ].join("\n");
}

function renderMemoryExplainReport(report: MemoryExplainReport, format: MemoryCommandFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return renderMemoryExplainMarkdown(report);
  return renderMemoryExplainText(report);
}

function renderMemoryExplainText(report: MemoryExplainReport): string {
  const lines = [
    "SOBA Memory Explanation",
    `Query: ${report.query}`,
    `Generated: ${report.generatedAt}`,
    `Memory: ${report.memoryDir}`,
    `Safe to use: ${report.safeToUse ? "yes" : "no"}`,
    `Matches: ${report.matches.length}`,
  ];

  if (report.matches.length === 0) {
    lines.push("No matching memory capsules found.");
    return lines.join("\n");
  }

  for (const match of report.matches) {
    lines.push("");
    lines.push(`- ${match.id} score=${match.score} state=${match.sourceState} priority=${match.priority} type=${match.type}`);
    lines.push(`  Summary: ${match.summary}`);
    lines.push(`  Tags: ${match.tags.length > 0 ? match.tags.join(", ") : "none"}`);
    appendSourceLines(lines, match.source, "  ");
    appendTextIssues(lines, match.issues);
  }
  return lines.join("\n");
}

function renderMemoryExplainMarkdown(report: MemoryExplainReport): string {
  const lines = [
    "# SOBA Memory Explanation",
    "",
    `- Query: \`${report.query}\``,
    `- Generated: ${report.generatedAt}`,
    `- Memory: \`${report.memoryDir}\``,
    `- Safe to use: \`${report.safeToUse ? "yes" : "no"}\``,
    `- Matches: ${report.matches.length}`,
    "",
  ];

  if (report.matches.length === 0) {
    lines.push("No matching memory capsules found.");
    lines.push("");
    return lines.join("\n");
  }

  for (const match of report.matches) {
    lines.push(`## ${match.id}`);
    lines.push("");
    lines.push(`- Score: ${match.score}`);
    lines.push(`- Source state: \`${match.sourceState}\``);
    lines.push(`- Type: \`${match.type}\``);
    lines.push(`- Priority: \`${match.priority}\``);
    lines.push(`- Tags: ${match.tags.length > 0 ? match.tags.map((tag) => `\`${tag}\``).join(", ") : "none"}`);
    lines.push(`- Summary: ${match.summary}`);
    appendMarkdownSourceLines(lines, match.source);
    lines.push("- Issues:");
    lines.push(match.issues.length === 0 ? "  - none" : match.issues.map((issue) => `  ${markdownIssue(issue)}`).join("\n"));
    lines.push("");
  }
  return lines.join("\n");
}

function appendTextIssues(lines: string[], issues: MemoryDoctorIssue[]): void {
  if (issues.length === 0) {
    lines.push("Issue details: none");
    return;
  }

  lines.push("Issue details:");
  for (const issue of issues) {
    const path = issue.path ? ` path=${issue.path}` : "";
    lines.push(`- ${issue.severity} ${issue.code} ${issue.target.id}:${path} ${issue.message}`);
  }
}

function appendSourceLines(lines: string[], source: MemoryExplainEntry["source"], prefix: string): void {
  if (!source) {
    lines.push(`${prefix}Source: none`);
    return;
  }
  lines.push(`${prefix}Source: ${source.sourcePath ?? "none"}`);
  if (source.sourceLines) lines.push(`${prefix}Lines: ${source.sourceLines[0]}-${source.sourceLines[1]}`);
  if (source.sourceCommit) lines.push(`${prefix}Commit: ${source.sourceCommit}`);
  if (source.sourceConfidence) lines.push(`${prefix}Confidence: ${source.sourceConfidence}`);
  if (source.lastVerified) lines.push(`${prefix}Last verified: ${source.lastVerified}`);
  if (source.staleIfFilesChange) lines.push(`${prefix}Stale if files change: ${source.staleIfFilesChange.join(", ")}`);
}

function appendMarkdownSourceLines(lines: string[], source: MemoryExplainEntry["source"]): void {
  if (!source) {
    lines.push("- Source: none");
    return;
  }
  lines.push(`- Source: ${source.sourcePath ? `\`${source.sourcePath}\`` : "none"}`);
  if (source.sourceLines) lines.push(`- Lines: ${source.sourceLines[0]}-${source.sourceLines[1]}`);
  if (source.sourceCommit) lines.push(`- Commit: \`${source.sourceCommit}\``);
  if (source.sourceConfidence) lines.push(`- Confidence: \`${source.sourceConfidence}\``);
  if (source.lastVerified) lines.push(`- Last verified: ${source.lastVerified}`);
  if (source.staleIfFilesChange) lines.push(`- Stale if files change: ${source.staleIfFilesChange.map((path) => `\`${path}\``).join(", ")}`);
}

function markdownIssue(issue: MemoryDoctorIssue): string {
  const path = issue.path ? `, path=\`${issue.path}\`` : "";
  return `- \`${issue.severity}\` \`${issue.code}\` capsule=\`${issue.target.id}\`${path}: ${issue.message}`;
}
