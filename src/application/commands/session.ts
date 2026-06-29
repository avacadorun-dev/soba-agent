import { estimateTokens } from "../../kernel/session/estimation";
import type { FlightRecordEntry, SessionEntry, SessionItemEntry } from "../../kernel/transcript/types";
import { isContextCapsuleEntry } from "../../kernel/transcript/types-v2";
import type { RuntimeSessionHandle, SessionLifecycleService } from "../session-lifecycle";
import type { RuntimeSessionInfo } from "../types";

export interface SessionCommandConfig {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface SessionContextSnapshotView {
  effectiveTokens: number;
  historicalTokens: number;
  hardLimit: number;
  source: string;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  safetyReserveTokens: number;
  maxOutputTokens: number;
  watermark?: {
    measuredThroughEntryId?: string | null;
    requestFingerprint: string;
  } | null;
}

export interface SessionStatusView {
  sessionId: string;
  version: "v1" | "v2";
  entryCount: number;
  compactionCount: number;
  capsuleCount: number;
  branchEntryCount: number;
  effectiveTokens: number;
  historicalTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  persisted: boolean;
  cwd: string;
  contextSnapshot?: SessionContextSnapshotView;
}

export interface BudgetStatusView {
  tokens: number;
  formattedTokens: string;
}

export type RewindCommandView =
  | { kind: "empty" }
  | { kind: "list"; checkpoints: RewindCheckpointView[] }
  | { kind: "not_found"; checkpointId: string }
  | { kind: "complete"; checkpointId: string };

export type RewindCheckpointView =
  | { kind: "compaction"; id: string; timestamp: string }
  | { kind: "capsule"; id: string; strategy: string; timestamp: string };

export type SessionsCommandView =
  | { kind: "error"; message: string }
  | { kind: "usage"; message: string }
  | { kind: "list"; activeSessionId: string; sessions: SessionsListItemView[] }
  | { kind: "resumed"; session: RuntimeSessionHandle }
  | { kind: "closed"; sessionId: string }
  | { kind: "deleted"; sessionId: string };

export interface SessionsListItemView extends RuntimeSessionInfo {
  active: boolean;
  evidence: string;
}

export function buildSessionStatusView(input: {
  session: RuntimeSessionHandle;
  config: SessionCommandConfig;
  contextSnapshot?: SessionContextSnapshotView;
}): SessionStatusView {
  const { session, config, contextSnapshot } = input;
  const entries = session.getEntries();

  return {
    sessionId: session.getSessionId(),
    version: session.isV2() ? "v2" : "v1",
    entryCount: entries.length,
    compactionCount: entries.filter((entry) => entry.type === "compaction").length,
    capsuleCount: entries.filter((entry) => isContextCapsuleEntry(entry)).length,
    branchEntryCount: session.getBranch().length,
    effectiveTokens: estimateTokens(session.buildInput().items),
    historicalTokens: getHistoricalSessionTokens(entries),
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    persisted: session.isPersisted(),
    cwd: session.getCwd(),
    contextSnapshot,
  };
}

export function buildBudgetStatusView(session: RuntimeSessionHandle): BudgetStatusView {
  const tokens = estimateTokens(session.buildInput().items);
  return {
    tokens,
    formattedTokens: `${(tokens / 1000).toFixed(1)}K`,
  };
}

export function executeRewindCommand(input: {
  args: string[];
  session: RuntimeSessionHandle;
}): RewindCommandView {
  const checkpointId = input.args[0];
  const entries = input.session.getEntries();
  const compactionCheckpoints = entries.filter((entry) => entry.type === "compaction");
  const capsules = entries.filter((entry) => isContextCapsuleEntry(entry));

  if (!checkpointId) {
    const checkpoints: RewindCheckpointView[] = [
      ...compactionCheckpoints.map((entry) => ({
        kind: "compaction" as const,
        id: entry.id,
        timestamp: entry.timestamp,
      })),
      ...capsules.map((entry) => ({
        kind: "capsule" as const,
        id: entry.checkpointId,
        strategy: entry.strategy,
        timestamp: entry.timestamp,
      })),
    ];
    return checkpoints.length > 0 ? { kind: "list", checkpoints } : { kind: "empty" };
  }

  const checkpoint = compactionCheckpoints.find((entry) => entry.id === checkpointId || entry.id.startsWith(checkpointId));
  const capsule = capsules.find((entry) => entry.checkpointId === checkpointId || entry.checkpointId.startsWith(checkpointId));
  const targetEntry = checkpoint ?? capsule;
  if (!targetEntry) {
    return { kind: "not_found", checkpointId };
  }

  input.session.branch(targetEntry.id);
  return { kind: "complete", checkpointId: targetEntry.id };
}

export function executeSessionsCommand(input: {
  args: string[];
  session: RuntimeSessionHandle;
  lifecycle?: SessionLifecycleService;
}): SessionsCommandView {
  const { args, session, lifecycle } = input;
  const action = args[0]?.toLowerCase() ?? "list";

  if (!lifecycle) {
    return { kind: "error", message: "Sessions lifecycle is not configured." };
  }

  try {
    switch (action) {
      case "list":
      case "ls":
        return buildSessionsListView(session, lifecycle);
      case "resume":
      case "load":
      case "open":
        return resumeSessionCommand(args[1], lifecycle);
      case "close":
        return closeSessionCommand(args[1], session, lifecycle);
      case "delete":
      case "remove":
      case "rm":
        return deleteSessionCommand(args[1], session, lifecycle);
      default:
        return { kind: "usage", message: "Usage: /sessions list|resume <id>|load <id>|close [id]|delete <id>" };
    }
  } catch (error) {
    return {
      kind: "error",
      message: `Sessions error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function getHistoricalSessionTokens(entries: SessionEntry[]): number {
  const items = entries.filter((entry): entry is SessionItemEntry => entry.type === "item").map((entry) => entry.item);
  return estimateTokens(items);
}

function buildSessionsListView(session: RuntimeSessionHandle, lifecycle: SessionLifecycleService): SessionsCommandView {
  const activeSessionId = session.getSessionId();
  return {
    kind: "list",
    activeSessionId,
    sessions: lifecycle.listSessions({ cwd: session.getCwd() }).map((listedSession) => ({
      ...listedSession,
      active: listedSession.id === activeSessionId,
      evidence: sessionEvidenceSummary(lifecycle, listedSession.id),
    })),
  };
}

function resumeSessionCommand(sessionId: string | undefined, lifecycle: SessionLifecycleService): SessionsCommandView {
  if (!sessionId) {
    return { kind: "usage", message: "Usage: /sessions resume <id>" };
  }

  return {
    kind: "resumed",
    session: lifecycle.resumeSessionManager({ sessionId }),
  };
}

function closeSessionCommand(
  sessionId: string | undefined,
  session: RuntimeSessionHandle,
  lifecycle: SessionLifecycleService,
): SessionsCommandView {
  const target = sessionId ?? session.getSessionId();
  lifecycle.closeSession(target);
  return { kind: "closed", sessionId: target };
}

function deleteSessionCommand(
  sessionId: string | undefined,
  session: RuntimeSessionHandle,
  lifecycle: SessionLifecycleService,
): SessionsCommandView {
  if (!sessionId) {
    return { kind: "usage", message: "Usage: /sessions delete <id>" };
  }

  const activeId = session.getSessionId();
  if (activeId.startsWith(sessionId) || sessionId === activeId) {
    return { kind: "error", message: "Cannot delete the active session. Resume another session first." };
  }

  lifecycle.deleteSession(sessionId);
  return { kind: "deleted", sessionId };
}

function sessionEvidenceSummary(lifecycle: SessionLifecycleService, sessionId: string): string {
  try {
    const session = lifecycle.loadSessionManager({ sessionId });
    const records = session.getFlightRecords();
    let evidence: FlightRecordEntry | undefined = records[records.length - 1];
    for (let index = records.length - 1; index >= 0; index--) {
      if (records[index]?.data.kind === "evidence_bundle") {
        evidence = records[index];
        break;
      }
      evidence = undefined;
    }
    if (!evidence) {
      return records.length > 0 ? `records:${records.length}` : "none";
    }
    const payload = evidence.data.payload;
    if (payload && typeof payload === "object" && "status" in payload && typeof payload.status === "string") {
      return payload.status;
    }
    return "recorded";
  } catch {
    return "unavailable";
  }
}
