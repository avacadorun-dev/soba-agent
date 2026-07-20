import { describe, expect, test } from "bun:test";
import { AgentLoopEventBus } from "../../../src/engine/turn/agent-loop-event-bus";
import type { AgentEvent } from "../../../src/engine/turn/types";

const request = {
  question: "Choose a channel",
  options: [{ id: "stable", label: "Stable" }, { id: "next", label: "Next" }],
};

describe("AgentLoopEventBus clarification barrier", () => {
  test("resolves unavailable when no listener claims synchronously", async () => {
    const flights: Array<Record<string, unknown>> = [];
    const bus = new AgentLoopEventBus({
      shouldEmit: () => true,
      flight: (record) => flights.push(record.payload as Record<string, unknown>),
    });

    await expect(bus.requestClarification(request)).resolves.toEqual({ status: "unavailable" });
    expect(flights).toMatchObject([
      { event: "clarification_requested", optionCount: 2 },
      { event: "clarification_resolved", status: "unavailable" },
    ]);
  });

  test("waits for a claimed request and records only the structured outcome", async () => {
    let clarification: Extract<AgentEvent, { type: "clarification_request" }> | undefined;
    const flights: Array<Record<string, unknown>> = [];
    const bus = new AgentLoopEventBus({
      shouldEmit: () => false,
      flight: (record) => flights.push(record.payload as Record<string, unknown>),
    });
    bus.onEvent((event) => {
      if (event.type !== "clarification_request") return;
      event.claim();
      clarification = event;
    });

    const pending = bus.requestClarification(request);
    clarification?.resolve({ status: "answered", choice: "next", other: "private free text" });

    await expect(pending).resolves.toEqual({ status: "answered", choice: "next", other: "private free text" });
    expect(flights.at(-1)).toEqual({ event: "clarification_resolved", status: "answered", choice: "next" });
    expect(JSON.stringify(flights)).not.toContain("private free text");
  });

  test("abort settles cancelled and ignores a late UI resolution", async () => {
    let clarification: Extract<AgentEvent, { type: "clarification_request" }> | undefined;
    const controller = new AbortController();
    const bus = new AgentLoopEventBus({ shouldEmit: () => true, flight: () => {} });
    bus.onEvent((event) => {
      if (event.type === "clarification_request") {
        event.claim();
        clarification = event;
      }
    });

    const pending = bus.requestClarification(request, controller.signal);
    controller.abort();
    clarification?.resolve({ status: "answered", choice: "stable" });

    await expect(pending).resolves.toEqual({ status: "cancelled" });
  });
});
