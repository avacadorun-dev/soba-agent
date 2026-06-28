export type TrustLevel = "safe" | "normal" | "dangerous";
export type PermissionMode = "ask" | "repo" | "full";

export interface TrustRule {
  pattern: string;
  level: TrustLevel;
}

export interface TrustCheckResult {
  level: TrustLevel;
  needsConfirmation: boolean;
  reason: string;
}

export interface TrustController {
  checkTool(toolName: string): TrustCheckResult;
  checkCommand(command: string): TrustCheckResult;
  addToolRule(pattern: string, level: TrustLevel): void;
  removeToolRulesByPrefix(prefix: string): void;
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  setRepoRoot(repoRoot: string): void;
  approveForSession(kind: "tool" | "command", value: string): void;
  clearSessionApprovals(): void;
}

const DEFAULT_TOOL_RULES: TrustRule[] = [
  { pattern: "read", level: "safe" },
  { pattern: "write", level: "normal" },
  { pattern: "edit", level: "normal" },
  { pattern: "bash", level: "normal" },
];

const DEFAULT_COMMAND_RULES: TrustRule[] = [
  { pattern: "rm ", level: "dangerous" },
  { pattern: "sudo ", level: "dangerous" },
  { pattern: "curl ", level: "dangerous" },
  { pattern: "wget ", level: "dangerous" },
  { pattern: "git push", level: "dangerous" },
  { pattern: "git reset", level: "dangerous" },
  { pattern: "git status", level: "safe" },
  { pattern: "git diff", level: "safe" },
  { pattern: "bun test", level: "safe" },
  { pattern: "bun run", level: "safe" },
  { pattern: "npm test", level: "safe" },
  { pattern: "ls", level: "safe" },
  { pattern: "rg ", level: "safe" },
  { pattern: "grep ", level: "safe" },
  { pattern: "cat ", level: "safe" },
  { pattern: "echo ", level: "safe" },
];

export class DefaultTrustController implements TrustController {
  private toolRules = [...DEFAULT_TOOL_RULES];
  private commandRules = [...DEFAULT_COMMAND_RULES];
  private permissionMode: PermissionMode = "ask";
  private repoRoot = "";
  private readonly sessionApprovals = new Set<string>();

  constructor(options: { repoRoot?: string } = {}) {
    this.repoRoot = options.repoRoot ?? "";
  }

  checkTool(toolName: string): TrustCheckResult {
    const rule = this.toolRules.find((candidate) => toolName === candidate.pattern || toolName.startsWith(candidate.pattern));
    const level = rule?.level ?? "normal";
    return this.result(level, "tool", toolName);
  }

  checkCommand(command: string): TrustCheckResult {
    const trimmed = command.trim();
    const rule = this.commandRules.find((candidate) => trimmed.startsWith(candidate.pattern) || trimmed.includes(candidate.pattern));
    const level = rule?.level ?? "normal";
    return this.result(level, "command", trimmed);
  }

  addToolRule(pattern: string, level: TrustLevel): void {
    this.toolRules.unshift({ pattern, level });
  }

  removeToolRulesByPrefix(prefix: string): void {
    this.toolRules = this.toolRules.filter((rule) => !rule.pattern.startsWith(prefix));
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  setRepoRoot(repoRoot: string): void {
    this.repoRoot = repoRoot;
  }

  approveForSession(kind: "tool" | "command", value: string): void {
    this.sessionApprovals.add(this.approvalKey(kind, value));
  }

  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  private result(level: TrustLevel, kind: "tool" | "command", value: string): TrustCheckResult {
    const needsConfirmation =
      level === "dangerous" &&
      this.permissionMode !== "full" &&
      !this.sessionApprovals.has(this.approvalKey(kind, value)) &&
      !(this.permissionMode === "repo" && this.isRepoScoped(value));

    return {
      level,
      needsConfirmation,
      reason: `${kind} classified as ${level}`,
    };
  }

  private isRepoScoped(command: string): boolean {
    if (!this.repoRoot) return false;
    return command.includes(this.repoRoot) || !/(?:^|\s)(?:curl|wget|ssh|sudo|git push)\b/.test(command);
  }

  private approvalKey(kind: "tool" | "command", value: string): string {
    return `${kind}:${value}`;
  }
}
