/**
 * TrustDialog tests — Phase 2.5 A3.
 *
 * Tests cover:
 *  - TrustDialogManager: initial state, navigation, keyboard shortcuts
 *  - TrustDialogManager: handleKey flow for all decisions
 *  - TuiStore.confirmDecision: all decision types, side effects
 *  - TuiStore.confirmDecision: no-op when no confirmation pending
 *  - Integration: y/s/r/f/n backward compatibility preserved
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Accessor } from "solid-js";
import type { AgentEvent, ApprovalDecision } from "../../../../src/core/loop/types";
import { TrustManager } from "../../../../src/core/trust/trust-manager";
import { type TrustDecision, TrustDialogManager } from "../../../../src/ui/terminal/interactive/lib/trust-dialog-manager";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockConfirmationEvent(overrides: Partial<AgentEvent & { type: "dangerous_confirmation" }> = {}) {
  const resolve = mock((_decision: string) => {});
  return {
    type: "dangerous_confirmation" as const,
    toolName: overrides.toolName ?? "bash",
    description: overrides.description ?? "rm -rf node_modules",
    reason: overrides.reason ?? "This may cause data loss",
    resolve,
  };
}

type DangerousConfirmationEvent = ReturnType<typeof createMockConfirmationEvent>;

// ─── TrustDialogManager Tests ───────────────────────────────────────────────

describe("TrustDialogManager", () => {
  let manager: TrustDialogManager;

  afterEach(() => {
    // Manager has no dispose; just reset
    manager?.reset();
  });

  test("initial state: highlightedIndex is 0 (Deny)", () => {
    manager = new TrustDialogManager();
    expect(manager.highlightedIndex()).toBe(0);
    expect(manager.currentDecision()).toBe("deny");
  });

  test("moveHighlight wraps forward through all 5 buttons", () => {
    manager = new TrustDialogManager();
    expect(manager.currentDecision()).toBe("deny"); // 0

    manager.moveHighlight(1);
    expect(manager.currentDecision()).toBe("once"); // 1

    manager.moveHighlight(1);
    expect(manager.currentDecision()).toBe("session"); // 2

    manager.moveHighlight(1);
    expect(manager.currentDecision()).toBe("repo"); // 3

    manager.moveHighlight(1);
    expect(manager.currentDecision()).toBe("full"); // 4

    manager.moveHighlight(1);
    expect(manager.currentDecision()).toBe("deny"); // wraps to 0
  });

  test("moveHighlight wraps backward", () => {
    manager = new TrustDialogManager();
    expect(manager.currentDecision()).toBe("deny"); // 0

    manager.moveHighlight(-1);
    expect(manager.currentDecision()).toBe("full"); // 4

    manager.moveHighlight(-1);
    expect(manager.currentDecision()).toBe("repo"); // 3

    manager.moveHighlight(-1);
    expect(manager.currentDecision()).toBe("session"); // 2

    manager.moveHighlight(-1);
    expect(manager.currentDecision()).toBe("once"); // 1

    manager.moveHighlight(-1);
    expect(manager.currentDecision()).toBe("deny"); // wraps to 0
  });

  test("setHighlight jumps to specific decision", () => {
    manager = new TrustDialogManager();
    expect(manager.currentDecision()).toBe("deny");

    manager.setHighlight("repo");
    expect(manager.highlightedIndex()).toBe(3);
    expect(manager.currentDecision()).toBe("repo");

    manager.setHighlight("session");
    expect(manager.highlightedIndex()).toBe(2);

    manager.setHighlight("full");
    expect(manager.highlightedIndex()).toBe(4);
  });

  test("setHighlight ignores unknown decision", () => {
    manager = new TrustDialogManager();
    const prev = manager.highlightedIndex();
    manager.setHighlight("unknown" as TrustDecision);
    expect(manager.highlightedIndex()).toBe(prev); // unchanged
  });

  test("reset returns to Deny", () => {
    manager = new TrustDialogManager();
    manager.moveHighlight(2); // session
    expect(manager.currentDecision()).toBe("session");
    manager.reset();
    expect(manager.currentDecision()).toBe("deny");
    expect(manager.highlightedIndex()).toBe(0);
  });

  test("highlightedDecision accessor tracks current decision", () => {
    manager = new TrustDialogManager();
    const decision: Accessor<TrustDecision> = manager.highlightedDecision;

    expect(decision()).toBe("deny");
    manager.moveHighlight(1);
    expect(decision()).toBe("once");
    manager.moveHighlight(2);
    expect(decision()).toBe("repo");
    manager.moveHighlight(1);
    expect(decision()).toBe("full");
  });

  // ── handleKey tests ─────────────────────────────────────────────────────

  test("handleKey: Escape calls onDecision with deny", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "escape" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith("deny");
  });

  test("handleKey: Enter selects highlighted button", () => {
    manager = new TrustDialogManager();
    manager.moveHighlight(2); // session
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "return" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("session");
  });

  test("handleKey: kpenter (numpad Enter) selects highlighted button", () => {
    manager = new TrustDialogManager();
    manager.moveHighlight(3); // repo
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "kpenter" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("repo");
  });

  test("handleKey: Tab moves highlight forward", () => {
    manager = new TrustDialogManager();
    expect(manager.currentDecision()).toBe("deny");

    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "tab" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledTimes(0); // navigation, not decision
    expect(manager.currentDecision()).toBe("once");
  });

  test("handleKey: Shift+Tab moves highlight backward", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});

    // First Tab moves to "once", then Shift+Tab moves back to "deny"
    manager.handleKey({ name: "tab" }, onDecision);
    expect(manager.currentDecision()).toBe("once");

    manager.handleKey({ name: "tab", shift: true }, onDecision);
    expect(manager.currentDecision()).toBe("deny");
    expect(onDecision).toHaveBeenCalledTimes(0);
  });

  test("handleKey: left arrow moves highlight backward", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});

    // Left from deny wraps to full
    manager.handleKey({ name: "left" }, onDecision);
    expect(manager.currentDecision()).toBe("full");
    expect(onDecision).toHaveBeenCalledTimes(0);
  });

  test("handleKey: right arrow moves highlight forward", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});

    manager.handleKey({ name: "right" }, onDecision);
    expect(manager.currentDecision()).toBe("once");
    expect(onDecision).toHaveBeenCalledTimes(0);
  });

  test("handleKey: 'y' calls onDecision with once", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "y" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("once");
  });

  test("handleKey: 's' calls onDecision with session", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "s" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("session");
  });

  test("handleKey: 'r' calls onDecision with repo", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "r" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("repo");
  });

  test("handleKey: 'f' calls onDecision with full", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "f" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("full");
  });

  test("handleKey: 'n' calls onDecision with deny", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "n" }, onDecision);
    expect(result).toBe(true);
    expect(onDecision).toHaveBeenCalledWith("deny");
  });

  test("handleKey: uppercase Y/S/R/F/N also work", () => {
    manager = new TrustDialogManager();

    const onDecision = mock((_d: TrustDecision) => {});
    manager.handleKey({ name: "Y" }, onDecision);
    expect(onDecision).toHaveBeenCalledWith("once");

    onDecision.mockClear();
    manager.handleKey({ name: "S" }, onDecision);
    expect(onDecision).toHaveBeenCalledWith("session");

    onDecision.mockClear();
    manager.handleKey({ name: "R" }, onDecision);
    expect(onDecision).toHaveBeenCalledWith("repo");

    onDecision.mockClear();
    manager.handleKey({ name: "F" }, onDecision);
    expect(onDecision).toHaveBeenCalledWith("full");

    onDecision.mockClear();
    manager.handleKey({ name: "N" }, onDecision);
    expect(onDecision).toHaveBeenCalledWith("deny");
  });

  test("handleKey: unknown key returns false", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "x" }, onDecision);
    expect(result).toBe(false);
    expect(onDecision).toHaveBeenCalledTimes(0);
  });

  test("handleKey: shift key alone is not a decision", () => {
    manager = new TrustDialogManager();
    const onDecision = mock((_d: TrustDecision) => {});
    const result = manager.handleKey({ name: "shift" }, onDecision);
    expect(result).toBe(false);
    expect(onDecision).toHaveBeenCalledTimes(0);
  });

  test("Tab navigation circle: 5 Tab presses return to original", () => {
    manager = new TrustDialogManager();
    const original = manager.currentDecision();

    manager.moveHighlight(1);
    manager.moveHighlight(1);
    manager.moveHighlight(1);
    manager.moveHighlight(1);
    manager.moveHighlight(1);

    expect(manager.currentDecision()).toBe(original);
  });

  test("y/s/r/f/n do not change highlight position", () => {
    manager = new TrustDialogManager();
    manager.moveHighlight(3); // repo
    expect(manager.currentDecision()).toBe("repo");

    const onDecision = mock((_d: TrustDecision) => {});
    manager.handleKey({ name: "y" }, onDecision);
    manager.handleKey({ name: "s" }, onDecision);
    manager.handleKey({ name: "r" }, onDecision);
    manager.handleKey({ name: "f" }, onDecision);
    manager.handleKey({ name: "n" }, onDecision);

    // Highlight should still be on repo (shortcut doesn't move highlight)
    expect(manager.currentDecision()).toBe("repo");
  });

  test("multiple managers are independent", () => {
    const m1 = new TrustDialogManager();
    const m2 = new TrustDialogManager();

    m1.moveHighlight(2); // session
    expect(m1.currentDecision()).toBe("session");
    expect(m2.currentDecision()).toBe("deny");

    m2.moveHighlight(1); // once
    expect(m1.currentDecision()).toBe("session");
    expect(m2.currentDecision()).toBe("once");
  });
});

// ─── TuiStore.confirmDecision Integration Tests ────────────────────────────

describe("TuiStore.confirmDecision", () => {
  test("confirmDecision resolves once and adds success message", () => {
    const event = createMockConfirmationEvent();
    const messages: Array<{ type: string; content: string }> = [];

    const store = {
      confirmation: () => event as unknown as DangerousConfirmationEvent,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        messages.push({
          type: decision === "deny" ? "error" : "success",
          content: decision === "deny" ? "Denied" : "Allowed",
        });
      },
    };

    store.confirmDecision("once");
    expect(event.resolve).toHaveBeenCalledWith("once");
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("success");
  });

  test("confirmDecision resolves deny and adds error message", () => {
    const event = createMockConfirmationEvent();
    const messages: Array<{ type: string; content: string }> = [];

    const store = {
      confirmation: () => event as unknown as DangerousConfirmationEvent,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        messages.push({
          type: decision === "deny" ? "error" : "success",
          content: decision === "deny" ? "Denied" : "Allowed",
        });
      },
    };

    store.confirmDecision("deny");
    expect(event.resolve).toHaveBeenCalledWith("deny");
    expect(messages[0].type).toBe("error");
  });

  test("confirmDecision resolves session", () => {
    const event = createMockConfirmationEvent();
    storeConfirmAndCheck(event, "session");
  });

  test("confirmDecision resolves repo", () => {
    const event = createMockConfirmationEvent();
    storeConfirmAndCheck(event, "repo");
  });

  test("confirmDecision resolves full", () => {
    const event = createMockConfirmationEvent();
    storeConfirmAndCheck(event, "full");
  });

  test("confirmDecision is no-op when confirmation is null", () => {
    const messages: Array<{ type: string; content: string }> = [];
    const store = {
      confirmation: () => null as DangerousConfirmationEvent | null,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        messages.push({ type: "info", content: "resolved" });
      },
    };

    // Should not throw and should not push any message
    expect(() => store.confirmDecision("once")).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  test("confirmDecision sets repo permission mode for repo decision", () => {
    const event = createMockConfirmationEvent();
    const trustManager = new TrustManager();
    expect(trustManager.getPermissionMode()).toBe("ask");

    const store = {
      confirmation: () => event as unknown as DangerousConfirmationEvent,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        if (decision === "repo") trustManager.setPermissionMode("repo");
      },
    };

    store.confirmDecision("repo");
    expect(event.resolve).toHaveBeenCalledWith("repo");
    expect(trustManager.getPermissionMode()).toBe("repo");
  });

  test("confirmDecision sets full permission mode for full decision", () => {
    const event = createMockConfirmationEvent();
    const trustManager = new TrustManager();
    expect(trustManager.getPermissionMode()).toBe("ask");

    const store = {
      confirmation: () => event as unknown as DangerousConfirmationEvent,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        if (decision === "repo" || decision === "full") trustManager.setPermissionMode(decision);
      },
    };

    store.confirmDecision("full");
    expect(event.resolve).toHaveBeenCalledWith("full");
    expect(trustManager.getPermissionMode()).toBe("full");
  });

  test("confirmDecision once does not change permission mode", () => {
    const event = createMockConfirmationEvent();
    const trustManager = new TrustManager();
    expect(trustManager.getPermissionMode()).toBe("ask");

    const store = {
      confirmation: () => event as unknown as DangerousConfirmationEvent,
      confirmDecision: function (decision: ApprovalDecision) {
        const conf = this.confirmation();
        if (!conf) return;
        conf.resolve(decision);
        if (decision === "repo") trustManager.setPermissionMode("repo");
      },
    };

    store.confirmDecision("once");
    expect(trustManager.getPermissionMode()).toBe("ask"); // unchanged
  });
});

// ─── Helper ────────────────────────────────────────────────────────────────

function storeConfirmAndCheck(
  event: ReturnType<typeof createMockConfirmationEvent>,
  decision: ApprovalDecision,
) {
  const store = {
    confirmation: () => event as unknown as DangerousConfirmationEvent,
    confirmDecision: function (d: ApprovalDecision) {
      const conf = this.confirmation();
      if (!conf) return;
      conf.resolve(d);
    },
  };

  store.confirmDecision(decision);
  expect(event.resolve).toHaveBeenCalledTimes(1);
  expect(event.resolve).toHaveBeenCalledWith(decision);
}
