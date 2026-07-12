#!/usr/bin/env bun
/**
 * doc-scout/scripts/validate.ts
 *
 * Валидирует документацию (.md) на соответствие реальному коду.
 * Проверяет CLI-флаги, env-переменные, slash-команды, subcommand'ы,
 * конфиг-ключи, permission-моды, хоткеи, special-syntax.
 *
 * Использование:
 *   bun run .soba/skills/doc-scout/scripts/validate.ts --file docs-site/content/docs/security.ru.mdx
 *   bun run .soba/skills/doc-scout/scripts/validate.ts --dir docs-site/content/docs/ --lang ru
 *   bun run .soba/skills/doc-scout/scripts/validate.ts --file ... --json
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { $ } from "bun";

// ─── Types ───

type ClaimKind =
  | "cli-flag"
  | "env-var"
  | "slash-command"
  | "subcommand"
  | "config-key"
  | "permission-mode"
  | "hotkey"
  | "special-syntax";

interface Claim {
  kind: ClaimKind;
  text: string; // raw text from doc
  value: string; // normalized value to verify
  line: number; // line in doc
}

type Verdict = "confirmed" | "fabricated" | "unknown";

interface VerifiedClaim extends Claim {
  verdict: Verdict;
  sourceHint: string; // where found / not found
}

interface MissingItem {
  category: string;
  item: string;
  sourceLocation: string;
  reason: string;
}

interface Report {
  file: string;
  totalClaims: number;
  confirmed: number;
  fabricated: number;
  unknown: number;
  claims: VerifiedClaim[];
  missingFromDocs: MissingItem[];
}

type DocsLang = "en" | "ru" | "zh";

// ─── CLI Args ───

function parseArgs(): { files: string[]; json: boolean; lang?: DocsLang } {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let json = false;
  let lang: DocsLang | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--file" || args[i] === "--dir") && args[i + 1]) {
      files.push(args[i + 1]);
      i++;
    } else if (args[i] === "--lang" && args[i + 1]) {
      const next = args[i + 1];
      if (next !== "en" && next !== "ru" && next !== "zh") {
        throw new Error("--lang must be one of: en, ru, zh");
      }
      lang = next;
      i++;
    } else if (args[i] === "--json") {
      json = true;
    } else if (!args[i].startsWith("-")) {
      files.push(args[i]);
    }
  }

  return { files, json, lang };
}

// ─── Source Code Facts (pre-scanned) ───

// These are facts extracted from actual source code.
// They serve as the ground truth against which doc claims are checked.

const SOURCE_FACTS = {
  cliFlags: new Set([
    "help",
    "version",
    "lang",
    "theme",
    "model",
    "provider",
    "no-session",
    "no-auto-compact",
    "debug",
    "max-output-tokens",
    "max-tokens",
    "max-completion-tokens",
    "max-agent-iterations",
    "max-stalled-iterations",
    "max-run-minutes",
    "bash-max-timeout-seconds",
    "no-color",
    "no-stream",
    "stream",
    "budget",
    "context-window",
    "continue",
    "resume",
    "session",
    "api-key",
    "base-url",
    "i",
    "interactive",
    "sound-enabled",
    "no-sound",
    "sound-volume",
    "sound-repeat",
    "name",
    "api-key-env",
    "adapter",
    "default-model",
    "from-file",
    "set-active",
    "yes",
    "check",
    "skip-provider",
    "skip-trust",
    "skip-mcp",
    "last",
    "format",
    "proof",
  ]),

  envVars: new Set([
    "SOBA_LANG",
    "SOBA_THEME",
    "SOBA_BASE_URL",
    "SOBA_API_KEY",
    "SOBA_MODEL",
    "SOBA_MAX_OUTPUT_TOKENS",
    "SOBA_MAX_TOKENS",
    "SOBA_CONTEXT_WINDOW",
    "SOBA_MAX_AGENT_ITERATIONS",
    "SOBA_MAX_STALLED_ITERATIONS",
    "SOBA_MAX_RUN_MINUTES",
    "SOBA_BASH_MAX_TIMEOUT_SECONDS",
    "SOBA_ADAPTIVE_LOOP",
    "SOBA_DEBUG",
    "SOBA_MAX_COMPLETION_TOKENS",
    "SOBA_AUTO_COMPACT",
    "SOBA_SOUND_ENABLED",
    "SOBA_SOUND_VOLUME",
    "SOBA_SOUND_REPEAT",
    "SOBA_CONFIG_PATH",
    "SOBA_RUN_LIVE_TESTS",
    "SOBA_LOCALES_DIR",
    "SOBA_TEST_AUDIO_DIR",
    "SOBA_PROXY_HTTP_TESTS",
    "NO_COLOR",
  ]),

  slashCommands: new Set([
    "help",
    "session",
    "budget",
    "exit",
    "quit",
    "lang",
    "auto-compact",
    "theme",
    "project-trust",
    "skill:",
    "skill",
    "notifications",
    "clear",
    "search",
    "compact",
    "capsule",
    "permissions",
    "config",
    "queue",
    "rewind",
    "mcp",
    "sessions",
    "model",
    "sidebar",
    "keys",
    "plan",
  ]),

  cliSubcommands: new Map([
    ["provider", new Set(["list", "add", "remove", "show", "use"])],
    ["init", new Set(["check"])],
    ["acp", new Set<string>()],
    ["prove", new Set<string>()],
    ["verify", new Set<string>()],
    ["explain-claim", new Set<string>()],
    ["memory", new Set(["doctor", "stale", "verify", "explain"])],
  ]),

  configKeys: new Set([
    "providers",
    "selectedModels",
    "activeSelection",
    "lang",
    "theme",
    "model",
    "baseUrl",
    "apiKey",
    "maxOutputTokens",
    "maxCompletionTokens",
    "maxAgentIterations",
    "maxStalledIterations",
    "maxRunMinutes",
    "adaptiveLoop",
    "compaction",
    "contextWindow",
    "safetyReserveTokens",
    "autoCompact",
    "keepRecentTokens",
    "safetyReserveTokens",
    "bashMaxTimeoutSeconds",
    "temperature",
    "sessionDir",
    "registry",
    "defaultProvider",
    "defaultModel",
    "customProviders",
    "sound",
    "enabled",
    "volume",
    "repeatMode",
    "repeatIntervalMs",
    "apiKeyEnv",
    "adapter",
    "models",
    "agentInfo",
    "agentCapabilities",
    "promptCapabilities",
    "sessionCapabilities",
  ]),

  permissionModes: new Set(["ask", "repo", "full"]),

  hotkeys: new Set([
    "Ctrl+F",
    "Ctrl+M",
    "Ctrl+C",
    "Ctrl+D",
    "Ctrl+Z",
    "Ctrl+L",
    "Ctrl+Y",
    "Ctrl+B",
    "Ctrl+Shift+B",
    "Ctrl+H",
    "Ctrl+E",
    "Ctrl+Shift+C",
    "Cmd+C",
    "Cmd+Shift+C",
    "Super+C",
    "Super+Shift+C",
    "Ctrl+Shift+S",
    "Ctrl+Down",
    "Ctrl+Up",
    "Enter",
    "Escape",
    "Tab",
    "F1",
    "F2",
    "F3",
    "F6",
    "Shift+F6",
    "Up",
    "Down",
    "Page Up",
    "Page Down",
    "Home",
    "End",
  ]),

  specialSyntax: new Set(["!", "!!"]),

  // Known to NOT exist (common fabrications)
  knownFabrications: new Map([
    ["--trust", "cli-flag"],
    ["SOBA_TRUST_LEVEL", "env-var"],
    ["SOBA_AUTO_APPROVE", "env-var"],
    ["/perm", "slash-command"],
    ["accept-edits", "permission-mode"],
    ["bypass", "permission-mode"],
    ["default", "permission-mode"],
    ["Ctrl+Shift+J", "hotkey"],

  ]),
};

const IGNORED_SLASH_CLAIMS = new Set([
  "/en",
  "/ru",
  "/zh",
  "/docs",
  "/models",
  "/v",
  "/v1",
  "/sse",
]);

const IGNORED_SOBA_WORDS = new Set(["agent", "context", "docs"]);

// ─── Claim Extractors ───

function extractClaims(content: string): Claim[] {
  const claims: Claim[] = [];
  const lines = content.split("\n");

  // CLI flags: --something (from lines mentioning soba/SOBA, not external tools)
  const cliFlagRe = /(?<![`\w])--([a-z][a-z0-9-]*)(?:=[^\s`]*)?(?![`\w])/gi;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("<!--")) continue;
    // Only extract flags from lines that mention soba (case insensitive)
    if (!/soba/i.test(lines[i])) continue;
    const matches = lines[i].matchAll(cliFlagRe);
    for (const m of matches) {
      const flag = m[1];
      claims.push({ kind: "cli-flag", text: m[0], value: flag, line: i + 1 });
    }
  }

  // Env vars: SOBA_* or export SOBA_*
  const envRe = /\b(SOBA_[A-Z_0-9]+)\b/g;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].matchAll(envRe);
    for (const m of matches) {
      claims.push({ kind: "env-var", text: m[0], value: m[1], line: i + 1 });
    }
  }

  // Slash commands: /something (in TUI context)
  // Only match /command patterns, NOT file paths (/path/to/file.ts, /src/..., etc.)
  const slashRe = /(?:^|[\s(])`?(\/(?:[a-z][a-z-]*(?::[a-z-]*)?)(?:\s+[a-z][a-z-]*)?)`?/gim;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("#")) continue;
    const matches = lines[i].matchAll(slashRe);
    for (const m of matches) {
      const raw = m[1];
      if (!raw) continue;
      const cmdPart = raw.split(/\s+/)[0];
      if (!cmdPart.startsWith("/")) continue;
      if (cmdPart.split("/").filter(Boolean).length > 1 && !cmdPart.includes(":")) continue;
      if (IGNORED_SLASH_CLAIMS.has(cmdPart.toLowerCase())) continue;
      if (cmdPart === "/dev" || cmdPart === "/tmp" || cmdPart === "/null" || cmdPart === "/sda") continue;
      claims.push({ kind: "slash-command", text: raw, value: cmdPart.toLowerCase(), line: i + 1 });
    }
  }

  // Subcommands: soba <command>. Keep this lowercase/command-like to avoid prose such as "SOBA treats ...".
  const sobaRe = /`?soba\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)`?/g;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].matchAll(sobaRe);
    for (const m of matches) {
      const parts = m[1].trim().split(/\s+/);
      if (parts.length >= 1) {
        if (parts[0].length <= 1) continue;
        if (IGNORED_SOBA_WORDS.has(parts[0].toLowerCase())) continue;
        claims.push({ kind: "subcommand", text: m[0], value: parts[0], line: i + 1 });
      }
    }
  }

  // Config keys: dotted paths like providers.id.apiKey, or backtick-quoted keys
  const configKeyRe = /`([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)`/g;
  for (let i = 0; i < lines.length; i++) {
    // Only in config context
    if (!/config|providers|settings|\.json/i.test(lines[i])) continue;
    const matches = lines[i].matchAll(configKeyRe);
    for (const m of matches) {
      const key = m[1];
      if (isDocumentationFileName(key)) continue;
      // Extract top-level key (first segment)
      const topKey = key.split(".")[0];
      claims.push({ kind: "config-key", text: key, value: topKey, line: i + 1 });
    }
  }

  // Permission-mode names. Only inspect permission-related prose to avoid regular words like "short plan".
  const permRe = /\b(accept-edits|bypass)\b/gi;
  for (let i = 0; i < lines.length; i++) {
    if (!/permission|permissions|разрешен|режим|trust/i.test(lines[i])) continue;
    const matches = lines[i].matchAll(permRe);
    for (const m of matches) {
      claims.push({ kind: "permission-mode", text: m[0], value: m[1].toLowerCase(), line: i + 1 });
    }
  }

  // Hotkeys: Ctrl+X, Cmd+X, F2, Page Up, etc.
  const hotkeyRe = /\b((?:(?:Ctrl|Cmd|Alt|Shift|Meta|Super)\+)+(?:[A-Z]|F\d{1,2}|Enter|Tab|Space|Backspace|Delete|Up|Down|Left|Right|Home|End|PgUp|PgDn|Esc)|F\d{1,2}|Page Up|Page Down|Home|End|Enter|Escape|Tab)\b/g;
  for (let i = 0; i < lines.length; i++) {
    if (!/hotkey|keyboard|shortcut|клавиш|сочетан|F\d|Page Up|Page Down|Ctrl\+|Cmd\+|Super\+/i.test(lines[i])) continue;
    const matches = lines[i].matchAll(hotkeyRe);
    for (const m of matches) {
      claims.push({ kind: "hotkey", text: m[0], value: m[1], line: i + 1 });
    }
  }

  // Special syntax: ! (direct shell) and !! (silent shell)
  const specialRe = /(`!!?`|"!!?"|shell-silent|silent shell|прям(?:ой|ых) shell)/gi;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].matchAll(specialRe);
    for (const m of matches) {
      const value = m[0].includes("!!") || /silent|shell-silent/i.test(m[0]) ? "!!" : "!";
      claims.push({ kind: "special-syntax", text: value, value, line: i + 1 });
    }
  }

  return claims;
}

function isDocumentationFileName(value: string): boolean {
  return /\.(?:json|md|mdx|ts|tsx|js|jsx|yaml|yml)$/i.test(value);
}

// ─── Verifiers ───

function verifyCliFlag(flag: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.cliFlags.has(flag)) {
    return { verdict: "confirmed", hint: "src/apps/cli/args.ts | src/application/commands/*" };
  }
  if (SOURCE_FACTS.knownFabrications.has(`--${flag}`)) {
    return { verdict: "fabricated", hint: "не существует в коде" };
  }
  return { verdict: "unknown", hint: "не найден в известных флагах" };
}

function verifyEnvVar(variable: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.envVars.has(variable)) {
    return { verdict: "confirmed", hint: `grep ${variable} src/` };
  }
  if (SOURCE_FACTS.knownFabrications.has(variable)) {
    return { verdict: "fabricated", hint: "не существует в коде" };
  }
  return { verdict: "unknown", hint: "не найден в известных env-переменных" };
}

function verifySlashCommand(command: string): { verdict: Verdict; hint: string } {
  const cmd = command.startsWith("/") ? command.slice(1) : command;
  if (SOURCE_FACTS.slashCommands.has(cmd)) {
    return { verdict: "confirmed", hint: "src/application/command-service.ts | src/ui/terminal/interactive/commands/" };
  }
  for (const known of SOURCE_FACTS.slashCommands) {
    // Match subcommands: "/session info" or "/permissions ask"
    if (cmd.startsWith(known + " ")) {
      return { verdict: "confirmed", hint: `src/apps/cli/commands.ts (subcmd of ${known})` };
    }
    // Match colon-prefix commands: "/skill:my-feature" when "skill:" is known
    if (known.endsWith(":") && cmd.startsWith(known)) {
      return { verdict: "confirmed", hint: `src/apps/cli/commands.ts (prefixed by ${known})` };
    }
  }
  if (SOURCE_FACTS.knownFabrications.has(command) || SOURCE_FACTS.knownFabrications.has("/" + cmd)) {
    return { verdict: "fabricated", hint: "не существует в коде" };
  }
  return { verdict: "unknown", hint: "не зарегистрирована в slash-командах" };
}

function verifySubcommand(cmd: string): { verdict: Verdict; hint: string } {
  for (const [parent, subs] of SOURCE_FACTS.cliSubcommands) {
    if (parent === cmd || subs.has(cmd)) {
      return { verdict: "confirmed", hint: `src/apps/cli/args.ts | src/application/commands/${parent}.ts` };
    }
  }
  if (SOURCE_FACTS.knownFabrications.has(cmd)) {
    return { verdict: "fabricated", hint: "не существует в коде" };
  }
  return { verdict: "unknown", hint: "не найден в CLI subcommand'ах" };
}

function verifyConfigKey(key: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.configKeys.has(key)) {
    return { verdict: "confirmed", hint: "src/composition/config/config-loader.ts | src/application/config/types.ts" };
  }
  if (SOURCE_FACTS.knownFabrications.has(key)) {
    return { verdict: "fabricated", hint: "не существует в конфигурации" };
  }
  return { verdict: "unknown", hint: "не найден в известных конфиг-ключах" };
}

function verifyPermissionMode(mode: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.permissionModes.has(mode)) {
    return { verdict: "confirmed", hint: "src/kernel/permissions/trust.ts" };
  }
  if (SOURCE_FACTS.knownFabrications.has(mode)) {
    return { verdict: "fabricated", hint: "PermissionMode: только ask | repo | full" };
  }
  return { verdict: "unknown", hint: "не является PermissionMode" };
}

function verifyHotkey(hotkey: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.hotkeys.has(hotkey)) {
    return { verdict: "confirmed", hint: "src/ui/terminal/interactive/lib/keymap.ts" };
  }
  if (SOURCE_FACTS.knownFabrications.has(hotkey)) {
    return { verdict: "fabricated", hint: "не существует в коде" };
  }
  return { verdict: "unknown", hint: "не найден в известных хоткеях" };
}

function verifySpecialSyntax(syntax: string): { verdict: Verdict; hint: string } {
  if (SOURCE_FACTS.specialSyntax.has(syntax)) {
    return { verdict: "confirmed", hint: "src/ui/terminal/interactive/model/tui-store.ts" };
  }
  return { verdict: "unknown", hint: "не найден" };
}

function verifyClaim(claim: Claim): VerifiedClaim {
  let result: { verdict: Verdict; hint: string };
  switch (claim.kind) {
    case "cli-flag":
      result = verifyCliFlag(claim.value);
      break;
    case "env-var":
      result = verifyEnvVar(claim.value);
      break;
    case "slash-command":
      result = verifySlashCommand(claim.value);
      break;
    case "subcommand":
      result = verifySubcommand(claim.value);
      break;
    case "config-key":
      result = verifyConfigKey(claim.value);
      break;
    case "permission-mode":
      result = verifyPermissionMode(claim.value);
      break;
    case "hotkey":
      result = verifyHotkey(claim.value);
      break;
    case "special-syntax":
      result = verifySpecialSyntax(claim.value);
      break;
    default:
      result = { verdict: "unknown", hint: "неизвестный тип утверждения" };
  }
  return { ...claim, verdict: result.verdict, sourceHint: result.hint };
}

// ─── Missing from docs detector ───

/**
 * Only flag missing items when the document's topic is relevant.
 * Avoids false positives on unrelated docs (e.g. themes.md doesn't need to mention /project-trust).
 */
function findMissingFromDocs(docContent: string, fileName: string): MissingItem[] {
  const missing: MissingItem[] = [];

  // Only check permission/security items if the doc is specifically about security or permissions.
  const isSecurityDoc = /\bsecurity|permission|trust|разрешен|безопасност/i.test(fileName);

  if (isSecurityDoc) {
    if (!docContent.includes("repo")) {
      missing.push({
        category: "permission-mode",
        item: "repo",
        sourceLocation: "src/kernel/permissions/trust.ts",
        reason: "PermissionMode 'repo' существует, но не упомянут в доке",
      });
    }
    if (!docContent.includes("full")) {
      missing.push({
        category: "permission-mode",
        item: "full",
        sourceLocation: "src/kernel/permissions/trust.ts",
        reason: "PermissionMode 'full' существует, но не упомянут в доке",
      });
    }
    if (!docContent.includes("/project-trust")) {
      missing.push({
        category: "slash-command",
        item: "/project-trust",
        sourceLocation: "src/application/command-service.ts",
        reason: "Slash-команда существует в коде, но не описана в доке",
      });
    }
  }

  // Check for ! (direct shell) only in usage/quick-start docs
  const isUsageDoc = /\busage|quick|walkthrough|использован|быстр/i.test(fileName);

  if (isUsageDoc) {
    if (!docContent.includes("`!`") && !docContent.includes('"!"') && !docContent.includes("прям")) {
      missing.push({
        category: "special-syntax",
        item: "! (direct shell)",
        sourceLocation: "src/ui/terminal/interactive/model/tui-store.ts",
        reason: "Синтаксис прямых shell-команд существует, но не описан",
      });
    }
  }

  return missing;
}

// ─── Report formatter ───

function formatReport(report: Report): string {
  const lines: string[] = [];
  const fab = report.claims.filter((c) => c.verdict === "fabricated");
  const unk = report.claims.filter((c) => c.verdict === "unknown");

  lines.push("╔══════════════════════════════════════╗");
  lines.push(`║  Doc Scout — ${report.file.padEnd(27)}║`);
  lines.push("╚══════════════════════════════════════╝");
  lines.push("");

  // Deduplicate fabricated claims
  const fabDeduped = new Map<string, VerifiedClaim>();
  for (const c of fab) {
    const key = `${c.kind}:${c.value}`;
    if (!fabDeduped.has(key)) fabDeduped.set(key, c);
  }

  if (fabDeduped.size > 0) {
    lines.push("❌ CLAIMS NOT IN CODE (выдумка):");
    for (const [, c] of fabDeduped) {
      const pad = c.kind.padEnd(16);
      lines.push(`  ${c.value.padEnd(26)} → ${pad} ${c.sourceHint}`);
    }
    lines.push("");
  }

  if (unk.length > 0) {
    lines.push("❓ UNVERIFIED (требует ручной проверки):");
    const unkDeduped = new Map<string, VerifiedClaim>();
    for (const c of unk) {
      const key = `${c.kind}:${c.value}`;
      if (!unkDeduped.has(key)) unkDeduped.set(key, c);
    }
    for (const [, c] of unkDeduped) {
      const pad = c.kind.padEnd(16);
      lines.push(`  ${c.value.padEnd(26)} → ${pad} ${c.sourceHint}`);
    }
    lines.push("");
  }

  if (report.missingFromDocs.length > 0) {
    lines.push("⚠️  MISSING FROM DOCS (есть в коде, нет в доке):");
    for (const m of report.missingFromDocs) {
      lines.push(`  ${m.item.padEnd(26)} → ${m.reason}`);
    }
    lines.push("");
  }

  lines.push(`📊 Всего проверено утверждений: ${report.totalClaims}`);
  lines.push(`   ✅ Подтверждено: ${report.confirmed}`);
  lines.push(`   ❌ Выдумка: ${report.fabricated}`);
  lines.push(`   ❓ Не проверено: ${report.unknown}`);
  lines.push(`   ⚠️  Пропущено в доке: ${report.missingFromDocs.length}`);

  return lines.join("\n");
}

function formatJsonReport(report: Report): string {
  const summary = {
    file: report.file,
    totalClaims: report.totalClaims,
    confirmed: report.confirmed,
    fabricated: report.fabricated,
    unknown: report.unknown,
    fabricatedClaims: report.claims
      .filter((c) => c.verdict === "fabricated")
      .map((c) => ({ kind: c.kind, value: c.value, line: c.line })),
    unverifiedClaims: report.claims
      .filter((c) => c.verdict === "unknown")
      .map((c) => ({ kind: c.kind, value: c.value, line: c.line })),
    missingFromDocs: report.missingFromDocs,
  };
  return JSON.stringify(summary, null, 2);
}

// ─── File resolver ───

async function resolveFiles(rawFiles: string[], lang?: DocsLang): Promise<string[]> {
  const files: string[] = [];
  for (const raw of rawFiles) {
    try {
      files.push(...await collectDocFiles(raw));
    } catch {
      // Not a directory — treat as file path
      if (raw.endsWith(".md") || raw.endsWith(".mdx")) {
        files.push(raw);
      }
    }
  }
  const filtered = lang ? files.filter((file) => isDocForLang(file, lang)) : files;
  return [...new Set(filtered)].sort();
}

async function collectDocFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const entry of dirents) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDocFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isDocForLang(filePath: string, lang: DocsLang): boolean {
  const name = basename(filePath);
  return name.endsWith(`.${lang}.md`) || name.endsWith(`.${lang}.mdx`);
}

// ─── Main ───

async function validateFile(filePath: string): Promise<Report> {
  const content = await readFile(filePath, "utf-8");
  const claims = extractClaims(content);
  const verifiedClaims = claims.map(verifyClaim);
  const missing = findMissingFromDocs(content, basename(filePath));

  // Deduplicate (same kind + value = one claim)
  const seen = new Set<string>();
  const unique: VerifiedClaim[] = [];
  for (const c of verifiedClaims) {
    const key = `${c.kind}:${c.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  return {
    file: basename(filePath),
    totalClaims: unique.length,
    confirmed: unique.filter((c) => c.verdict === "confirmed").length,
    fabricated: unique.filter((c) => c.verdict === "fabricated").length,
    unknown: unique.filter((c) => c.verdict === "unknown").length,
    claims: unique,
    missingFromDocs: missing,
  };
}

async function main() {
  const { files: rawFiles, json, lang } = parseArgs();

  if (rawFiles.length === 0) {
    console.error("Usage: bun run validate.ts --file <doc.mdx> [--json]");
    console.error("       bun run validate.ts --dir <docs-dir/> [--lang ru|en|zh] [--json]");
    process.exit(1);
  }

  const files = await resolveFiles(rawFiles, lang);

  if (files.length === 0) {
    console.error("No .md / .mdx files found");
    process.exit(1);
  }

  const reports: Report[] = [];
  for (const file of files) {
    try {
      const report = await validateFile(file);
      reports.push(report);
      if (json) {
        console.log(formatJsonReport(report));
      } else {
        console.log(formatReport(report));
        if (files.length > 1) console.log("\n" + "─".repeat(50) + "\n");
      }
    } catch (err: any) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }

  // Save JSON report
  const outputDir = ".soba/skills/doc-scout/output";
  try {
    await readdir(outputDir);
  } catch {
    await $`mkdir -p ${outputDir}`.quiet();
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const report of reports) {
    const outFile = join(outputDir, `${report.file.replace(/\.mdx?$/, "")}-${timestamp}.json`);
    await writeFile(outFile, formatJsonReport(report));
  }

  const totalFab = reports.reduce((sum, r) => sum + r.fabricated, 0);
  if (totalFab > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
