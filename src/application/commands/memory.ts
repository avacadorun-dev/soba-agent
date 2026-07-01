import type { MemoryDoctorIssue, MemoryDoctorReport } from "../../kernel/memory/types";

export type MemoryCommandFormat = "text" | "markdown" | "json";

export interface MemoryDoctorSource {
  doctor(): MemoryDoctorReport;
  getMemoryDir(): string;
}

export type MemoryCommandView =
  | { kind: "usage"; message: string }
  | { kind: "error"; message: string }
  | { kind: "report"; format: MemoryCommandFormat; report: MemoryDoctorReport };

interface ParsedMemoryArgs {
  kind: "parsed";
  subcommand: "doctor";
  format: MemoryCommandFormat;
}

export function executeMemoryCommand(input: {
  args: string[];
  memory: MemoryDoctorSource;
}): MemoryCommandView {
  const parsed = parseMemoryArgs(input.args);
  if (parsed.kind === "usage") return parsed;

  try {
    return {
      kind: "report",
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
      return `Memory doctor error: ${view.message}`;
    case "report":
      return renderMemoryDoctorReport(view.report, view.format);
  }
}

export function memoryCommandExitCode(view: MemoryCommandView): number {
  if (view.kind !== "report") return 1;
  return view.report.status === "healthy" ? 0 : 1;
}

function parseMemoryArgs(args: string[]): ParsedMemoryArgs | Extract<MemoryCommandView, { kind: "usage" }> {
  let format: MemoryCommandFormat = "text";
  let subcommand: "doctor" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "doctor") {
      if (subcommand) return usage("Only one memory subcommand can be provided.");
      subcommand = "doctor";
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
    if (arg === "--help" || arg === "-h") {
      return usage();
    }
    if (arg.startsWith("-")) {
      return usage(`Unknown memory flag "${arg}".`);
    }
    return usage(`Unknown memory subcommand "${arg}".`);
  }

  if (!subcommand) return usage("Missing memory subcommand.");
  return { kind: "parsed", subcommand, format };
}

function usage(prefix?: string): Extract<MemoryCommandView, { kind: "usage" }> {
  const message = [
    prefix,
    "Usage: soba memory doctor [--format text|markdown|json]",
    "Examples:",
    "  soba memory doctor",
    "  soba memory doctor --format json",
    "  soba memory doctor --format markdown",
  ].filter(Boolean).join("\n");
  return { kind: "usage", message };
}

function isMemoryCommandFormat(value: unknown): value is MemoryCommandFormat {
  return value === "text" || value === "markdown" || value === "json";
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

function markdownIssue(issue: MemoryDoctorIssue): string {
  const path = issue.path ? `, path=\`${issue.path}\`` : "";
  return `- \`${issue.severity}\` \`${issue.code}\` capsule=\`${issue.target.id}\`${path}: ${issue.message}`;
}
