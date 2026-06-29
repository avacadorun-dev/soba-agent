import { compact } from "../../engine/compaction/compaction";
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
  compacted: boolean;
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
}

export async function executeCompactCommand(input: {
  args: string[];
  session: RuntimeSessionHandle;
  client: OpenResponsesClient;
  contextWindow: number;
  i18n: CompactCommandI18n;
  contextManager?: CompactContextManagerPort;
}): Promise<CompactCommandView> {
  const { args, session, client, contextWindow, i18n, contextManager } = input;
  const instructions = args.join(" ") || undefined;
  const tokens = estimateTokens(session.buildInput().items);
  const events: CompactCommandEvent[] = [];

  if (tokens <= contextWindow * 0.7) {
    events.push({
      type: "info",
      timestamp: Date.now(),
      message: i18n.t("command.compact.manualBelowThreshold", { tokens, contextWindow }),
    });
  }

  events.push({
    type: "compaction_start",
    timestamp: Date.now(),
    tokensBefore: tokens,
  });

  try {
    if (contextManager) {
      await runManagedCompaction({ contextManager, instructions, tokens, session, i18n, events });
    } else {
      await runFallbackCompaction({ session, client, instructions, tokens, events });
    }
  } catch (error) {
    events.push({
      type: "error",
      timestamp: Date.now(),
      message: i18n.t("compact.failed", { error: error instanceof Error ? error.message : String(error) }),
    });
    events.push({
      type: "compaction_skipped",
      timestamp: Date.now(),
      reason: "failed",
      tokensBefore: tokens,
      tokensAfter: estimateTokens(session.buildInput().items),
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
  events: CompactCommandEvent[];
}): Promise<void> {
  const { contextManager, instructions, tokens, session, i18n, events } = input;
  const systemPromptTokens = 1000;
  const toolSchemaTokens = 500;
  const requestFingerprint = `manual_compact_${Date.now()}`;

  const outcome = await contextManager.manualCompact(
    instructions,
    systemPromptTokens,
    toolSchemaTokens,
    requestFingerprint,
  );

  if (outcome.compacted) {
    events.push({
      type: "compaction_done",
      timestamp: Date.now(),
      reason: "manual",
      tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
      tokensAfter: outcome.metrics?.estimatedTokensAfter ?? estimateTokens(session.buildInput().items),
      tokensSaved: outcome.metrics?.reclaimedTokens ?? 0,
      strategy: outcome.strategy ?? "unknown",
    });

    events.push({
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

  events.push({
    type: "info",
    timestamp: Date.now(),
    message: i18n.t("command.compact.noOp", { reason: outcome.reason ?? "no reclaimable context" }),
  });
  events.push({
    type: "compaction_skipped",
    timestamp: Date.now(),
    reason: outcome.reason ?? "no reclaimable context",
    tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
    tokensAfter: outcome.metrics?.estimatedTokensAfter ?? estimateTokens(session.buildInput().items),
  });
}

async function runFallbackCompaction(input: {
  session: RuntimeSessionHandle;
  client: OpenResponsesClient;
  instructions: string | undefined;
  tokens: number;
  events: CompactCommandEvent[];
}): Promise<void> {
  const { session, client, instructions, tokens, events } = input;
  const keepRecentTokens = Math.min(8000, Math.floor(tokens * 0.5));
  const result = await compact(session, client, { instructions, keepRecentTokens });
  events.push({
    type: "compaction_done",
    timestamp: Date.now(),
    tokensBefore: result.tokensBefore,
    tokensAfter: estimateTokens(session.buildInput().items),
    savedTokens: result.tokensBefore - result.tokensKept,
  });
}
