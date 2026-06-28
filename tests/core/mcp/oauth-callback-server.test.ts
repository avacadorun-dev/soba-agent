import { describe, expect, test } from "bun:test";
import { get } from "node:http";
import { startMcpOAuthCallbackServer } from "../../../src/infrastructure/mcp/oauth-callback-server";

describe("MCP OAuth callback server", () => {
  test("callback with valid state exchanges code", async () => {
    const server = await startMcpOAuthCallbackServer({
      expectedState: "expected-state",
      timeoutMs: 1_000,
    });

    const response = await requestUrl(`${server.redirectUri}?code=secret-code&state=expected-state`);
    const result = await server.waitForCallback();

    expect(response.status).toBe(200);
    expect(result).toEqual({
      type: "success",
      code: "secret-code",
      state: "expected-state",
    });
    expect(server.closed).toBe(true);
  });

  test("callback with invalid state is rejected", async () => {
    const server = await startMcpOAuthCallbackServer({
      expectedState: "expected-state",
      timeoutMs: 1_000,
    });

    const response = await requestUrl(`${server.redirectUri}?code=secret-code&state=wrong-state`);
    const result = await server.waitForCallback();

    expect(response.status).toBe(400);
    expect(result).toEqual({
      type: "invalid_state",
      state: "wrong-state",
    });
    expect(server.closed).toBe(true);
  });

  test("OAuth error callback produces auth-denied result", async () => {
    const server = await startMcpOAuthCallbackServer({
      expectedState: "expected-state",
      timeoutMs: 1_000,
    });

    const response = await requestUrl(`${server.redirectUri}?error=access_denied&state=expected-state`);
    const result = await server.waitForCallback();

    expect(response.status).toBe(400);
    expect(result).toEqual({
      type: "denied",
      error: "access_denied",
      state: "expected-state",
    });
    expect(server.closed).toBe(true);
  });

  test("timeout stops callback server", async () => {
    const server = await startMcpOAuthCallbackServer({
      expectedState: "expected-state",
      timeoutMs: 5,
    });

    const result = await server.waitForCallback();

    expect(result).toEqual({ type: "timeout" });
    expect(server.closed).toBe(true);
    await expect(requestUrl(server.redirectUri)).rejects.toThrow();
  });
});

function requestUrl(url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      response.resume();
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0 });
      });
    });

    request.on("error", reject);
    request.end();
  });
}
