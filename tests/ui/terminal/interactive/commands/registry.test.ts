/**
 * Slash Command Registry tests — Phase 2.5 A4.
 *
 * Tests cover:
 *  - register, get, has, getAll, unregister, clear
 *  - dispatch with simple commands
 *  - dispatch with subcommands
 *  - dispatch with unknown command
 *  - getSuggestions for autocomplete
 *  - handler context (addMessage, exit)
 */

import { describe, expect, test } from "bun:test";
import { SlashCommandRegistry } from "../../../../../src/ui/terminal/interactive/commands/registry";
import type { SlashCommand, SlashCommandContext } from "../../../../../src/ui/terminal/interactive/commands/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createRegistry(): SlashCommandRegistry {
  return new SlashCommandRegistry();
}

function makeCtx(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    addMessage: undefined,
    exit: undefined,
    ...overrides,
  };
}

// ─── Core Registry Tests ───────────────────────────────────────────────────

describe("SlashCommandRegistry", () => {
  test("register and get by name", () => {
    const registry = createRegistry();
    const cmd: SlashCommand = {
      name: "model",
      description: "Manage models",
    };
    registry.register(cmd);
    expect(registry.get("model")).toBe(cmd);
    expect(registry.get("unknown")).toBeUndefined();
  });

  test("has returns correct boolean", () => {
    const registry = createRegistry();
    registry.register({ name: "search", description: "Search" });
    expect(registry.has("search")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  test("getAll returns all registered commands", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Models" });
    registry.register({ name: "search", description: "Search" });
    registry.register({ name: "sessions", description: "Sessions" });
    expect(registry.getAll()).toHaveLength(3);
    expect(registry.getAll().map((c) => c.name).sort()).toEqual(["model", "search", "sessions"]);
  });

  test("register overwrites existing command with same name", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Old" });
    registry.register({ name: "model", description: "New" });
    expect(registry.get("model")?.description).toBe("New");
    expect(registry.getAll()).toHaveLength(1);
  });

  test("unregister removes a command", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Models" });
    expect(registry.has("model")).toBe(true);
    expect(registry.unregister("model")).toBe(true);
    expect(registry.has("model")).toBe(false);
  });

  test("unregister returns false for unknown command", () => {
    const registry = createRegistry();
    expect(registry.unregister("unknown")).toBe(false);
  });

  test("clear removes all commands", () => {
    const registry = createRegistry();
    registry.register({ name: "a", description: "A" });
    registry.register({ name: "b", description: "B" });
    expect(registry.getAll()).toHaveLength(2);
    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
  });
});

// ─── Dispatch Tests ─────────────────────────────────────────────────────────

describe("dispatch", () => {
  test("dispatches a simple command", () => {
    const registry = createRegistry();
    const calls: Array<{ args: string[]; ctx: SlashCommandContext }> = [];
    registry.register({
      name: "model",
      description: "Manage models",
      handler: (args, ctx) => {
        calls.push({ args, ctx });
        return { handled: true };
      },
    });

    const ctx = makeCtx();
    const result = registry.dispatch("/model", ctx);
    expect(result?.handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([]);
  });

  test("dispatches with arguments", () => {
    const registry = createRegistry();
    let receivedArgs: string[] = [];
    registry.register({
      name: "search",
      description: "Search",
      handler: (args) => {
        receivedArgs = args;
        return { handled: true };
      },
    });

    registry.dispatch("/search file.ts session", makeCtx());
    expect(receivedArgs).toEqual(["file.ts", "session"]);
  });

  test("dispatches subcommands", () => {
    const registry = createRegistry();
    let receivedSubArgs: string[] = [];
    registry.register({
      name: "model",
      description: "Manage models",
      subcommands: {
        set: {
          name: "set",
          description: "Set model",
          handler: (args) => {
            receivedSubArgs = args;
            return { handled: true };
          },
        },
        list: {
          name: "list",
          description: "List models",
          handler: (args) => {
            receivedSubArgs = args;
            return { handled: true, message: "list-dispatched" };
          },
        },
      },
    });

    const r1 = registry.dispatch("/model set deepseek/chat", makeCtx());
    expect(r1?.handled).toBe(true);
    expect(receivedSubArgs).toEqual(["deepseek/chat"]);

    const r2 = registry.dispatch("/model list", makeCtx());
    expect(r2?.handled).toBe(true);
    expect(r2?.message).toBe("list-dispatched");
  });

  test("returns undefined for unknown command", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Models" });
    const result = registry.dispatch("/unknown", makeCtx());
    expect(result).toBeUndefined();
  });

  test("returns handled:true for command without handler", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Models" });
    const result = registry.dispatch("/model", makeCtx());
    expect(result).toEqual({ handled: true });
  });

  test("dispatches nested subcommands", () => {
    const registry = createRegistry();
    const calls: string[] = [];
    registry.register({
      name: "sessions",
      description: "Manage sessions",
      subcommands: {
        list: {
          name: "list",
          description: "List sessions",
          subcommands: {
            active: {
              name: "active",
              description: "Active sessions",
              handler: (args) => {
                calls.push("active", ...args);
                return { handled: true };
              },
            },
          },
        },
      },
    });

    registry.dispatch("/sessions list active --filter=main", makeCtx());
    expect(calls).toEqual(["active", "--filter=main"]);
  });

  test("exits when handler requests exit", () => {
    const registry = createRegistry();
    registry.register({
      name: "exit",
      description: "Exit the TUI",
      handler: () => ({ handled: true, exit: true }),
    });

    const ctx = makeCtx();
    const result = registry.dispatch("/exit", ctx);
    expect(result?.exit).toBe(true);
    // The registry returns the exit flag; the caller (TuiStore) handles actual shutdown
  });

  test("handler receives addMessage from context", () => {
    const registry = createRegistry();
    const messages: Array<{ type: string; content: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
    const addMessage: any = (msg: { type: string; content: string }) => messages.push(msg);

    registry.register({
      name: "notifications",
      description: "Show notifications",
      handler: (_args, ctx) => {
        ctx.addMessage?.({ type: "info", content: "test" });
        return { handled: true };
      },
    });

    registry.dispatch("/notifications", makeCtx({ addMessage }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "info", content: "test" });
  });
});

// ─── Suggestions Tests ─────────────────────────────────────────────────────

describe("getSuggestions", () => {
  test("returns flat list for autocomplete", () => {
    const registry = createRegistry();
    registry.register({ name: "model", description: "Manage models" });
    registry.register({ name: "clear", description: "Clear display" });

    const suggestions = registry.getSuggestions();
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toEqual({ name: "/model", description: "Manage models" });
    expect(suggestions[1]).toEqual({ name: "/clear", description: "Clear display" });
  });

  test("flattens subcommands", () => {
    const registry = createRegistry();
    registry.register({
      name: "model",
      description: "Manage models",
      subcommands: {
        set: { name: "set", description: "Set active model" },
        list: { name: "list", description: "List available models" },
      },
    });
    registry.register({
      name: "sessions",
      description: "Manage sessions",
      subcommands: {
        list: {
          name: "list",
          description: "List sessions",
          subcommands: {
            active: { name: "active", description: "Show active sessions" },
          },
        },
      },
    });

    const suggestions = registry.getSuggestions();
    expect(suggestions).toHaveLength(6);
    const names = suggestions.map((s) => s.name);
    expect(names).toContain("/model");
    expect(names).toContain("/model set");
    expect(names).toContain("/model list");
    expect(names).toContain("/sessions");
    expect(names).toContain("/sessions list active");
  });

  test("returns empty array when no commands registered", () => {
    const registry = createRegistry();
    expect(registry.getSuggestions()).toEqual([]);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("dispatch with empty input returns undefined", () => {
    const registry = createRegistry();
    expect(registry.dispatch("", makeCtx())).toBeUndefined();
    expect(registry.dispatch("/", makeCtx())).toBeUndefined();
    expect(registry.dispatch("   ", makeCtx())).toBeUndefined();
  });

  test("command name is case-insensitive", () => {
    const registry = createRegistry();
    let called = false;
    registry.register({
      name: "model",
      description: "Models",
      handler: () => {
        called = true;
        return { handled: true };
      },
    });

    registry.dispatch("/MODEL", makeCtx());
    expect(called).toBe(true);
  });

  test("well-structured command", () => {
    // Verify the registry passes the plan's well-structured check
    const registry = createRegistry();

    const modelCmd: SlashCommand = {
      name: "model",
      description: "Manage AI models",
      subcommands: {
        list: {
          name: "list",
          description: "List available models",
          handler: () => ({ handled: true, message: "Models listed" }),
        },
        set: {
          name: "set",
          description: "Set the active model",
          handler: (args) => {
            if (args.length === 0) return { handled: true, message: "Usage: /model set <id>" };
            return { handled: true, message: `Model set to ${args[0]}` };
          },
        },
      },
    };

    registry.register(modelCmd);

    expect(registry.get("model")).toBeDefined();
    expect(registry.get("model")?.subcommands?.set?.name).toBe("set");

    const setResult = registry.dispatch("/model set deepseek/chat", makeCtx());
    expect(setResult?.message).toBe("Model set to deepseek/chat");
  });
});
