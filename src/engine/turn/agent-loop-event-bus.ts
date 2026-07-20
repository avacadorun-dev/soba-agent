import type { AskUserArgs, ClarificationOutcome } from "../../kernel/tools/ask-user";
import type { FlightRecordData } from "../../kernel/transcript/types";
import { runtimeFlightRecords } from "./agent-loop-event-recording";
import type { AgentEvent, ClarificationRequestEvent, DangerousConfirmationEvent } from "./types";

export interface AgentLoopEventBusOptions {
  shouldEmit(): boolean;
  flight(data: Omit<FlightRecordData, "version">): void;
}

export class AgentLoopEventBus {
  private listeners: Array<(event: AgentEvent) => void> = [];
  private readonly options: AgentLoopEventBusOptions;

  constructor(options: AgentLoopEventBusOptions) {
    this.options = options;
  }

  hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  emit(event: AgentEvent): void {
    this.recordRuntimeFlight(event);
    if (!this.options.shouldEmit()) return;
    this.dispatch(event);
  }

  dispatchDangerousConfirmationEvent(event: DangerousConfirmationEvent): void {
    this.options.flight({
      kind: "approval",
      payload: {
        status: "requested",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        description: event.description,
        level: event.level,
        reason: event.reason,
      },
    });

    const recordingEvent: DangerousConfirmationEvent = {
      ...event,
      resolve: (decision) => {
        this.options.flight({
          kind: "approval",
          payload: {
            status: "decided",
            decision,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            description: event.description,
            level: event.level,
            reason: event.reason,
          },
        });
        event.resolve(decision);
      },
    };

    // Permission prompts must bypass the ordinary emitEvents flag.
    this.dispatch(recordingEvent);
  }

  requestClarification(request: AskUserArgs, signal?: AbortSignal): Promise<ClarificationOutcome> {
    return new Promise((resolve) => {
      let claimed = false;
      let settled = false;
      const onAbort = () => settle({ status: "cancelled" });
      const settle = (outcome: ClarificationOutcome) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.options.flight({
          kind: "runtime_event",
          payload: {
            event: "clarification_resolved",
            status: outcome.status,
            ...(outcome.status === "answered" ? { choice: outcome.choice } : {}),
          },
        });
        resolve(outcome);
      };
      if (signal?.aborted) {
        settle({ status: "cancelled" });
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.options.flight({
        kind: "runtime_event",
        payload: {
          event: "clarification_requested",
          optionCount: request.options.length,
          allowOther: request.allowOther === true,
        },
      });
      const event: ClarificationRequestEvent = {
        type: "clarification_request",
        timestamp: Date.now(),
        request,
        claim: () => {
          claimed = true;
        },
        resolve: settle,
      };
      this.dispatch(event);
      if (!claimed) settle({ status: "unavailable" });
    });
  }

  private recordRuntimeFlight(event: AgentEvent): void {
    for (const record of runtimeFlightRecords(event)) {
      this.options.flight(record);
    }
  }

  private dispatch(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not crash the agent turn.
      }
    }
  }
}
