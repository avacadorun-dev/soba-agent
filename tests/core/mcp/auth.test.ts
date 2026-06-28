import { describe, expect, test } from "bun:test";
import { assertValidHeaderName, buildMcpAuthHeaders, McpAuthConfigError } from "../../../src/infrastructure/mcp/auth";

describe("MCP static auth", () => {
  test("bearer env sends Authorization header", () => {
    const headers = buildMcpAuthHeaders(
      {
        type: "bearerEnv",
        env: "MCP_TOKEN",
      },
      {
        MCP_TOKEN: "secret-token",
      },
    );

    expect(headers.get("authorization")).toBe("Bearer secret-token");
  });

  test("API-key env sends configured header", () => {
    const headers = buildMcpAuthHeaders(
      {
        type: "apiKeyEnv",
        header: "X-API-Key",
        env: "MCP_API_KEY",
      },
      {
        MCP_API_KEY: "secret-api-key",
      },
    );

    expect(headers.get("x-api-key")).toBe("secret-api-key");
  });

  test("missing env is actionable and redacted", () => {
    expect(() =>
      buildMcpAuthHeaders(
        {
          type: "bearerEnv",
          env: "MISSING_MCP_TOKEN",
        },
        {
          OTHER_TOKEN: "secret-token",
        },
      ),
    ).toThrow(McpAuthConfigError);

    try {
      buildMcpAuthHeaders(
        {
          type: "bearerEnv",
          env: "MISSING_MCP_TOKEN",
        },
        {
          OTHER_TOKEN: "secret-token",
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("MISSING_MCP_TOKEN");
      expect(message).not.toContain("secret-token");
    }
  });

  test("invalid header name is rejected", () => {
    for (const value of ["", "X Bad", "X-Bad\r\nInjected", "X:Bad"]) {
      expect(() => assertValidHeaderName(value)).toThrow(McpAuthConfigError);
    }
  });

  test("auth type none sends no auth headers", () => {
    const headers = buildMcpAuthHeaders({ type: "none" });

    expect([...headers.entries()]).toEqual([]);
  });
});
