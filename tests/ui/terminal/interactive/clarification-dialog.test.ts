import { describe, expect, test } from "bun:test";
import { ClarificationDialogManager } from "../../../../src/ui/terminal/interactive/lib/clarification-dialog-manager";

describe("ClarificationDialogManager", () => {
  test("wraps option navigation and selects the highlighted option", () => {
    const manager = new ClarificationDialogManager();
    const selected: number[] = [];
    manager.reset(3);

    expect(manager.handleKey({ name: "up" }, (index) => selected.push(index), () => {})).toBe(true);
    expect(manager.highlightedIndex()).toBe(2);
    expect(manager.handleKey({ name: "return" }, (index) => selected.push(index), () => {})).toBe(true);
    expect(selected).toEqual([2]);
  });

  test("supports number shortcuts and Escape decline", () => {
    const manager = new ClarificationDialogManager();
    const selected: number[] = [];
    let declined = false;
    manager.reset(2);

    expect(manager.handleKey({ name: "2" }, (index) => selected.push(index), () => {})).toBe(true);
    expect(manager.handleKey({ name: "3" }, (index) => selected.push(index), () => {})).toBe(false);
    expect(manager.handleKey({ name: "escape" }, () => {}, () => { declined = true; })).toBe(true);
    expect(selected).toEqual([1]);
    expect(declined).toBe(true);
  });

  test("leaves printable text unhandled for the input editor", () => {
    const manager = new ClarificationDialogManager();
    manager.reset(2);
    expect(manager.handleKey({ name: "a" }, () => {}, () => {})).toBe(false);
  });
});
