import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandHistory } from "../../../../src/ui/terminal/interactive/lib/command-history";

function createHistory(): CommandHistory {
  const dir = mkdtempSync(join(tmpdir(), "soba-history-"));
  return new CommandHistory(join(dir, "history"));
}

describe("CommandHistory", () => {
  test("добавляет и навигирует по истории", () => {
    const history = createHistory();
    history.add("first command");
    history.add("second command");
    history.add("third command");

    // Initial position — new input
    expect(history.current).toBeNull();
    expect(history.currentIndex).toBe(-1);

    // Navigate older 3 times
    expect(history.older()).toBe("third command");
    expect(history.older()).toBe("second command");
    expect(history.older()).toBe("first command");
    // At oldest — stays at oldest
    expect(history.older()).toBe("first command");

    // Navigate newer
    expect(history.newer()).toBe("second command");
    expect(history.newer()).toBe("third command");
    expect(history.newer()).toBeNull(); // back to new input
  });

  test("не добавляет дубликаты подряд", () => {
    const history = createHistory();
    history.add("unique");
    history.add("unique");

    // Only one entry should exist
    expect(history.older()).toBe("unique");
    // At oldest — same item returned (no more entries)
    expect(history.older()).toBe("unique");
    expect(history.newer()).toBeNull(); // back to new input
  });

  test("reset сбрасывает позицию", () => {
    const history = createHistory();
    history.add("cmd1");
    history.add("cmd2");

    history.older();
    history.older();
    expect(history.currentIndex).toBe(1);

    history.reset();
    expect(history.currentIndex).toBe(-1);
    expect(history.current).toBeNull();
  });

  test("не добавляет пустые строки", () => {
    const history = createHistory();
    history.add("");
    history.add("   ");

    expect(history.older()).toBeNull();
  });
});
