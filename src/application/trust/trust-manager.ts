/**
 * Trust Manager.
 *
 * Classifies tool calls and shell commands into trust levels:
 * - safe: automatic execution (read)
 * - normal: auto with notification (write, edit, git, npm)
 * - dangerous: requires confirmation (rm, sudo, curl, etc.)
 */

import { resolve } from "node:path";

// ─── Types ───

export type TrustLevel = "safe" | "normal" | "dangerous";
export type PermissionMode = "ask" | "repo" | "full";

export interface TrustRule {
  /** Pattern to match (tool name or command prefix) */
  pattern: string;
  /** Trust level for matches */
  level: TrustLevel;
}

export interface TrustCheckResult {
  level: TrustLevel;
  /** Whether user confirmation is required */
  needsConfirmation: boolean;
  /** Human-readable reason for the classification */
  reason: string;
}

export interface TrustManagerOptions {
  repoRoot?: string;
}

// ─── Default Rules ───

const DEFAULT_TOOL_RULES: TrustRule[] = [
  { pattern: "read", level: "safe" },
  { pattern: "write", level: "normal" },
  { pattern: "edit", level: "normal" },
  { pattern: "bash", level: "normal" }, // bash is checked per-command
];

const DEFAULT_COMMAND_RULES: TrustRule[] = [
  // Dangerous — dev servers (block agent hang)
  { pattern: "bun run dev", level: "dangerous" },
  { pattern: "npm run dev", level: "dangerous" },
  { pattern: "pnpm run dev", level: "dangerous" },
  { pattern: "yarn dev", level: "dangerous" },
  { pattern: "npx vite", level: "dangerous" },
  { pattern: "vite ", level: "dangerous" },
  { pattern: "npx serve", level: "dangerous" },
  { pattern: "npx http-server", level: "dangerous" },
  { pattern: "rm ", level: "dangerous" },
  { pattern: "rm -rf", level: "dangerous" },
  { pattern: "rmdir", level: "dangerous" },
  { pattern: "unlink ", level: "dangerous" },
  { pattern: "/bin/rm ", level: "dangerous" },
  { pattern: "/usr/bin/rm ", level: "dangerous" },
  { pattern: "shred ", level: "dangerous" },
  { pattern: "srm ", level: "dangerous" },
  { pattern: "sudo ", level: "dangerous" },
  { pattern: "chmod 777", level: "dangerous" },
  { pattern: "chown ", level: "dangerous" },
  { pattern: "> /dev/null", level: "safe" },
  { pattern: "> /dev/", level: "dangerous" },
  { pattern: "mkfs.", level: "dangerous" },
  { pattern: "dd if=", level: "dangerous" },
  { pattern: ":(){ :|:& };:", level: "dangerous" }, // fork bomb

  // Dangerous — network/external
  { pattern: "curl ", level: "dangerous" },
  { pattern: "wget ", level: "dangerous" },
  { pattern: "nc ", level: "dangerous" },
  { pattern: "ssh ", level: "dangerous" },
  { pattern: "scp ", level: "dangerous" },
  { pattern: "shutdown", level: "dangerous" },
  { pattern: "reboot", level: "dangerous" },

  // Normal — version control
  { pattern: "git status", level: "safe" },
  { pattern: "git log", level: "safe" },
  { pattern: "git diff", level: "safe" },
  { pattern: "git branch", level: "safe" },
  { pattern: "git add", level: "normal" },
  { pattern: "git commit", level: "normal" },
  { pattern: "git push", level: "dangerous" },
  { pattern: "git reset", level: "dangerous" },
  { pattern: "git checkout", level: "normal" },
  { pattern: "git ", level: "normal" },

  // Normal — package managers
  { pattern: "npm install", level: "normal" },
  { pattern: "npm test", level: "safe" },
  { pattern: "npm run", level: "safe" },
  { pattern: "bun install", level: "normal" },
  { pattern: "bun test", level: "safe" },
  { pattern: "bun run", level: "safe" },
  { pattern: "pnpm install", level: "normal" },
  { pattern: "yarn install", level: "normal" },

  // Normal — common dev tools
  { pattern: "ls", level: "safe" },
  // Destructive find patterns BEFORE generic find — flag-based matching
  // (commands can have options between path and action, so match on actions)
  { pattern: "-delete", level: "dangerous" },
  { pattern: "-exec rm", level: "dangerous" },
  { pattern: "-execdir rm", level: "dangerous" },
  { pattern: "find ", level: "safe" },
  { pattern: "grep ", level: "safe" },
  { pattern: "rg ", level: "safe" },
  { pattern: "cat ", level: "safe" },
  { pattern: "head ", level: "safe" },
  { pattern: "tail ", level: "safe" },
  { pattern: "wc ", level: "safe" },
  { pattern: "echo ", level: "safe" },
  { pattern: "pwd", level: "safe" },
  { pattern: "which ", level: "safe" },
  { pattern: "type ", level: "safe" },
  { pattern: "env", level: "safe" },
  { pattern: "printenv", level: "safe" },
  { pattern: "whoami", level: "safe" },
  { pattern: "date", level: "safe" },
  // Moving files outside the project is effectively deletion — check BEFORE generic mv
  // But AFTER mkdir/cp (those are safe even with /tmp destination)
  { pattern: "mkdir ", level: "normal" },
  { pattern: "cp ", level: "normal" },
  // Path-based dangerous patterns for mv-to-outside (matches any command with dest in /tmp etc.)
  { pattern: " /tmp/", level: "dangerous" },
  { pattern: " /var/tmp/", level: "dangerous" },
  { pattern: " ~/", level: "dangerous" },
  { pattern: "$HOME/", level: "dangerous" },
  { pattern: "$TMPDIR/", level: "dangerous" },
  { pattern: " /private/tmp/", level: "dangerous" },
  { pattern: " /dev/null", level: "dangerous" },
  { pattern: "mv ", level: "normal" },
  { pattern: "touch ", level: "normal" },
  { pattern: "chmod ", level: "normal" },
  { pattern: "tar ", level: "normal" },
  { pattern: "zip ", level: "normal" },
  { pattern: "unzip ", level: "normal" },

  // Script-based workarounds for destructive operations
  { pattern: "node -e", level: "dangerous" },
  { pattern: "bun -e", level: "dangerous" },
  { pattern: "python -c", level: "dangerous" },
  { pattern: "python3 -c", level: "dangerous" },
  { pattern: "perl -e", level: "dangerous" },
  { pattern: "ruby -e", level: "dangerous" },

  // Build tools
  { pattern: "make ", level: "normal" },
  { pattern: "cargo ", level: "normal" },
  { pattern: "go ", level: "normal" },
  { pattern: "docker ", level: "normal" },
  { pattern: "docker-compose", level: "normal" },

  // trash / osascript deletion attempts
  { pattern: "trash ", level: "dangerous" },
  { pattern: "osascript -e 'tell app \"Finder\" to delete", level: "dangerous" },
  { pattern: "gio trash", level: "dangerous" },
];

function extractAbsolutePaths(command: string): string[] {
  return [...command.matchAll(/(?:^|\s|["'=])(?<path>\/[^\s"'`;&|)]+)/g)]
    .map((match) => match.groups?.path)
    .filter((path): path is string => Boolean(path));
}

function isTempPath(path: string): boolean {
  const normalized = resolve(path);
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function usesDestructiveTempOperation(command: string): boolean {
  return /\b(?:rm|rmdir|unlink|shred|srm|mv)\b/.test(command) || /\bfind\b/.test(command) && /\b(?:-delete|-exec(?:dir)?\s+rm)\b/.test(command);
}

// ─── Trust Manager ───

export class TrustManager {
  private toolRules: TrustRule[] = [...DEFAULT_TOOL_RULES];
  private commandRules: TrustRule[] = [...DEFAULT_COMMAND_RULES];
  private permissionMode: PermissionMode = "ask";
  private repoRoot: string | undefined;
  private readonly sessionApprovals = new Set<string>();

  constructor(options: TrustManagerOptions = {}) {
    if (options.repoRoot) {
      this.repoRoot = resolve(options.repoRoot);
    }
  }

  /**
   * Check trust level for a tool call by name.
   */
  checkTool(toolName: string): TrustCheckResult {
    // Find matching rule (first match wins)
    for (const rule of this.toolRules) {
      if (toolName === rule.pattern || toolName.startsWith(rule.pattern)) {
        const result = {
          level: rule.level,
          needsConfirmation:
            rule.level === "dangerous" &&
            this.permissionMode !== "full" &&
            !this.sessionApprovals.has(this.approvalKey("tool", toolName)),
          reason: this.reasonForLevel(rule.level, toolName),
        };
        return result;
      }
    }

    // Unknown tools → normal
    return {
      level: "normal",
      needsConfirmation: false,
      reason: `Unknown tool "${toolName}" — defaulting to normal`,
    };
  }

  /**
   * Check trust level for a shell command.
   * Evaluates the full command text against command rules.
   */
  checkCommand(command: string): TrustCheckResult {
    const trimmed = command.trim();

    // Check rules in order (more specific first)
    for (const rule of this.commandRules) {
      if (trimmed.startsWith(rule.pattern) || trimmed.includes(rule.pattern)) {
        const result = {
          level: rule.level,
          needsConfirmation:
            rule.level === "dangerous" &&
            this.permissionMode !== "full" &&
            !this.sessionApprovals.has(this.approvalKey("command", trimmed)) &&
            !(this.permissionMode === "repo" && this.isRepoScopedCommand(trimmed)),
          reason: this.reasonForLevel(rule.level, trimmed),
        };
        return result;
      }
    }

    // Unknown commands → normal
    return {
      level: "normal",
      needsConfirmation: false,
      reason: `Command classified as normal`,
    };
  }

  /**
   * Add a custom rule.
   */
  addToolRule(pattern: string, level: TrustLevel): void {
    // Insert at beginning to take priority
    this.toolRules.unshift({ pattern, level });
  }

  /**
   * Add a custom command rule.
   */
  addCommandRule(pattern: string, level: TrustLevel): void {
    this.commandRules.unshift({ pattern, level });
  }

  /**
   * Remove a custom rule.
   */
  removeToolRule(pattern: string): void {
    this.toolRules = this.toolRules.filter((r) => r.pattern !== pattern);
  }

  removeToolRulesByPrefix(prefix: string): void {
    this.toolRules = this.toolRules.filter((r) => !r.pattern.startsWith(prefix));
  }

  /**
   * Remove a custom command rule.
   */
  removeCommandRule(pattern: string): void {
    this.commandRules = this.commandRules.filter((r) => r.pattern !== pattern);
  }

  /**
   * Get all registered rules.
   */
  getToolRules(): TrustRule[] {
    return [...this.toolRules];
  }

  getCommandRules(): TrustRule[] {
    return [...this.commandRules];
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  setRepoRoot(repoRoot: string): void {
    this.repoRoot = resolve(repoRoot);
  }

  approveForSession(kind: "tool" | "command", value: string): void {
    this.sessionApprovals.add(this.approvalKey(kind, value.trim()));
  }

  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  private approvalKey(kind: "tool" | "command", value: string): string {
    return `${kind}:${value}`;
  }

  /**
   * Repo access is intentionally conservative because bash itself is not sandboxed.
   * Commands with network, privilege, absolute-path, home, or parent traversal markers
   * still require an explicit approval.
   */
  private isRepoScopedCommand(command: string): boolean {
    const unsafePatterns = [
      /\b(?:sudo|ssh|scp|curl|wget|nc|shutdown|reboot)\b/,
      /\bgit\s+push\b/,
      /(?:^|\s)(?:~\/|\.\.\/)/,
      /\$(?:HOME|USERPROFILE)\b/,
      />\s*\/dev\//,
      // Dev servers hang the agent — always require confirmation
      /\b(?:bun|npm|pnpm)\s+run\s+dev\b/,
      /\byarn\s+dev\b/,
      /\b(?:npx\s+vite|vite|npx\s+serve|npx\s+http-server)\b/,
    ];
    if (unsafePatterns.some((pattern) => pattern.test(command))) {
      return false;
    }

    return !this.hasUnsafeAbsolutePath(command);
  }

  private hasUnsafeAbsolutePath(command: string): boolean {
    for (const path of extractAbsolutePaths(command)) {
      if (this.isPathInsideRepo(path)) {
        continue;
      }
      if (isTempPath(path) && !usesDestructiveTempOperation(command)) {
        continue;
      }
      return true;
    }
    return false;
  }

  private isPathInsideRepo(path: string): boolean {
    if (!this.repoRoot) return false;
    const absolute = resolve(path);
    return absolute === this.repoRoot || absolute.startsWith(`${this.repoRoot}/`);
  }

  private reasonForLevel(level: TrustLevel, name: string): string {
    switch (level) {
      case "safe":
        return `"${name}" is safe — no side effects`;
      case "normal":
        return `"${name}" may modify files`;
      case "dangerous":
        return `"${name}" may cause data loss or security risk`;
    }
  }
}
