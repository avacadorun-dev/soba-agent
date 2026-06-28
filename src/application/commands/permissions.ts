import type { PermissionMode } from "../trust/trust-manager";

export interface PermissionCommandController {
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  clearSessionApprovals(): void;
}

export type PermissionCommandView =
  | { kind: "not_configured" }
  | { kind: "current"; mode: PermissionMode }
  | { kind: "cleared" }
  | { kind: "changed"; mode: PermissionMode }
  | { kind: "usage" };

export function executePermissionsCommand(input: {
  args: string[];
  controller?: PermissionCommandController;
}): PermissionCommandView {
  const { args, controller } = input;
  if (!controller) {
    return { kind: "not_configured" };
  }

  const mode = args[0]?.toLowerCase();
  if (!mode) {
    return { kind: "current", mode: controller.getPermissionMode() };
  }

  if (mode === "clear") {
    controller.clearSessionApprovals();
    controller.setPermissionMode("ask");
    return { kind: "cleared" };
  }

  if (isPermissionMode(mode)) {
    controller.setPermissionMode(mode);
    return { kind: "changed", mode };
  }

  return { kind: "usage" };
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === "ask" || value === "repo" || value === "full";
}
