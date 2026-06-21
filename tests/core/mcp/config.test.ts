import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MCP_MAX_OUTPUT_BYTES,
  DEFAULT_MCP_TIMEOUT_MS,
  formatMcpConfigIssues,
  getMcpConfigPath,
  loadMcpConfig,
  McpConfigError,
  parseMcpConfig,
  validateMcpConfig,
} from "../../../src/core/mcp/config";

describe("MCP config validation", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-mcp-config-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("valid config with two servers normalizes defaults and resolves cwd", () => {
    const config = parseMcpConfig(
      {
        version: 1,
        servers: [
          {
            id: "filesystem",
            name: "Filesystem",
            command: "bun",
            args: ["run", "mcp-filesystem.ts"],
            cwd: ".",
            timeoutMs: 10_000,
            maxOutputBytes: 64_000,
            trustMode: "safe",
            enabled: true,
          },
          {
            id: "git",
            command: "bun",
          },
        ],
      },
      { projectRoot },
    );

    expect(config.version).toBe(1);
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]).toMatchObject({
      id: "filesystem",
      name: "Filesystem",
      transport: "stdio",
      command: "bun",
      args: ["run", "mcp-filesystem.ts"],
      cwd: projectRoot,
      timeoutMs: 10_000,
      maxOutputBytes: 64_000,
      trustMode: "safe",
      enabled: true,
    });
    expect(config.servers[1]).toMatchObject({
      id: "git",
      name: "git",
      transport: "stdio",
      args: [],
      env: {},
      cwd: projectRoot,
      timeoutMs: DEFAULT_MCP_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_MCP_MAX_OUTPUT_BYTES,
      trustMode: "normal",
      enabled: true,
    });
  });

  test("object-map servers use object keys as stable ids", () => {
    const config = parseMcpConfig(
      {
        servers: {
          docs: {
            command: "bun",
            args: ["run", "docs-server.ts"],
          },
        },
      },
      { projectRoot },
    );

    expect(config.servers.map((server) => server.id)).toEqual(["docs"]);
  });

  test("explicit stdio transport validates", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "stdio-server",
            transport: "stdio",
            command: "bun",
            args: ["run", "server.ts"],
          },
        ],
      },
      { projectRoot },
    );

    expect(config.servers[0]).toMatchObject({
      id: "stdio-server",
      transport: "stdio",
      command: "bun",
      args: ["run", "server.ts"],
    });
  });

  test("mcpServers alias uses object keys as stable ids", () => {
    const config = parseMcpConfig(
      {
        mcpServers: {
          "repo-metrics": {
            command: "bun",
            args: ["run", "tools/repo-metrics-mcp.ts"],
            trustMode: "normal",
          },
        },
      },
      { projectRoot },
    );

    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]).toMatchObject({
      id: "repo-metrics",
      name: "repo-metrics",
      transport: "stdio",
      command: "bun",
      args: ["run", "tools/repo-metrics-mcp.ts"],
      cwd: projectRoot,
      trustMode: "normal",
      enabled: true,
    });
  });

  test("mcpServers alias preserves validation paths", () => {
    const result = validateMcpConfig(
      {
        mcpServers: {
          "repo-metrics": {
            command: "bun",
            trustMode: "god-mode",
          },
        },
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_trust_mode",
        path: "mcpServers.repo-metrics.trustMode",
        message: "MCP server trustMode must be safe, normal or dangerous.",
      },
    ]);
  });

  test("servers and mcpServers cannot be mixed", () => {
    const result = validateMcpConfig(
      {
        servers: {
          docs: {
            command: "bun",
          },
        },
        mcpServers: {
          "repo-metrics": {
            command: "bun",
          },
        },
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_config",
        path: "mcpServers",
        message: "MCP config must use either servers or mcpServers, not both.",
      },
    ]);
  });

  test("missing command and missing server id are actionable validation errors", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "missing-command",
          },
          {
            command: "bun",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(["missing_command", "missing_server_id"]);
    expect(formatMcpConfigIssues(result.issues)).toContain("servers[0].command");
    expect(formatMcpConfigIssues(result.issues)).toContain("servers[1].id");
  });

  test("invalid trust mode is rejected", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "unsafe",
            command: "bun",
            trustMode: "god-mode",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_trust_mode",
        path: "servers[0].trustMode",
        message: "MCP server trustMode must be safe, normal or dangerous.",
      },
    ]);
  });

  test("valid remote HTTPS config validates", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "context7",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            headers: {
              "X-Workspace": "soba",
            },
            auth: {
              type: "oauth",
            },
          },
        ],
      },
      { projectRoot },
    );

    expect(config.servers[0]).toMatchObject({
      id: "context7",
      transport: "streamableHttp",
      url: "https://example.com/mcp",
      headers: {
        "X-Workspace": "soba",
      },
      auth: {
        type: "oauth",
      },
      trustMode: "normal",
      enabled: true,
    });
  });

  test("remote documentation inline example stays valid", () => {
    const docs = readFileSync(join(process.cwd(), "docs-site", "content", "docs", "mcp.ru.mdx"), "utf8");
    const jsonBlocks = [...docs.matchAll(/```json\n(?<json>[\s\S]*?)\n```/g)]
      .map((match) => match.groups?.json)
      .filter((json): json is string => Boolean(json));
    const hostedDocsExample = jsonBlocks.find((json) => json.includes('"hosted-docs"'));
    expect(hostedDocsExample).toBeDefined();

    const raw = JSON.parse(hostedDocsExample ?? "{}") as unknown;
    const config = parseMcpConfig(raw, {
      projectRoot,
      env: {
        MCP_WORKSPACE_ID: "workspace_docs",
      },
    });

    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]).toMatchObject({
      id: "hosted-docs",
      transport: "streamableHttp",
      url: "https://mcp.example.com/mcp",
    });
  });

  test("localhost HTTP remote config validates for development", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "local-http",
            transport: "streamableHttp",
            url: "http://127.0.0.1:8787/mcp",
          },
        ],
      },
      { projectRoot },
    );

    expect(config.servers[0]).toMatchObject({
      id: "local-http",
      transport: "streamableHttp",
      url: "http://127.0.0.1:8787/mcp",
      auth: {
        type: "none",
      },
    });
  });

  test("remote url supports env placeholders for provider query auth", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "hosted-search",
            transport: "streamableHttp",
            url: "https://mcp.example.com/mcp?apiKey=${ENV:REMOTE_MCP_API_KEY}",
            auth: {
              type: "none",
            },
          },
        ],
      },
      {
        projectRoot,
        env: {
          REMOTE_MCP_API_KEY: "remote-test-key",
        },
      },
    );

    expect(config.servers[0]).toMatchObject({
      id: "hosted-search",
      transport: "streamableHttp",
      url: "https://mcp.example.com/mcp?apiKey=remote-test-key",
      auth: {
        type: "none",
      },
    });
  });

  test("remote url env placeholder requires configured environment variable", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "hosted-search",
            transport: "streamableHttp",
            url: "https://mcp.example.com/mcp?apiKey=${ENV:REMOTE_MCP_API_KEY}",
          },
        ],
      },
      { projectRoot, env: {} },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "missing_env",
        path: "servers[0].url",
        message: "Required environment variable REMOTE_MCP_API_KEY is not set.",
      },
    ]);
  });

  test("non-local HTTP remote config is rejected", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "plain-http",
            transport: "streamableHttp",
            url: "http://example.com/mcp",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_url",
        path: "servers[0].url",
        message: "Streamable HTTP MCP server url must use https, except localhost development URLs.",
      },
    ]);
  });

  test("remote URL with username or password is rejected", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "credential-url",
            transport: "streamableHttp",
            url: "https://user:pass@example.com/mcp",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_url",
        path: "servers[0].url",
        message: "Streamable HTTP MCP server url must not include credentials.",
      },
    ]);
  });

  test("missing remote url fails", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "missing-url",
            transport: "streamableHttp",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "missing_url",
        path: "servers[0].url",
        message: "Streamable HTTP MCP server url is required.",
      },
    ]);
  });

  test("remote config with command is rejected unless transport is stdio", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "mixed",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            command: "bun",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_stdio_field",
        path: "servers[0].command",
        message: "Streamable HTTP MCP server must not define stdio field command.",
      },
    ]);
  });

  test("remote header env placeholders resolve and stay redacted in errors", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "remote-secret",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer ${ENV:MCP_TOKEN}",
            },
            auth: {
              type: "bearerEnv",
              env: "MCP_TOKEN",
            },
          },
        ],
      },
      {
        projectRoot,
        env: {
          MCP_TOKEN: "secret_remote_token",
        },
      },
    );

    expect(config.servers[0]).toMatchObject({
      transport: "streamableHttp",
      headers: {
        Authorization: "Bearer secret_remote_token",
      },
      auth: {
        type: "bearerEnv",
        env: "MCP_TOKEN",
      },
    });

    try {
      parseMcpConfig(
        {
          servers: [
            {
              id: "remote-secret",
              transport: "streamableHttp",
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer ${ENV:MISSING_TOKEN}",
              },
            },
          ],
        },
        {
          projectRoot,
          env: {
            MCP_TOKEN: "secret_remote_token",
          },
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(McpConfigError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("MISSING_TOKEN");
      expect(message).not.toContain("secret_remote_token");
    }
  });

  test("remote headers reject CRLF and transport-controlled names", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "bad-headers",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            headers: {
              "X-Trace": "ok\r\nX-Evil: 1",
              "MCP-Session-Id": "attacker-session",
            },
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_headers",
        path: "servers[0].headers.X-Trace",
        message: "MCP header must not contain CRLF or override transport-controlled headers.",
      },
      {
        code: "invalid_headers",
        path: "servers[0].headers.MCP-Session-Id",
        message: "MCP header must not contain CRLF or override transport-controlled headers.",
      },
    ]);
  });

  test("invalid auth type fails with actionable error", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "bad-auth",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            auth: {
              type: "magic",
            },
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_auth",
        path: "servers[0].auth.type",
        message: "MCP remote auth type must be none, bearerEnv, apiKeyEnv or oauth.",
      },
    ]);
  });

  test("apiKeyEnv auth rejects invalid header names", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "bad-header-auth",
            transport: "streamableHttp",
            url: "https://example.com/mcp",
            auth: {
              type: "apiKeyEnv",
              header: "X Bad",
              env: "MCP_API_KEY",
            },
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        code: "invalid_auth",
        path: "servers[0].auth.header",
        message: "MCP apiKeyEnv auth header must be a valid HTTP header name.",
      },
    ]);
  });

  test("object-map ids work for remote servers", () => {
    const config = parseMcpConfig(
      {
        servers: {
          remote: {
            transport: "streamableHttp",
            url: "https://example.com/mcp",
          },
        },
      },
      { projectRoot },
    );

    expect(config.servers[0]).toMatchObject({
      id: "remote",
      transport: "streamableHttp",
      url: "https://example.com/mcp",
    });
  });

  test("env placeholder resolves at runtime without keeping placeholder text", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "github",
            command: "bun",
            env: {
              GITHUB_TOKEN: "${ENV:GITHUB_TOKEN}",
              HEADER: "Bearer ${ENV:GITHUB_TOKEN}",
            },
          },
        ],
      },
      {
        projectRoot,
        env: {
          GITHUB_TOKEN: "fake_github_token_value",
        },
      },
    );

    expect(config.servers[0]).toMatchObject({
      transport: "stdio",
      env: {
        GITHUB_TOKEN: "fake_github_token_value",
        HEADER: "Bearer fake_github_token_value",
      },
    });
  });

  test("missing env var gives redacted error and does not include secret values", () => {
    const secret = "sk_should_never_appear";

    expect(() =>
      parseMcpConfig(
        {
          servers: [
            {
              id: "github",
              command: "bun",
              env: {
                GITHUB_TOKEN: "${ENV:GITHUB_TOKEN}",
                OTHER_TOKEN: "${ENV:OTHER_TOKEN}",
              },
            },
          ],
        },
        {
          projectRoot,
          env: {
            OTHER_TOKEN: secret,
          },
        },
      ),
    ).toThrow(McpConfigError);

    try {
      parseMcpConfig(
        {
          servers: [
            {
              id: "github",
              command: "bun",
              env: {
                GITHUB_TOKEN: "${ENV:GITHUB_TOKEN}",
                OTHER_TOKEN: "${ENV:OTHER_TOKEN}",
              },
            },
          ],
        },
        {
          projectRoot,
          env: {
            OTHER_TOKEN: secret,
          },
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(McpConfigError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("GITHUB_TOKEN");
      expect(message).not.toContain(secret);
      expect(message).not.toContain("sk_should_never_appear");
    }
  });

  test("cwd traversal outside project root is rejected", () => {
    const result = validateMcpConfig(
      {
        servers: [
          {
            id: "outside",
            command: "bun",
            cwd: "../outside",
          },
        ],
      },
      { projectRoot },
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(["invalid_cwd"]);
  });

  test("default timeout/output limits are applied", () => {
    const config = parseMcpConfig(
      {
        servers: [
          {
            id: "defaults",
            command: "bun",
          },
        ],
      },
      { projectRoot },
    );

    expect(config.servers[0]?.timeoutMs).toBe(DEFAULT_MCP_TIMEOUT_MS);
    expect(config.servers[0]?.maxOutputBytes).toBe(DEFAULT_MCP_MAX_OUTPUT_BYTES);
  });

  test("loadMcpConfig reads project-local .soba/mcp.json", async () => {
    const path = getMcpConfigPath(projectRoot);
    mkdirSync(join(projectRoot, ".soba"), { recursive: true });
    await Bun.write(
      path,
      JSON.stringify({
        servers: [
          {
            id: "local",
            command: "bun",
          },
        ],
      }),
    );

    const config = await loadMcpConfig({ projectRoot });

    expect(config?.servers.map((server) => server.id)).toEqual(["local"]);
  });
});
