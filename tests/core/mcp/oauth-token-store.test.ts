import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDefaultMcpOAuthTokenStorePath,
  McpOAuthTokenStore,
  recordFromTokenSet,
} from "../../../src/core/mcp/oauth-token-store";

describe("MCP OAuth token store", () => {
  let tempDir: string;
  let projectRoot: string;
  let storePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-oauth-store-"));
    projectRoot = join(tempDir, "project");
    storePath = join(tempDir, "home", ".soba", "mcp-oauth-tokens.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("saves and loads token record by server id", async () => {
    const store = new McpOAuthTokenStore({ path: storePath });
    const record = recordFromTokenSet({
      projectRoot,
      serverId: "docs",
      issuer: "https://auth.example.com/",
      accessToken: "secret-access-token",
      tokenType: "Bearer",
      refreshToken: "secret-refresh-token",
      expiresIn: 3600,
      scope: "mcp.read",
      now: 1_000,
    });

    await store.save(record);

    await expect(store.load(projectRoot, "docs", "https://auth.example.com/")).resolves.toMatchObject({
      serverId: "docs",
      issuer: "https://auth.example.com/",
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      expiresAt: 3_601_000,
    });
    await expect(store.load(projectRoot, "git", "https://auth.example.com/")).resolves.toBeNull();
  });

  test("file permissions are restricted where platform supports it", async () => {
    const store = new McpOAuthTokenStore({ path: storePath });
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "secret-access-token",
      }),
    );

    const permissions = await store.permissions();

    if (process.platform === "win32") {
      expect(permissions).toBeNull();
    } else {
      expect(permissions).toBe(0o600);
    }
  });

  test("default token store path is outside the project root", () => {
    const path = getDefaultMcpOAuthTokenStorePath(join(tempDir, "home"));

    expect(path).toBe(join(tempDir, "home", ".soba", "mcp-oauth-tokens.json"));
    expect(path.startsWith(projectRoot)).toBe(false);
  });

  test("logout removes local token", async () => {
    const store = new McpOAuthTokenStore({ path: storePath });
    const record = recordFromTokenSet({
      projectRoot,
      serverId: "docs",
      issuer: "https://auth.example.com/",
      accessToken: "secret-access-token",
    });

    await store.save(record);
    await store.delete(projectRoot, "docs", "https://auth.example.com/");

    await expect(store.load(projectRoot, "docs", "https://auth.example.com/")).resolves.toBeNull();
    const file = JSON.parse(await readFile(storePath, "utf8"));
    expect(Object.keys(file.tokens)).toEqual([]);
  });
});
