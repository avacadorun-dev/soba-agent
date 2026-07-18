import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import { estimateTokens } from "../../kernel/session/estimation";
import type { RuntimeSessionHandle } from "../session-lifecycle";

export interface CompactCommandI18n {
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface CompactCommandEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface CompactCommandView {
  events: CompactCommandEvent[];
}

export interface CompactContextManagerPort {
  manualCompact(
    customInstructions: string | undefined,
    systemPromptTokens: number,
    toolSchemaTokens: number,
    requestFingerprint: string,
  ): Promise<CompactContextManagerOutcome>;
}

export interface CompactContextManagerOutcome {
  status: "completed" | "skipped" | "cancelled" | "stale" | "failed";
  reason?: string;
  checkpointId: string | null;
  strategy: string | null;
  quality: string | null;
  metrics: {
    effectiveTokensBefore: number;
    estimatedTokensAfter: number;
    reclaimedTokens: number;
    savingsRatio: number;
  } | null;
  durationMs?: number;
}

export interface CompactFallbackInput {
  session: RuntimeSessionHandle;
  client: OpenResponsesClient;
  instructions: string | undefined;
  keepRecentTokens: number;
}

export interface CompactFallbackOutcome {
  tokensBefore: number;
  tokensKept: number;
}

export interface CompactFallbackCompactorPort {
  compact(input: CompactFallbackInput): Promise<CompactFallbackOutcome>;
}

export async function executeCompactCommand(input: {
  args: string[];
  session: RuntimeSessionHandle;
  client: OpenResponsesClient;
  contextWindow: number;
  i18n: CompactCommandI18n;
  contextManager?: CompactContextManagerPort;
  fallbackCompactor?: CompactFallbackCompactorPort;
  /** Receives lifecycle events synchronously as they occur. */
  emit?: (event: CompactCommandEvent) => void;
}): Promise<CompactCommandView> {
  const { args, session, client, contextWindow, i18n, contextManager, fallbackCompactor, emit } = input;
  const instructions = args.join(" ") || undefined;
  const tokens = estimateTokens(session.buildInput().items);
  const events: CompactCommandEvent[] = [];
  const publish = (event: CompactCommandEvent) => {
    events.push(event);
    emit?.(event);
  };
  const operationId = `manual-compact:${Date.now()}`;

  if (tokens <= contextWindow * 0.7) {
    publish({
      type: "info",
      timestamp: Date.now(),
      message: i18n.t("command.compact.manualBelowThreshold", { tokens, contextWindow }),
    });
  }

  publish({
    type: "compaction_start",
    timestamp: Date.now(),
    operationId,
    trigger: "user_request",
    tokensBefore: tokens,
    effectiveTokens: tokens,
    softLimit: Math.floor(contextWindow * 0.8),
    hardLimit: contextWindow,
    required: false,
    source: "estimated",
    checkpointId: null,
    quality: null,
    strategy: null,
    durationMs: 0,
    reclaimedTokens: 0,
  });

  try {
    if (contextManager) {
      await runManagedCompaction({ contextManager, instructions, tokens, session, i18n, publish, operationId, contextWindow });
    } else {
      await runFallbackCompaction({ fallbackCompactor, session, client, instructions, tokens, publish, operationId, contextWindow });
    }
  } catch (error) {
    publish({
      type: "error",
      timestamp: Date.now(),
      message: i18n.t("compact.failed", { error: error instanceof Error ? error.message : String(error) }),
    });
    publish({
      type: "compaction_failed",
      timestamp: Date.now(),
      operationId,
      trigger: "user_request",
      reason: "failed",
      tokensBefore: tokens,
      tokensAfter: estimateTokens(session.buildInput().items),
      reclaimedTokens: 0,
      durationMs: 0,
      softLimit: Math.floor(contextWindow * 0.8),
      hardLimit: contextWindow,
      required: false,
      checkpointId: null,
      quality: null,
      strategy: null,
    });
  }

  return { events };
}

async function runManagedCompaction(input: {
  contextManager: CompactContextManagerPort;
  instructions: string | undefined;
  tokens: number;
  session: RuntimeSessionHandle;
  i18n: CompactCommandI18n;
  publish: (event: CompactCommandEvent) => void;
  operationId: string;
  contextWindow: number;
}): Promise<void> {
  const { contextManager, instructions, tokens, session, i18n, publish, operationId, contextWindow } = input;
  const systemPromptTokens = 1000;
  const toolSchemaTokens = 500;
  const requestFingerprint = `manual_compact_${Date.now()}`;

  const outcome = await contextManager.manualCompact(
    instructions,
    systemPromptTokens,
    toolSchemaTokens,
    requestFingerprint,
  );

  if (outcome.status === "completed") {
    const tokensAfter = outcome.metrics?.estimatedTokensAfter ?? estimateTokens(session.buildInput().items);
    const reclaimedTokens = outcome.metrics?.reclaimedTokens ?? Math.max(0, tokens - tokensAfter);
    publish({
      type: "compaction_done",
      timestamp: Date.now(),
      operationId,
      trigger: "user_request",
      tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
      tokensAfter,
      tokensSaved: reclaimedTokens,
      reclaimedTokens,
      strategy: outcome.strategy ?? "unknown",
      quality: outcome.quality,
      checkpointId: outcome.checkpointId,
      durationMs: outcome.durationMs ?? 0,
      softLimit: Math.floor(contextWindow * 0.8),
      hardLimit: contextWindow,
      required: false,
    });

    publish({
      type: "info",
      timestamp: Date.now(),
      message: i18n.t("command.compact.capsuleInfo", {
        checkpointId: outcome.checkpointId ?? "",
        strategy: outcome.strategy ?? "",
        quality: outcome.quality ?? "",
        savingsRatio: ((outcome.metrics?.savingsRatio ?? 0) * 100).toFixed(1),
      }),
    });
    return;
  }

  publish({
    type: "info",
    timestamp: Date.now(),
    message: i18n.t("command.compact.noOp", { reason: outcome.reason ?? "no reclaimable context" }),
  });
  publish({
    type: outcome.status === "cancelled" ? "compaction_cancelled" : outcome.status === "failed" ? "compaction_failed" : "compaction_skipped",
    timestamp: Date.now(),
    operationId,
    trigger: "user_request",
    reason: outcome.reason ?? "no reclaimable context",
    tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
    tokensAfter: outcome.metrics?.estimatedTokensAfter ?? estimateTokens(session.buildInput().items),
    reclaimedTokens: outcome.metrics?.reclaimedTokens ?? 0,
    durationMs: 0,
    softLimit: Math.floor(contextWindow * 0.8),
    hardLimit: contextWindow,
    required: false,
    checkpointId: null,
    quality: null,
    strategy: outcome.strategy,
  });
}

async function runFallbackCompaction(input: {
  fallbackCompactor: CompactFallbackCompactorPort | undefined;
  session: RuntimeSessionHandle;
  client: OpenResponsesClient;
  instructions: string | undefined;
  tokens: number;
  publish: (event: CompactCommandEvent) => void;
  operationId: string;
  contextWindow: number;
}): Promise<void> {
  const { fallbackCompactor, session, client, instructions, tokens, publish, operationId, contextWindow } = input;
  if (!fallbackCompactor) {
    throw new Error("Compact fallback is not configured");
  }
  const keepRecentTokens = Math.min(8000, Math.floor(tokens * 0.5));
  const result = await fallbackCompactor.compact({ session, client, instructions, keepRecentTokens });
  const tokensAfter = estimateTokens(session.buildInput().items);
  const reclaimedTokens = Math.max(0, result.tokensBefore - result.tokensKept);
  publish({
    type: "compaction_done",
    timestamp: Date.now(),
    operationId,
    trigger: "user_request",
    tokensBefore: result.tokensBefore,
    tokensAfter,
    tokensSaved: reclaimedTokens,
    reclaimedTokens,
    strategy: "legacy",
    quality: null,
    checkpointId: null,
    durationMs: 0,
    softLimit: Math.floor(contextWindow * 0.8),
    hardLimit: contextWindow,
    required: false,
  });
}
