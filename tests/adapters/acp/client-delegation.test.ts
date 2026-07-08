import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpClientToolDelegation } from "../../../src/adapters/acp/client-delegation";
import type { JsonValue } from "../../../src/adapters/acp/json-rpc";
import {
  createDelegatedBashTool,
  createDelegatedInspectFileTool,
  createDelegatedLsTool,
  createDelegatedReadTool,
  createDelegatedSearchFilesTool,
  createDelegatedWriteTool,
} from "../../../src/infrastructure/tools/delegation";

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
    delegation.updateCapabilities({ fs: { readTextFile: true, writeTextFile: true } });

    const readResult = await createDelegatedReadTool(delegation).execute({ path: "a.ts" }, { cwd: "/repo", sessionId: "session_1" });
    const writeResult = await createDelegatedWriteTool(delegation).execute({ path: "b.ts", content: "hello world" }, { cwd: "/repo", sessionId: "session_1" });

    expect(calls.map((call) => call.method)).toEqual(["fs/read_text_file", "fs/write_text_file"]);
    expect(calls[0].params).toEqual({ sessionId: "session_1", path: "/repo/a.ts" });
    expect(calls[1].params).toEqual({ sessionId: "session_1", path: "/repo/b.ts", content: "hello world" });
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
    delegation.updateCapabilities({ terminal: true });

    const result = await createDelegatedBashTool(delegation).execute({ command: "echo done", timeout: 5 }, { cwd: "/repo", sessionId: "session_1" });

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

  test("delegates list, inspect, and search through advertised fs capabilities", async () => {
    const calls: Array<{ method: string; params: JsonValue }> = [];
    const requester = (method: string, params: JsonValue): JsonValue => {
      calls.push({ method, params });
      if (method === "fs/list_directory") return { entries: ["src/", "package.json"], entryCount: 2 };
      if (method === "fs/inspect_text_file") return { text: "[inspect_file] app.ts lines 2-2 of 3\n2 | ok", totalLines: 3, startLine: 2, endLine: 2 };
      if (method === "fs/search_files") return { text: "app.ts:2:1: ok", matchCount: 1 };
      return {};
    };
    const delegation = new AcpClientToolDelegation(() => requester);
    delegation.updateCapabilities({
      _meta: {
        soba: {
          fs: {
            listDirectory: true,
            inspectTextFile: true,
            searchFiles: true,
          },
        },
      },
      fs: {
        listDirectory: true,
        inspectTextFile: true,
        searchFiles: true,
      },
    });

    const lsResult = await createDelegatedLsTool(delegation).execute({ path: ".", limit: 10 }, { cwd: "/repo", sessionId: "session_1" });
    const inspectResult = await createDelegatedInspectFileTool(delegation).execute({ path: "app.ts", startLine: 2, endLine: 2 }, { cwd: "/repo", sessionId: "session_1" });
    const searchResult = await createDelegatedSearchFilesTool(delegation).execute({ query: "ok", path: "src", maxMatches: 5 }, { cwd: "/repo", sessionId: "session_1" });

    expect(calls.map((call) => call.method)).toEqual(["fs/list_directory", "fs/inspect_text_file", "fs/search_files"]);
    expect(calls[0].params).toEqual({ sessionId: "session_1", path: "/repo", limit: 10 });
    expect(calls[1].params).toEqual({ sessionId: "session_1", path: "/repo/app.ts", startLine: 2, endLine: 2 });
    expect(calls[2].params).toEqual({ sessionId: "session_1", path: "/repo/src", query: "ok", maxMatches: 5 });
    expect(lsResult.content[0]?.text).toContain("src/");
    expect(inspectResult.details).toMatchObject({ delegated: true, totalLines: 3, startLine: 2, endLine: 2 });
    expect(searchResult.details).toMatchObject({ delegated: true, matchCount: 1 });
  });

  test("requires session ids for ACP delegated client requests", async () => {
    const delegation = new AcpClientToolDelegation(() => () => ({ text: "editor text" }));
    delegation.updateCapabilities({ fs: { readTextFile: true } });

    await expect(createDelegatedReadTool(delegation).execute({ path: "a.ts" }, { cwd: "/repo" }))
      .rejects.toThrow("ACP client delegation requires a sessionId.");
  });
});

function makeTempDir(): string {
  const path = join(tmpdir(), `soba-acp-delegation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}
