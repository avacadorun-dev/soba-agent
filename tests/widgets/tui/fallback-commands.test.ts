import { describe, expect, test } from "bun:test";
import { createKeysCommand } from "../../../src/widgets/tui/commands/keys-command";
import { createSidebarCommand } from "../../../src/widgets/tui/commands/sidebar-command";
import type { TuiMessageInput } from "../../../src/widgets/tui/model/types";

describe("fallback TUI commands", () => {
  test("/keys prints the runtime keymap and command fallbacks", () => {
    const messages: TuiMessageInput[] = [];
    const command = createKeysCommand();

    expect(command.handler?.([], { addMessage: (message) => messages.push(message) })).toEqual({ handled: true });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("info");
    expect(messages[0]?.content).toContain("F2");
    expect(messages[0]?.content).toContain("/model");
    expect(messages[0]?.content).toContain("/sidebar");
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
