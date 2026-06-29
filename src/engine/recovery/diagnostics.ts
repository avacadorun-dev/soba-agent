import type { DiagnosticReport, DiagnosticTool, ParsedDiagnostic } from "./types";

export function parseVerificationDiagnostics(command: string, output: string): DiagnosticReport {
  const tool = detectDiagnosticTool(command, output);
  const diagnostics = parseDiagnosticsForTool(tool, output);
  const summary = diagnostics[0]?.message ?? firstUsefulLine(output) ?? "Verification command failed without a readable diagnostic.";

  return {
    tool,
    command,
    summary,
    diagnostics,
    fingerprint: diagnosticFingerprint(tool, diagnostics, summary),
  };
}

export function detectDiagnosticTool(command: string, output = ""): DiagnosticTool {
  const normalized = `${command}\n${output}`.toLowerCase();
  if (/\bbiome\b|\blint\b/.test(normalized)) return "biome";
  if (/\btsc\b|\btypecheck\b|error\s+ts\d+/i.test(normalized)) return "typescript";
  if (/\bbuild\b|build failed|failed to build/i.test(normalized)) return "build";
  if (/\bbun\s+test\b|\btest\b|\(fail\)/i.test(normalized)) return "bun-test";
  return "unknown";
}

function parseDiagnosticsForTool(tool: DiagnosticTool, output: string): ParsedDiagnostic[] {
  switch (tool) {
    case "typescript":
      return parseTypeScriptDiagnostics(output);
    case "biome":
      return parseBiomeDiagnostics(output);
    case "bun-test":
      return parseBunTestDiagnostics(output);
    case "build":
      return parseBuildDiagnostics(output);
    case "unknown":
      return parseUnknownDiagnostics(output);
  }
}

function parseTypeScriptDiagnostics(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const pattern = /(?<file>[^\s:(]+)\((?<line>\d+),(?<column>\d+)\):\s+error\s+(?<code>TS\d+):\s+(?<message>.+)/g;
  let match = pattern.exec(output);
  while (match) {
    diagnostics.push({
      tool: "typescript",
      file: match.groups?.file,
      line: toNumber(match.groups?.line),
      column: toNumber(match.groups?.column),
      code: match.groups?.code,
      message: match.groups?.message?.trim() ?? "TypeScript error",
    });
    match = pattern.exec(output);
  }
  return diagnostics.length > 0 ? diagnostics : parseUnknownDiagnostics(output, "typescript");
}

function parseBiomeDiagnostics(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const pattern = /(?<file>[^\s:]+\.(?:ts|tsx|js|jsx|json|md)):(?<line>\d+):(?<column>\d+)\s+(?<message>.+)/g;
  let match = pattern.exec(output);
  while (match) {
    diagnostics.push({
      tool: "biome",
      file: match.groups?.file,
      line: toNumber(match.groups?.line),
      column: toNumber(match.groups?.column),
      message: match.groups?.message?.trim() ?? "Biome diagnostic",
    });
    match = pattern.exec(output);
  }
  return diagnostics.length > 0 ? diagnostics : parseUnknownDiagnostics(output, "biome");
}

function parseBunTestDiagnostics(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes("(fail)") || /\b(?:expect|Expected|Received|error:)\b/.test(trimmed)) {
      diagnostics.push({ tool: "bun-test", message: trimmed });
    }
  }
  return diagnostics.length > 0 ? diagnostics.slice(0, 5) : parseUnknownDiagnostics(output, "bun-test");
}

function parseBuildDiagnostics(output: string): ParsedDiagnostic[] {
  const diagnostics = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /(?:error|failed|exception)/i.test(line))
    .slice(0, 5)
    .map((message): ParsedDiagnostic => ({ tool: "build", message }));

  return diagnostics.length > 0 ? diagnostics : parseUnknownDiagnostics(output, "build");
}

function parseUnknownDiagnostics(output: string, tool: DiagnosticTool = "unknown"): ParsedDiagnostic[] {
  return [{ tool, message: firstUsefulLine(output) ?? "Unknown verification failure" }];
}

function firstUsefulLine(output: string): string | null {
  return output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function diagnosticFingerprint(tool: DiagnosticTool, diagnostics: ParsedDiagnostic[], summary: string): string {
  const basis = diagnostics.length > 0 ? diagnostics : [{ tool, message: summary }];
  return JSON.stringify(
    basis.slice(0, 3).map((diagnostic) => ({
      tool: diagnostic.tool,
      file: diagnostic.file ?? "",
      code: diagnostic.code ?? "",
      message: normalize(diagnostic.message),
    })),
  );
}

function normalize(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
