import { describe, expect, test } from "bun:test";
import { AcpRequestRegistry } from "../../../src/adapters/acp/request-registry";

describe("AcpRequestRegistry", () => {
  test("cancels pending requests by session", () => {
    const registry = new AcpRequestRegistry();
    const matchingSignal = registry.begin(1, "session/prompt", "session_a");
    const otherSignal = registry.begin(2, "session/prompt", "session_b");

    expect(registry.cancelBySession("session_a")).toBe(1);

    expect(matchingSignal.aborted).toBe(true);
    expect(otherSignal.aborted).toBe(false);
    expect(registry.listPending()).toEqual([{ id: 2, method: "session/prompt", sessionId: "session_b" }]);
  });

  test("replacing the same JSON-RPC id aborts the previous request", () => {
    const registry = new AcpRequestRegistry();
    const firstSignal = registry.begin("same", "session/prompt", "session_a");
    const secondSignal = registry.begin("same", "session/prompt", "session_a");

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(registry.listPending()).toEqual([{ id: "same", method: "session/prompt", sessionId: "session_a" }]);
  });
});
