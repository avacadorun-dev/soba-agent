import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDelegatedBashTool, createDelegatedReadTool, createDelegatedWriteTool } from "../../../src/application/tool-delegation";
import { AcpClientToolDelegation } from "../../../src/protocol-adapters/acp/client-delegation";
import type { JsonValue } from "../../../src/protocol-adapters/acp/json-rpc";

describe("ACP client tool delegation", () => {
  test("falls back to local read when the client did not advertise fs support", async () => {
    const cwd = makeTempDir();
    try {
      writeFileSync(join(cwd, "local.txt"), "local content");
      const calls: string[] = [];
      const requester = (method: string): JsonValue => {
        calls.push(method);
        return { text: "editor content" };
      };
      const delegation = new AcpClientToolDelegation(() => requester);
      const tool = createDelegatedReadTool(delegation);

      const result = await tool.execute({ path: "local.txt" }, { cwd });

      expect(calls).toEqual([]);
      expect(result.content[0]?.text).toBe("local content");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("delegates fs read and write only after advertised client capabilities", async () => {
    const calls: Array<{ method: string; params: JsonValue }> = [];
    const requester = (method: string, params: JsonValue): JsonValue => {
      calls.push({ method, params });
      if (method === "fs/read_text_file") return { text: "editor text" };
      return { bytes: 11, lines: 1 };
    };
    const delegation = new AcpClientToolDelegation(() => requester);
    delegation.updateCapabilities({ methods: ["fs/read_text_file", "fs/write_text_file"] });

    const readResult = await createDelegatedReadTool(delegation).execute({ path: "a.ts" }, { cwd: "/repo" });
    const writeResult = await createDelegatedWriteTool(delegation).execute({ path: "b.ts", content: "hello world" }, { cwd: "/repo" });

    expect(calls.map((call) => call.method)).toEqual(["fs/read_text_file", "fs/write_text_file"]);
    expect(calls[0].params).toEqual({ cwd: "/repo", path: "a.ts" });
    expect(calls[1].params).toEqual({ cwd: "/repo", path: "b.ts", content: "hello world" });
    expect(readResult.content[0]?.text).toBe("editor text");
    expect(writeResult.details).toMatchObject({ bytes: 11, lines: 1, delegated: true });
  });

  test("delegates terminal execution through ACP terminal lifecycle methods", async () => {
    const calls: string[] = [];
    const requester = (method: string): JsonValue => {
      calls.push(method);
      if (method === "terminal/create") return { terminalId: "term_1" };
      if (method === "terminal/output" && calls.filter((call) => call === "terminal/output").length === 1) return { output: "start\n" };
      if (method === "terminal/output") return { output: "done\n" };
      if (method === "terminal/wait_for_exit") return { exitCode: 0 };
      return {};
    };
    const delegation = new AcpClientToolDelegation(() => requester);
    delegation.updateCapabilities({
      methods: [
        "terminal/create",
        "terminal/output",
        "terminal/wait_for_exit",
        "terminal/kill",
        "terminal/release",
      ],
    });

    const result = await createDelegatedBashTool(delegation).execute({ command: "echo done", timeout: 5 }, { cwd: "/repo" });

    expect(calls).toEqual([
      "terminal/create",
      "terminal/output",
      "terminal/wait_for_exit",
      "terminal/output",
      "terminal/release",
    ]);
    expect(result).toMatchObject({
      isError: false,
      details: { terminalId: "term_1", exitCode: 0, delegated: true },
    });
    expect(result.content[0]?.text).toBe("start\ndone\n");
  });
});

function makeTempDir(): string {
  const path = join(tmpdir(), `soba-acp-delegation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}
