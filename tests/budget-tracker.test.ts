/**
 * Budget Tracker tests.
 */

import { describe, expect, test } from "bun:test";
import { BudgetTracker } from "../src/engine/budget/budget-tracker";

describe("BudgetTracker", () => {
  test("formatTokens форматирует токены", () => {
    expect(BudgetTracker.formatTokens(0)).toBe("0");
    expect(BudgetTracker.formatTokens(500)).toBe("500");
    expect(BudgetTracker.formatTokens(1500)).toBe("1.5K");
    expect(BudgetTracker.formatTokens(1_000_000)).toBe("1.0M");
    expect(BudgetTracker.formatTokens(42_000)).toBe("42.0K");
  });

  test("getStatus с budget=0 возвращает unlimited", () => {
    const bt = new BudgetTracker();
    const status = bt.getStatus();

    expect(status.totalBudget).toBe(0);
    expect(status.isExceeded).toBe(false);
    expect(status.isWarning).toBe(false);
    expect(status.percentage).toBe(0);
  });

  test("addUsage накапливает токены", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(500, 200);

    const status = bt.getStatus();
    expect(status.usedTokens).toBe(700);
    expect(status.percentage).toBe(7);
  });

  test("addUsage несколько раз суммирует", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(500, 200);
    bt.addUsage(300, 100);
    bt.addUsage(200, 200);

    const status = bt.getStatus();
    expect(status.usedTokens).toBe(1500);
  });

  test("reset сбрасывает счётчик", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(5000, 3000);
    bt.reset();

    expect(bt.getStatus().usedTokens).toBe(0);
  });

  test("setBudget меняет лимит", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.setBudget(50000);
    expect(bt.getStatus().totalBudget).toBe(50000);
  });

  test("предупреждение на 80%", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(8000, 0);

    const status = bt.getStatus();
    expect(status.isWarning).toBe(true);
    expect(status.percentage).toBe(80);
  });

  test("предупреждение на 90%", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(9000, 0);

    const status = bt.getStatus();
    expect(status.isWarning).toBe(true);
    expect(status.percentage).toBe(90);
  });

  test("превышение бюджета", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(10000, 500);

    const status = bt.getStatus();
    expect(status.isExceeded).toBe(true);
    expect(status.percentage).toBeGreaterThanOrEqual(100);
  });

  test("оставшиеся токены считаются корректно", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(3000, 0);

    const status = bt.getStatus();
    expect(status.remainingTokens).toBe(7000);
  });

  test("оставшиеся токены не уходят в минус", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(12000, 0);

    const status = bt.getStatus();
    expect(status.remainingTokens).toBe(0);
  });

  test("getStatusMessage для normal usage", () => {
    const bt = new BudgetTracker({ totalBudget: 100000 });
    bt.addUsage(5000, 2000);

    const msg = bt.getStatusMessage();
    expect(msg).toContain("7.0K");
    expect(msg).toContain("100.0K");
  });

  test("getStatusMessage для 80% предупреждения", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(8000, 0);

    const msg = bt.getStatusMessage();
    expect(msg).toContain("🔵");
  });

  test("getStatusMessage для 90% предупреждения", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(9000, 0);

    const msg = bt.getStatusMessage();
    expect(msg).toContain("🟡");
  });

  test("getStatusMessage для превышения", () => {
    const bt = new BudgetTracker({ totalBudget: 10000 });
    bt.addUsage(10500, 0);

    const msg = bt.getStatusMessage();
    expect(msg).toContain("⚠️");
    expect(msg).toContain("exceeded");
  });

  test("getStatusMessage без бюджета", () => {
    const bt = new BudgetTracker();
    bt.addUsage(5000, 2000);

    const msg = bt.getStatusMessage();
    expect(msg).toContain("tokens used");
  });

  test("кастомные пороги предупреждений", () => {
    const bt = new BudgetTracker({
      totalBudget: 10000,
      warningThresholds: [50, 75],
    });

    bt.addUsage(6000, 0);
    expect(bt.getStatus().isWarning).toBe(true);

    bt.reset();
    bt.addUsage(4000, 0);
    expect(bt.getStatus().isWarning).toBe(false);
  });
});
