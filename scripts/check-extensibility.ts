import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

interface Finding {
  rule: string;
  file: string;
  line: number;
  detail: string;
}

const root = resolve(import.meta.dir, "..");
const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root, absolute: true })].sort();
const findings: Finding[] = [];
const languageCatalogues = new Set([
  "src/engine/turn/assistant-text-lexicon.ts",
  "src/engine/verification/task-intent-lexicon.ts",
]);
const canonicalMemoryTypes = "src/kernel/memory/types.ts";
const canonicalToolSemantics = "src/kernel/tools/semantics.ts";
const providerBehaviorRoots = [
  "src/infrastructure/llm/",
  "src/composition/runtime/",
];

for (const absolutePath of files) {
  const file = relative(root, absolutePath);
  const content = readFileSync(absolutePath, "utf-8");
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    if (!languageCatalogues.has(file) && /[\p{Script=Cyrillic}\p{Script=Han}]/u.test(line)) {
      add("scattered-language-heuristic", file, index + 1, "Put runtime language markers in a configurable lexicon.");
    }
    if (
      /(?:===|!==)\s*["'`](?:en|ru|zh)["'`]|["'`](?:en|ru|zh)["'`]\s*(?:===|!==)/.test(line)
    ) {
      add("direct-locale-branch", file, index + 1, "Use isLocale() and the locale catalogue.");
    }
    if (
      /(?:\?\?|\|\|)\s*["'`](?:gpt|claude|deepseek|gemini|qwen|mistral)[^"'`]*["'`]/i.test(line)
    ) {
      add("vendor-model-default", file, index + 1, "Resolve the model from configuration or injected eval metadata.");
    }
    if (
      providerBehaviorRoots.some((prefix) => file.startsWith(prefix)) &&
      /(?:provider|model|baseUrl)\w*(?:\?\.)?(?:\.toLowerCase\(\))?\.(?:includes|startsWith|endsWith)\(\s*["']/i.test(line)
    ) {
      add(
        "name-derived-provider-behavior",
        file,
        index + 1,
        "Declare provider/model capabilities as metadata instead of parsing identity strings.",
      );
    }
    if (
      providerBehaviorRoots.some((prefix) => file.startsWith(prefix)) &&
      /(?:providerId|modelId|provider|model)\s*(?:===|!==)\s*["'`](?:deepseek|kimi|minimax|openrouter|gemini|qwen|mistral|claude|gpt)/i.test(line)
    ) {
      add(
        "vendor-identity-branch",
        file,
        index + 1,
        "Use declared capabilities or compatibility features instead of a vendor identity branch.",
      );
    }
    if (
      file !== canonicalMemoryTypes &&
      (/"decision"\s*,\s*"error_fix"\s*,\s*"discovery"/.test(line) ||
        /"critical"\s*,\s*"high"\s*,\s*"medium"\s*,\s*"low"/.test(line))
    ) {
      add("duplicated-memory-enum", file, index + 1, "Derive values from kernel memory constants.");
    }
  });

  if (file !== canonicalToolSemantics && (file.startsWith("src/engine/") || file.startsWith("src/kernel/"))) {
    for (const match of content.matchAll(/(?:new Set\s*\(|\.includes\s*\()\s*\[([\s\S]{0,500}?)\]/g)) {
      const names = [...match[1].matchAll(/["'`](read|inspect_file|ls|search_files|write|edit|bash)["'`]/g)]
        .map((nameMatch) => nameMatch[1]);
      if (new Set(names).size < 2) continue;
      add(
        "scattered-tool-semantics",
        file,
        lineNumber(content, match.index ?? 0),
        "Declare effects on ToolDefinition or use the canonical tool semantics catalogue.",
      );
    }
  }
}

if (findings.length > 0) {
  console.error("Extensibility audit failed:");
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.file}:${finding.line} — ${finding.detail}`);
  }
  process.exit(1);
}

console.log(`Extensibility audit passed (${files.length} source files).`);

function add(rule: string, file: string, line: number, detail: string): void {
  findings.push({ rule, file, line, detail });
}

function lineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}
