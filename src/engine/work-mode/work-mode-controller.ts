import { type WorkMode } from "../../kernel/work-mode/public";

/**
 * Session-scoped work mode controller.
 * Orthogonal to PermissionMode / TrustController.
 */
export class WorkModeController {
  private mode: WorkMode = "agent";

  getWorkMode(): WorkMode {
    return this.mode;
  }

  setWorkMode(mode: WorkMode): void {
    this.mode = mode;
  }
}
