import { describe, expect, test } from "bun:test";
import { createKeysCommand } from "../../../../src/ui/terminal/interactive/commands/keys-command";
import { createSidebarCommand } from "../../../../src/ui/terminal/interactive/commands/sidebar-command";
import type { TuiMessageInput } from "../../../../src/ui/terminal/interactive/model/types";

describe("fallback TUI commands", () => {
  test("/keys prints the runtime keymap and command fallbacks", () => {
    const messages: TuiMessageInput[] = [];
    const command = createKeysCommand();

    expect(command.handler?.([], { addMessage: (message) => messages.push(message) })).toEqual({ handled: true });
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.type).toBe("info");
    if (message?.type !== "info") throw new Error("Expected /keys to emit an info message");
    expect(message.content).toContain("F2");
    expect(message.content).toContain("/model");
    expect(message.content).toContain("/sidebar");
  });

  test("/sidebar defaults to next and supports explicit actions", () => {
    const calls: string[] = [];
    const command = createSidebarCommand({
      next: () => calls.push("next"),
      previous: () => calls.push("previous"),
      toggle: () => calls.push("toggle"),
      help: () => calls.push("help"),
    });

    expect(command.handler?.([], {})).toEqual({ handled: true });
    expect(command.handler?.(["previous"], {})).toEqual({ handled: true });
    expect(command.handler?.(["toggle"], {})).toEqual({ handled: true });
    expect(command.handler?.(["help"], {})).toEqual({ handled: true });
    expect(calls).toEqual(["next", "previous", "toggle", "help"]);
  });
});
