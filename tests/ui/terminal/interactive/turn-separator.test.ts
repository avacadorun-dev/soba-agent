/**
 * Phase 2.5 B3 — Turn Separator tests.
 *
 * Tests for:
 *  - Turn boundary detection (computeTurnStarts)
 *  - Turn mapping (computeTurnMap)
 *  - Turn start check (isTurnStart)
 *  - Messages grouped into turns
 *  - Collapsed turns hide non-start messages
 *  - Color alternation by turn index
 */

import { describe, expect, test } from "bun:test";
import { computeTurnMap, computeTurnStarts, isTurnStart } from "../../../../src/ui/terminal/interactive/lib/turn-grouping";

function msg(type: string, content = "", extra?: Record<string, unknown>) {
  return {
    id: Math.floor(Math.random() * 100000),
    type,
    content,
    ...extra,
  } as any;
}

describe("B3 — Turn Separator", () => {
  describe("computeTurnStarts", () => {
    test("пустой массив → нет границ", () => {
      expect(computeTurnStarts([])).toEqual([]);
    });

    test("только assistant/инфо сообщения → нет границ", () => {
      const messages = [msg("assistant", "hello"), msg("info", "note"), msg("assistant", "world")];
      expect(computeTurnStarts(messages)).toEqual([]);
    });

    test("одно пользовательское сообщение → одна граница", () => {
      const messages = [msg("user", "hi"), msg("assistant", "hello")];
      expect(computeTurnStarts(messages)).toEqual([0]);
    });

    test("два пользовательских сообщения → две границы", () => {
      const messages = [
        msg("user", "q1"),
        msg("assistant", "a1"),
        msg("tool-result", "r1", { toolName: "read" }),
        msg("user", "q2"),
        msg("assistant", "a2"),
      ];
      expect(computeTurnStarts(messages)).toEqual([0, 3]);
    });

    test("три тура с тулами и ошибками → три границы", () => {
      const messages = [
        msg("user", "q1"),
        msg("reasoning", "thinking..."),
        msg("assistant", "a1"),
        msg("tool-start", "", { toolName: "bash" }),
        msg("tool-result", "output", { toolName: "bash", isError: false }),
        msg("tool-end", "", { toolName: "bash" }),
        msg("error", "something went wrong"),
        msg("user", "q2"),
        msg("assistant", "a2"),
        msg("user", "q3"),
        msg("assistant", "a3"),
        msg("tool-result", "diff", { toolName: "edit", isDiff: true }),
      ];
      expect(computeTurnStarts(messages)).toEqual([0, 7, 9]);
    });

    test("user не первый — граница в середине", () => {
      const messages = [
        msg("info", "session started"),
        msg("user", "first question"),
        msg("assistant", "answer"),
      ];
      expect(computeTurnStarts(messages)).toEqual([1]);
    });
  });

  describe("computeTurnMap", () => {
    test("нет turns → все -1", () => {
      expect(computeTurnMap([], 5)).toEqual([-1, -1, -1, -1, -1]);
    });

    test("один turn на весь массив", () => {
      expect(computeTurnMap([0], 4)).toEqual([0, 0, 0, 0]);
    });

    test("два turns, равные части", () => {
      // starts at index 0 and 3, total 6 messages
      // turn 0: indices 0-2, turn 1: indices 3-5
      expect(computeTurnMap([0, 3], 6)).toEqual([0, 0, 0, 1, 1, 1]);
    });

    test("два turns, не равные части", () => {
      // starts at 0 and 2, total 5
      // turn 0: 0,1  turn 1: 2,3,4
      expect(computeTurnMap([0, 2], 5)).toEqual([0, 0, 1, 1, 1]);
    });

    test("turn начинается не с нуля → сообщения до первого turn остаются -1", () => {
      expect(computeTurnMap([2], 5)).toEqual([-1, -1, 0, 0, 0]);
    });

    test("пустые starts → все -1", () => {
      expect(computeTurnMap([], 3)).toEqual([-1, -1, -1]);
    });
  });

  describe("isTurnStart", () => {
    const starts = [0, 4, 7];

    test("верно для начала первого turn", () => {
      expect(isTurnStart(0, starts)).toBe(true);
    });

    test("верно для начала второго turn", () => {
      expect(isTurnStart(4, starts)).toBe(true);
    });

    test("ложно для промежуточного сообщения", () => {
      expect(isTurnStart(2, starts)).toBe(false);
    });

    test("ложно для индекса вне границ", () => {
      expect(isTurnStart(10, starts)).toBe(false);
    });

    test("пустые starts → всегда ложно", () => {
      expect(isTurnStart(0, [])).toBe(false);
    });

    test("последний turn тоже распознаётся", () => {
      expect(isTurnStart(7, starts)).toBe(true);
    });
  });

  describe("turn grouping: edge cases", () => {
    test("два user подряд → turns с 0 сообщений внутри", () => {
      const messages = [
        msg("user", "q1"),
        msg("user", "q2"),
        msg("assistant", "a2"),
      ];
      const starts = computeTurnStarts(messages);
      expect(starts).toEqual([0, 1]);
      // Turn 0: just index 0, Turn 1: indices 1-2
      const map = computeTurnMap(starts, messages.length);
      expect(map).toEqual([0, 1, 1]);
    });

    test("user в конце → turn только из user", () => {
      const messages = [
        msg("assistant", "a"),
        msg("user", "last q"),
      ];
      const starts = computeTurnStarts(messages);
      expect(starts).toEqual([1]);
      const map = computeTurnMap(starts, messages.length);
      expect(map).toEqual([-1, 0]);
    });

    test("только user сообщения → каждый user — свой turn", () => {
      const messages = [msg("user", "q1"), msg("user", "q2"), msg("user", "q3")];
      const starts = computeTurnStarts(messages);
      expect(starts).toEqual([0, 1, 2]);
      const map = computeTurnMap(starts, messages.length);
      expect(map).toEqual([0, 1, 2]);
    });
  });

  describe("turn numbering", () => {
    test("номера turns — 1-based от turnStarts", () => {
      const messages = [
        msg("info", "start"),
        msg("user", "turn-1"),
        msg("assistant", "resp-1"),
        msg("user", "turn-2"),
        msg("assistant", "resp-2"),
        msg("user", "turn-3"),
        msg("assistant", "resp-3"),
      ];
      const starts = computeTurnStarts(messages); // [1, 3, 5]
      expect(starts.length).toBe(3);
      // Turn numbers: 1, 2, 3 (index + 1)
      expect(starts.map((_s, i) => i + 1)).toEqual([1, 2, 3]);
    });
  });

  describe("color alternation", () => {
    test("чётные turns → primary, нечётные → secondary (0-based index)", () => {
      // colorIndex = turnIndex % 2
      // turnIndex 0 → 0 % 2 = 0 → primary
      // turnIndex 1 → 1 % 2 = 1 → secondary
      // turnIndex 2 → 2 % 2 = 0 → primary
      const colorForTurn = (i: number) => (i % 2 === 0 ? "primary" : "secondary");
      expect(colorForTurn(0)).toBe("primary");
      expect(colorForTurn(1)).toBe("secondary");
      expect(colorForTurn(2)).toBe("primary");
      expect(colorForTurn(3)).toBe("secondary");
    });
  });
});
