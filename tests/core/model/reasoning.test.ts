import { describe, expect, test } from "bun:test";
import {
  isReasoningTransport,
  parseReasoningConfigValue,
  resolveReasoningSelection,
} from "../../../src/kernel/model/reasoning";

describe("reasoning policy", () => {
  test("keeps an explicitly supported effort", () => {
    const resolved = resolveReasoningSelection(
      { mode: "effort", effort: "xhigh" },
      { control: "effort", supportedEfforts: ["low", "high", "xhigh"] },
    );

    expect(resolved.effective).toEqual({ mode: "effort", effort: "xhigh" });
    expect(resolved.fallbackReason).toBeUndefined();
  });

  test("falls back to provider default without clamping an unsupported effort", () => {
    const resolved = resolveReasoningSelection(
      { mode: "effort", effort: "medium" },
      { control: "effort", supportedEfforts: ["low", "high"] },
    );

    expect(resolved.requested).toEqual({ mode: "effort", effort: "medium" });
    expect(resolved.effective).toEqual({ mode: "provider_default" });
    expect(resolved.fallbackReason).toContain("not supported");
  });

  test("supports combined effort and numeric-budget capabilities", () => {
    const resolved = resolveReasoningSelection(
      { mode: "budget", maxTokens: 8_192 },
      {
        control: "effort",
        supportedEfforts: ["low", "high"],
        supportsBudget: true,
        maxBudgetTokens: 16_384,
      },
    );

    expect(resolved.effective).toEqual({ mode: "budget", maxTokens: 8_192 });
  });

  test("suggests on/off when an effort is requested for a toggle model", () => {
    const resolved = resolveReasoningSelection(
      { mode: "effort", effort: "max" },
      { control: "toggle", defaultEnabled: true },
    );

    expect(resolved.effective).toEqual({ mode: "provider_default" });
    expect(resolved.fallbackReason).toContain("/reasoning on");
  });

  test("does not disable mandatory reasoning", () => {
    const resolved = resolveReasoningSelection(
      { mode: "toggle", enabled: false },
      { control: "toggle", mandatory: true },
    );

    expect(resolved.effective).toEqual({ mode: "provider_default" });
    expect(resolved.fallbackReason).toContain("mandatory");

    const effortResolved = resolveReasoningSelection(
      { mode: "effort", effort: "none" },
      { control: "effort", supportedEfforts: ["none", "low"], mandatory: true },
    );
    expect(effortResolved.effective).toEqual({ mode: "provider_default" });
    expect(effortResolved.fallbackReason).toContain("mandatory");
  });

  test("parses ACP and slash-command values", () => {
    expect(parseReasoningConfigValue("default")).toEqual({ mode: "provider_default" });
    expect(parseReasoningConfigValue("max")).toEqual({ mode: "effort", effort: "max" });
    expect(parseReasoningConfigValue("budget:4096")).toEqual({ mode: "budget", maxTokens: 4096 });
    expect(parseReasoningConfigValue("off")).toEqual({ mode: "toggle", enabled: false });
    expect(isReasoningTransport("minimax")).toBe(true);
  });
});
