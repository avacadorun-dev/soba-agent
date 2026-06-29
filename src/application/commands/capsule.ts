import type { ContextCapsuleEntry } from "../../kernel/transcript/types-v2";
import { isContextCapsuleEntry } from "../../kernel/transcript/types-v2";
import { PortableCapsuleServiceError, type PortableCapsuleServiceFactory } from "../capsules/service";
import type { RuntimeSessionHandle } from "../session-lifecycle";

export type CapsuleCommandView =
  | { kind: "empty" }
  | { kind: "list"; capsules: CapsuleListItemView[] }
  | { kind: "not_found"; checkpointId: string }
  | { kind: "details"; capsule: ContextCapsuleEntry }
  | { kind: "usage"; command: "create" | "export" | "load" }
  | { kind: "created"; id: string; checkpointId: string; path: string }
  | { kind: "exported"; id: string; checkpointId: string; path: string }
  | { kind: "loaded"; id: string; path: string; prompt: string }
  | { kind: "error"; message: string };

export interface CapsuleListItemView {
  checkpointId: string;
  strategy: string;
  quality: string;
  timestamp: string;
}

export function executeCapsuleCommand(input: {
  args: string[];
  session: RuntimeSessionHandle;
  createPortableCapsuleService?: PortableCapsuleServiceFactory;
}): CapsuleCommandView {
  const { args, session, createPortableCapsuleService } = input;
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === "create") {
    return createCapsule(args.slice(1), session, createPortableCapsuleService);
  }
  if (subcommand === "export") {
    return exportCapsule(args.slice(1), session, createPortableCapsuleService);
  }
  if (subcommand === "load") {
    return loadCapsule(args.slice(1), session, createPortableCapsuleService);
  }

  const checkpointId = args[0];
  const capsules = getCapsuleEntries(session);

  if (!checkpointId) {
    return capsules.length > 0
      ? {
          kind: "list",
          capsules: capsules.map((capsule) => ({
            checkpointId: capsule.checkpointId,
            strategy: capsule.strategy,
            quality: capsule.quality,
            timestamp: capsule.timestamp,
          })),
        }
      : { kind: "empty" };
  }

  const capsule = capsules.find((entry) => entry.checkpointId === checkpointId || entry.checkpointId.startsWith(checkpointId));
  return capsule ? { kind: "details", capsule } : { kind: "not_found", checkpointId };
}

function createCapsule(
  args: string[],
  session: RuntimeSessionHandle,
  createPortableCapsuleService?: PortableCapsuleServiceFactory,
): CapsuleCommandView {
  const objective = stripWrappingQuotes(args.join(" ").trim());
  if (!objective) {
    return { kind: "usage", command: "create" };
  }
  if (!createPortableCapsuleService) {
    return { kind: "error", message: "Portable capsule service is not configured" };
  }

  try {
    const result = createPortableCapsuleService(session).createFromSession(session, { objective });
    return {
      kind: "created",
      id: result.capsule.id,
      checkpointId: result.capsule.provenance.checkpointId ?? "",
      path: result.path,
    };
  } catch (error) {
    return capsuleErrorView(error);
  }
}

function exportCapsule(
  args: string[],
  session: RuntimeSessionHandle,
  createPortableCapsuleService?: PortableCapsuleServiceFactory,
): CapsuleCommandView {
  const checkpointId = args[0];
  const destinationPath = args[1];
  if (!checkpointId || !destinationPath) {
    return { kind: "usage", command: "export" };
  }
  if (!createPortableCapsuleService) {
    return { kind: "error", message: "Portable capsule service is not configured" };
  }

  try {
    const result = createPortableCapsuleService(session).exportCheckpoint(session, checkpointId, { destinationPath });
    return {
      kind: "exported",
      id: result.capsule.id,
      checkpointId: result.capsule.provenance.checkpointId ?? "",
      path: result.path,
    };
  } catch (error) {
    return capsuleErrorView(error);
  }
}

function loadCapsule(
  args: string[],
  session: RuntimeSessionHandle,
  createPortableCapsuleService?: PortableCapsuleServiceFactory,
): CapsuleCommandView {
  const capsulePath = args[0];
  if (!capsulePath) {
    return { kind: "usage", command: "load" };
  }
  if (!createPortableCapsuleService) {
    return { kind: "error", message: "Portable capsule service is not configured" };
  }

  try {
    const result = createPortableCapsuleService(session).loadCapsule(capsulePath);
    return {
      kind: "loaded",
      id: result.capsule.id,
      path: result.path,
      prompt: result.prompt,
    };
  } catch (error) {
    return capsuleErrorView(error);
  }
}

function getCapsuleEntries(session: RuntimeSessionHandle): ContextCapsuleEntry[] {
  return session.getEntries().filter((entry) => isContextCapsuleEntry(entry));
}

function capsuleErrorView(error: unknown): CapsuleCommandView {
  const message =
    error instanceof PortableCapsuleServiceError
      ? `${error.message}${error.issues.length > 0 ? `: ${error.issues.map((issue) => issue.code).join(", ")}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  return { kind: "error", message };
}

function stripWrappingQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value;
}
