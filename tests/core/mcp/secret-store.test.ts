import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSecretStore, mergeMcpSecretEnv } from "../../../src/core/mcp/secret-store";

describe("MCP secret store", () => {
  test("stores secrets in a private user-local file", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "soba-mcp-secrets-"));
    const store = new McpSecretStore({ homeDir });

    try {
      await store.set("REMOTE_MCP_API_KEY", "secret-value");

      expect(await store.get("REMOTE_MCP_API_KEY")).toBe("secret-value");
      expect(await store.listNames()).toEqual(["REMOTE_MCP_API_KEY"]);
      expect(store.path).toBe(join(homeDir, ".soba", "mcp-secrets.json"));
      if (process.platform !== "win32") {
        expect(await store.permissions()).toBe(0o600);
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("merges saved MCP secrets without overriding real environment variables", () => {
    const env = mergeMcpSecretEnv(
      {
        REMOTE_MCP_API_KEY: "real-env-value",
        OPENAI_API_KEY: "real-openai-key",
      },
      {
        REMOTE_MCP_API_KEY: "stored-value",
        TAVILY_API_KEY: "stored-tavily-key",
      },
    );

    expect(env.REMOTE_MCP_API_KEY).toBe("real-env-value");
    expect(env.OPENAI_API_KEY).toBe("real-openai-key");
    expect(env.TAVILY_API_KEY).toBe("stored-tavily-key");
  });
});
