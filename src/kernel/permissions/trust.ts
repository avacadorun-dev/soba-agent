export type TrustLevel = "safe" | "normal" | "dangerous";
export type PermissionMode = "ask" | "repo" | "full";

export interface PermissionAlternative {
  id: string;
  title: string;
  reason: string;
  command?: string;
}

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
