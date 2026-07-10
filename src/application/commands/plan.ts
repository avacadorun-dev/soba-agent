import { isRestrictedWorkMode, normalizeWorkModeId, type WorkMode } from "../../kernel/work-mode/public";

export interface PlanCommandController {
  getWorkMode(): WorkMode;
  setWorkMode(mode: WorkMode): void;
}

export type PlanCommandView =
  | { kind: "not_configured" }
  | { kind: "current"; mode: WorkMode }
  | { kind: "changed"; mode: WorkMode }
  | { kind: "usage" };

export function executePlanCommand(input: {
  args: string[];
  controller?: PlanCommandController;
}): PlanCommandView {
  const { args, controller } = input;
  if (!controller) {
    return { kind: "not_configured" };
  }

  const raw = args[0]?.toLowerCase();
  if (!raw) {
    return { kind: "current", mode: controller.getWorkMode() };
  }

  if (raw === "toggle") {
    const next: WorkMode = isRestrictedWorkMode(controller.getWorkMode()) ? "agent" : "plan";
    controller.setWorkMode(next);
    return { kind: "changed", mode: next };
  }

  if (raw === "on") {
    controller.setWorkMode("plan");
    return { kind: "changed", mode: "plan" };
  }

  if (raw === "off") {
    controller.setWorkMode("agent");
    return { kind: "changed", mode: "agent" };
  }

  const mode = normalizeWorkModeId(raw);
  if (mode) {
    controller.setWorkMode(mode);
    return { kind: "changed", mode };
  }

  return { kind: "usage" };
}
