import { describe, expect, test } from "bun:test";
import { CommandService, listRuntimeCommands, RUNTIME_COMMANDS } from "../../src/application/command-service";

describe("CommandService", () => {
  test("lists protocol-neutral command metadata", () => {
    const commands = listRuntimeCommands();

    expect(commands.map((command) => command.name)).toContain("/compact");
    expect(commands.map((command) => command.name)).toContain("/mcp");
    expect(commands.every((command) => command.descriptionKey.startsWith("command.description."))).toBe(true);
  });

  test("filters commands by surface for ACP advertisement", () => {
    const service = new CommandService(RUNTIME_COMMANDS);
    const acpCommands = service.listCommands({ surface: "acp" });

    expect(acpCommands.map((command) => command.name)).toContain("/session");
    expect(acpCommands.map((command) => command.name)).not.toContain("/clear");
    expect(acpCommands.map((command) => command.name)).not.toContain("/notifications");
  });

  test("returns defensive command metadata copies", () => {
    const service = new CommandService(RUNTIME_COMMANDS);
    const first = service.listCommands()[0];
    (first.surfaces as unknown as string[]).push("acp");

    expect(service.listCommands()[0]?.surfaces).toEqual(RUNTIME_COMMANDS[0].surfaces);
  });

  test("gets commands by id or slash name", () => {
    const service = new CommandService(RUNTIME_COMMANDS);

    expect(service.getCommand("compact")?.name).toBe("/compact");
    expect(service.getCommand("/compact")?.id).toBe("compact");
    expect(service.getCommand("missing")).toBeUndefined();
  });

  test("parses slash command input without binding to a UI surface", () => {
    const service = new CommandService(RUNTIME_COMMANDS);

    expect(service.parseInput("/MCP restart github")).toEqual({
      id: "mcp",
      name: "/mcp",
      args: ["restart", "github"],
    });
    expect(service.parseInput("/")).toEqual({ id: "", name: "/", args: [] });
    expect(service.parseInput("plain prompt")).toBeUndefined();
  });
});
