import { estimateTokens } from "../../kernel/session/estimation";
import type { SessionEntry, SessionItemEntry } from "../../kernel/transcript/types";
import { isContextCapsuleEntry } from "../../kernel/transcript/types-v2";
import type { RuntimeSessionHandle } from "../session-lifecycle";

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

function getHistoricalSessionTokens(entries: SessionEntry[]): number {
  const items = entries.filter((entry): entry is SessionItemEntry => entry.type === "item").map((entry) => entry.item);
  return estimateTokens(items);
}
