import type { ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { PlanItem } from "../../kernel/tools/checkpoint";
import type { DebugEntry, ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import { EvidenceLedger } from "../evidence/evidence-ledger";
import { allowsUnverifiedCompletion, inferTaskKindFromPrompt } from "../verification/verification-policy";
import { emitWorkingNarration } from "./agent-turn-runner-events";
import { createWorkingNarrationGate, isNonTrivialPrompt, type WorkingNarrationEmitter } from "./narration";
import { type AgentUserInput, createUserItem, userInputToText } from "./turn-helpers";
import type { AgentEvent, AgentTurnError } from "./types";

interface BeginAgentTurnState {
  turnCount: number;
  isProcessing: boolean;
  denialCount: number;
  lastDeniedOperation: string;
}

export interface BeginAgentTurnResult {
  abortController: AbortController;
  turnIndex: number;
  errors: AgentTurnError[];
  allItems: ItemParam[];
  evidenceLedger: EvidenceLedger;
  taskKind: ReturnType<typeof inferTaskKindFromPrompt>;
  allowUnverifiedCompletion: boolean;
  emitNarrationOnce: WorkingNarrationEmitter;
}

export function beginAgentTurn(input: {
  userInput: AgentUserInput;
  session: SessionPort;
  state: BeginAgentTurnState;
  setAbortController(controller: AbortController): void;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  knownFailures?: import("../verification/verification-baseline").KnownFailureDeclaration[];
}): BeginAgentTurnResult {
  const { userInput, session, state, setAbortController, emit, debug } = input;
  const userText = userInputToText(userInput);
  if (state.isProcessing) {
    throw new Error("Agent is already processing a turn");
  }

  state.isProcessing = true;
  state.turnCount++;
  state.denialCount = 0;
  state.lastDeniedOperation = "";

  const abortController = new AbortController();
  setAbortController(abortController);
  const turnIndex = state.turnCount;
  const errors: AgentTurnError[] = [];
  const allItems: ItemParam[] = [];
  const evidenceLedger = new EvidenceLedger();
  const persistedPlan = readPersistedPlan(session.getSessionConfig("soba.plan"));
  if (persistedPlan.length > 0) {
    evidenceLedger.setPlanItems(persistedPlan);
  }
  if (input.knownFailures && input.knownFailures.length > 0) {
    evidenceLedger.setKnownFailures(input.knownFailures);
  }
  const taskKind = inferTaskKindFromPrompt(userText);
  const allowUnverifiedCompletion = allowsUnverifiedCompletion(userText);
  const emitNarrationOnce = createWorkingNarrationGate({
    enabled: isNonTrivialPrompt(userText),
    emit: (eventType, message, evidenceIds = []) => emitWorkingNarration(emit, eventType, message, evidenceIds),
  });

  emit({
    type: "turn_start",
    timestamp: Date.now(),
    turnIndex,
    userInput: userText,
  });

  const userItem = createUserItem(userInput);
  session.appendItem(userItem as unknown as SessionItemParam);
  allItems.push(userItem as unknown as ItemParam);
  debug({
    event: "loop/turn-start",
    turn: turnIndex,
    detail: userText.slice(0, 200),
  });

  return {
    abortController,
    turnIndex,
    errors,
    allItems,
    evidenceLedger,
    taskKind,
    allowUnverifiedCompletion,
    emitNarrationOnce,
  };
}

function readPersistedPlan(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  const validStatuses = new Set(["pending", "active", "done", "blocked"]);
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) return [];
    const status = validStatuses.has(record.status as string)
      ? (record.status as PlanItem["status"])
      : "pending";
    const evidenceIds = Array.isArray(record.evidenceIds)
      ? record.evidenceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return [{ title, status, ...(evidenceIds.length > 0 ? { evidenceIds } : {}) }];
  });
}

