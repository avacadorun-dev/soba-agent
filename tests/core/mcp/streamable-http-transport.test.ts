import { describe, expect, test } from "bun:test";
import { McpClient } from "../../../src/infrastructure/mcp/client";
import { McpClientManager } from "../../../src/infrastructure/mcp/client-manager";
import { MCP_SESSION_ID_HEADER } from "../../../src/infrastructure/mcp/http-session";
import { JSON_RPC_VERSION } from "../../../src/infrastructure/mcp/json-rpc";
import {
  McpStreamableHttpTransport,
  STREAMABLE_HTTP_ACCEPT,
  STREAMABLE_HTTP_LISTEN_ACCEPT,
} from "../../../src/infrastructure/mcp/streamable-http-transport";
import type { McpTransportEvent } from "../../../src/infrastructure/mcp/transport";
import type { McpServerConfig } from "../../../src/infrastructure/mcp/types";

describe("MCP Streamable HTTP transport JSON path", () => {
  test("POST request returns JSON-RPC response", async () => {
    const seen: Request[] = [];
    await withServer(
      async (request) => {
        seen.push(request);
        const body = await request.json();
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          result: { ok: true },
        });
      },
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.method).toBe("POST");
        expect(seen[0]?.headers.get("accept")).toBe(STREAMABLE_HTTP_ACCEPT);
        expect(events).toContainEqual({
          type: "message",
          message: {
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            result: { ok: true },
          },
        });
      },
    );
  });

  test("POST notification returns 202 and no protocol response", async () => {
    await withServer(
      () => new Response(null, { status: 202 }),
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          method: "notifications/initialized",
        });

        expect(events.filter((event) => event.type === "message")).toEqual([]);
      },
    );
  });

  test("missing or invalid content type fails clearly", async () => {
    await withServer(
      () => new Response(JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, result: {} })),
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "tools/list",
          }),
        ).rejects.toMatchObject({
          code: "invalid_response",
          kind: "streamableHttp",
        });
      },
    );
  });

  test("HTTP 400 with JSON-RPC error body is emitted as protocol response", async () => {
    await withServer(
      () =>
        Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            error: {
              code: -32600,
              message: "Invalid request",
            },
          },
          { status: 400 },
        ),
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });

        expect(events).toContainEqual({
          type: "message",
          message: {
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            error: {
              code: -32600,
              message: "Invalid request",
            },
          },
        });
      },
    );
  });

  test("HTTP 401 maps to auth-required error", async () => {
    await withServer(
      () => new Response("unauthorized", { status: 401 }),
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "tools/list",
          }),
        ).rejects.toMatchObject({
          code: "auth_required",
          kind: "streamableHttp",
        });
      },
    );
  });

  test("repeated 401 does not fallback-loop through legacy startup", async () => {
    let requestCount = 0;
    await withServer(
      () => {
        requestCount += 1;
        return new Response("unauthorized", { status: 401 });
      },
      async (server) => {
        const config = serverConfig(server);
        const client = new McpClient({
          server: config,
          transportFactory: (onEvent) =>
            new McpStreamableHttpTransport({
              url: urlFor(server),
              timeoutMs: 20,
              onEvent,
            }),
        });

        await expect(client.start()).rejects.toMatchObject({
          code: "auth_required",
        });
        expect(requestCount).toBe(1);
        expect(client.getState()).toMatchObject({
          state: "degraded",
          lastErrorCode: "auth_required",
        });
      },
    );
  });

  test("timeout aborts fetch and does not leave pending request", async () => {
    await withServer(
      async () => {
        await delay(100);
        return Response.json({ jsonrpc: JSON_RPC_VERSION, id: 1, result: {} });
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          timeoutMs: 10,
        });
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "tools/list",
          }),
        ).rejects.toMatchObject({
          code: "timeout",
          kind: "streamableHttp",
        });

        const client = new McpClient({
          server: serverConfig(server),
          requestTimeoutMs: 100,
          transportFactory: (onEvent) =>
            new McpStreamableHttpTransport({
              url: urlFor(server),
              timeoutMs: 10,
              onEvent,
            }),
        });

        try {
          await client.start();
          throw new Error("Expected client start to fail.");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
          expect(["request_failed", "transport_error"]).toContain(code);
        }
        expect(client.getState()).toMatchObject({
          state: "degraded",
        });
      },
    );
  });

  test("configured headers are sent but redacted from diagnostics", async () => {
    const secret = "secret_header_value";
    let authorization: string | undefined;
    await withServer(
      (request) => {
        authorization = request.headers.get("authorization") ?? undefined;
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          result: {},
        });
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          headers: {
            Authorization: `Bearer ${secret}`,
          },
        });
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });

        const diagnosticsJson = JSON.stringify(transport.diagnostics());
        expect(authorization).toBe(`Bearer ${secret}`);
        expect(diagnosticsJson).not.toContain(secret);
        expect(diagnosticsJson).not.toContain("Authorization");
      },
    );
  });

  test("malformed JSON body fails without crashing manager", async () => {
    await withServer(
      () => new Response("{bad json", { headers: { "content-type": "application/json" } }),
      async (server) => {
        const manager = new McpClientManager({
          servers: [serverConfig(server)],
        });

        await expect(manager.start("remote")).rejects.toMatchObject({
          code: "transport_error",
        });

        expect(manager.getStatus().servers[0]).toMatchObject({
          id: "remote",
          state: "degraded",
        });
      },
    );
  });
});

describe("MCP Streamable HTTP transport SSE path", () => {
  test("POST SSE returns final response", async () => {
    await withServer(
      () =>
        sseResponse([
          sseEvent({
            data: {
              jsonrpc: JSON_RPC_VERSION,
              id: 1,
              result: { ok: true },
            },
          }),
        ]),
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });

        expect(events).toContainEqual({
          type: "message",
          message: {
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            result: { ok: true },
          },
        });
      },
    );
  });

  test("POST SSE emits intermediate notification before final response", async () => {
    await withServer(
      () =>
        sseResponse([
          sseEvent({
            data: {
              jsonrpc: JSON_RPC_VERSION,
              method: "notifications/tools/list_changed",
            },
          }),
          sseEvent({
            data: {
              jsonrpc: JSON_RPC_VERSION,
              id: 1,
              result: { tools: [] },
            },
          }),
        ]),
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });

        expect(events.filter((event) => event.type === "message").map((event) => event.message)).toEqual([
          {
            jsonrpc: JSON_RPC_VERSION,
            method: "notifications/tools/list_changed",
          },
          {
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            result: { tools: [] },
          },
        ]);
      },
    );
  });

  test("event id and retry are stored for diagnostics and resume", async () => {
    await withServer(
      (request) => {
        if (request.method === "GET") {
          return sseResponse([
            sseEvent({
              id: "event-2",
              retry: 3000,
              data: {
                jsonrpc: JSON_RPC_VERSION,
                method: "notifications/tools/list_changed",
              },
            }),
          ]);
        }

        return sseResponse([
          sseEvent({
            id: "event-1",
            retry: 1500,
            data: {
              jsonrpc: JSON_RPC_VERSION,
              id: 1,
              result: {},
            },
          }),
        ]);
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        });
        expect(transport.diagnostics()).toMatchObject({
          lastEventId: "event-1",
          retryMs: 1500,
        });

        await transport.listen();
        expect(transport.diagnostics()).toMatchObject({
          lastEventId: "event-2",
          retryMs: 3000,
        });
      },
    );
  });

  test("GET listen stream receives server notification", async () => {
    let method: string | undefined;
    let accept: string | null = null;
    await withServer(
      (request) => {
        method = request.method;
        accept = request.headers.get("accept");
        return sseResponse([
          sseEvent({
            data: {
              jsonrpc: JSON_RPC_VERSION,
              method: "notifications/tools/list_changed",
            },
          }),
        ]);
      },
      async (server) => {
        const events: McpTransportEvent[] = [];
        const transport = createTransport(server, events);
        transport.start();

        await transport.listen();

        expect(method).toBe("GET");
        expect(accept).toBe(STREAMABLE_HTTP_LISTEN_ACCEPT);
        expect(events).toContainEqual({
          type: "message",
          message: {
            jsonrpc: JSON_RPC_VERSION,
            method: "notifications/tools/list_changed",
          },
        });
      },
    );
  });

  test("malformed SSE JSON fails without crashing manager", async () => {
    await withServer(
      () => sseResponse(["data: {bad json\n\n"]),
      async (server) => {
        const manager = new McpClientManager({
          servers: [serverConfig(server)],
        });

        await expect(manager.start("remote")).rejects.toMatchObject({
          code: "transport_error",
        });
        expect(manager.getStatus().servers[0]).toMatchObject({
          id: "remote",
          state: "degraded",
        });
      },
    );
  });

  test("disconnect before final response maps to stream error", async () => {
    await withServer(
      () =>
        sseResponse([
          sseEvent({
            data: {
              jsonrpc: JSON_RPC_VERSION,
              method: "notifications/tools/list_changed",
            },
          }),
        ]),
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "tools/list",
          }),
        ).rejects.toMatchObject({
          code: "stream_error",
          kind: "streamableHttp",
        });
      },
    );
  });
});

describe("MCP Streamable HTTP session lifecycle", () => {
  test("initialize captures session id and tools/list sends it", async () => {
    const sessionId = "session-abc123";
    let toolsListSession: string | null = null;

    await withServer(
      async (request) => {
        const body = await request.json();
        if (body.method === "initialize") {
          return Response.json(
            {
              jsonrpc: JSON_RPC_VERSION,
              id: body.id,
              result: { ok: true },
            },
            {
              headers: {
                [MCP_SESSION_ID_HEADER]: sessionId,
              },
            },
          );
        }

        toolsListSession = request.headers.get(MCP_SESSION_ID_HEADER);
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          result: { tools: [] },
        });
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });
        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 2,
          method: "tools/list",
        });

        expect(toolsListSession).toBe(sessionId);
        expect(transport.diagnostics()).toMatchObject({
          sessionId: "<redacted>",
        });
        expect(JSON.stringify(transport.diagnostics())).not.toContain(sessionId);
      },
    );
  });

  test("invalid session id header is rejected and redacted", async () => {
    const invalidSessionId = "session with space";
    await withServer(
      async (request) => {
        const body = await request.json();
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {},
          },
          {
            headers: {
              [MCP_SESSION_ID_HEADER]: invalidSessionId,
            },
          },
        );
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "initialize",
          }),
        ).rejects.toMatchObject({
          code: "invalid_response",
          kind: "streamableHttp",
        });

        expect(JSON.stringify(transport.diagnostics())).not.toContain(invalidSessionId);
      },
    );
  });

  test("404 with active session resets session and requests re-initialization", async () => {
    const sessionId = "expired-session";
    await withServer(
      async (request) => {
        const body = await request.json();
        if (body.method === "initialize") {
          return Response.json(
            {
              jsonrpc: JSON_RPC_VERSION,
              id: body.id,
              result: {},
            },
            {
              headers: {
                [MCP_SESSION_ID_HEADER]: sessionId,
              },
            },
          );
        }

        return new Response("expired", { status: 404 });
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 2,
            method: "tools/list",
          }),
        ).rejects.toMatchObject({
          code: "session_expired",
          kind: "streamableHttp",
        });

        const diagnostics = JSON.stringify(transport.diagnostics());
        expect(diagnostics).not.toContain(sessionId);
        expect(diagnostics).not.toContain("<redacted>");
      },
    );
  });

  test("DELETE is sent on close with session id", async () => {
    const sessionId = "session-delete";
    let deleteSession: string | null = null;
    await withServer(
      async (request) => {
        if (request.method === "DELETE") {
          deleteSession = request.headers.get(MCP_SESSION_ID_HEADER);
          return new Response(null, { status: 204 });
        }

        const body = await request.json();
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {},
          },
          {
            headers: {
              [MCP_SESSION_ID_HEADER]: sessionId,
            },
          },
        );
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });
        await transport.close();

        expect(deleteSession).toBe(sessionId);
        expect(transport.diagnostics()).not.toHaveProperty("sessionId");
      },
    );
  });

  test("DELETE 405 does not fail shutdown", async () => {
    const sessionId = "session-delete-unsupported";
    let deleteSeen = false;
    await withServer(
      async (request) => {
        if (request.method === "DELETE") {
          deleteSeen = true;
          return new Response(null, { status: 405 });
        }

        const body = await request.json();
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {},
          },
          {
            headers: {
              [MCP_SESSION_ID_HEADER]: sessionId,
            },
          },
        );
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        await expect(transport.shutdown()).resolves.toBeUndefined();
        expect(deleteSeen).toBe(true);
      },
    );
  });

  test("concurrent requests use the same active session id", async () => {
    const sessionId = "session-concurrent";
    const seenSessions: Array<string | null> = [];
    await withServer(
      async (request) => {
        const body = await request.json();
        if (body.method === "initialize") {
          return Response.json(
            {
              jsonrpc: JSON_RPC_VERSION,
              id: body.id,
              result: {},
            },
            {
              headers: {
                [MCP_SESSION_ID_HEADER]: sessionId,
              },
            },
          );
        }

        seenSessions.push(request.headers.get(MCP_SESSION_ID_HEADER));
        await delay(5);
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          result: {},
        });
      },
      async (server) => {
        const transport = createTransport(server);
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        await Promise.all([
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 2,
            method: "tools/list",
          }),
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 3,
            method: "tools/list",
          }),
        ]);

        expect(seenSessions).toEqual([sessionId, sessionId]);
      },
    );
  });
});

describe("MCP Streamable HTTP static auth", () => {
  test("bearer env sends Authorization header", async () => {
    let authorization: string | null = null;
    await withServer(
      (request) => {
        authorization = request.headers.get("authorization");
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          result: {},
        });
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          auth: {
            type: "bearerEnv",
            env: "MCP_TOKEN",
          },
          env: {
            MCP_TOKEN: "secret-token",
          },
        });
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        expect(authorization).toBe("Bearer secret-token");
      },
    );
  });

  test("API-key env sends configured header", async () => {
    let apiKey: string | null = null;
    await withServer(
      (request) => {
        apiKey = request.headers.get("x-api-key");
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          result: {},
        });
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          auth: {
            type: "apiKeyEnv",
            header: "X-API-Key",
            env: "MCP_API_KEY",
          },
          env: {
            MCP_API_KEY: "secret-api-key",
          },
        });
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        expect(apiKey).toBe("secret-api-key");
      },
    );
  });

  test("missing env produces auth_config_error and does not leak other tokens", async () => {
    await withServer(
      () => {
        throw new Error("request should not be sent");
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          auth: {
            type: "bearerEnv",
            env: "MISSING_MCP_TOKEN",
          },
          env: {
            OTHER_TOKEN: "secret-token",
          },
        });
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "initialize",
          }),
        ).rejects.toMatchObject({
          code: "auth_config_error",
          kind: "streamableHttp",
        });

        const diagnostics = JSON.stringify(transport.diagnostics());
        expect(diagnostics).toContain("MISSING_MCP_TOKEN");
        expect(diagnostics).not.toContain("secret-token");
      },
    );
  });

  test("auth type none sends no auth headers", async () => {
    let authorization: string | null = "unexpected";
    let apiKey: string | null = "unexpected";
    await withServer(
      (request) => {
        authorization = request.headers.get("authorization");
        apiKey = request.headers.get("x-api-key");
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          result: {},
        });
      },
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          auth: { type: "none" },
        });
        transport.start();

        await transport.send({
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "initialize",
        });

        expect(authorization).toBeNull();
        expect(apiKey).toBeNull();
      },
    );
  });

  test("HTTP 401 with static auth reports unauthorized next action without leaking token", async () => {
    await withServer(
      () => new Response("unauthorized", { status: 401 }),
      async (server) => {
        const transport = new McpStreamableHttpTransport({
          url: urlFor(server),
          auth: {
            type: "bearerEnv",
            env: "MCP_TOKEN",
          },
          env: {
            MCP_TOKEN: "secret-token",
          },
        });
        transport.start();

        await expect(
          transport.send({
            jsonrpc: JSON_RPC_VERSION,
            id: 1,
            method: "initialize",
          }),
        ).rejects.toMatchObject({
          code: "auth_required",
          kind: "streamableHttp",
        });

        const diagnostics = JSON.stringify(transport.diagnostics());
        expect(diagnostics).toContain("static authentication");
        expect(diagnostics).not.toContain("secret-token");
      },
    );
  });
});

function createTransport(server: ReturnType<typeof Bun.serve>, events: McpTransportEvent[] = []): McpStreamableHttpTransport {
  return new McpStreamableHttpTransport({
    url: urlFor(server),
    onEvent: (event) => events.push(event),
  });
}

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (server: ReturnType<typeof Bun.serve>) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({
    port: 0,
    fetch: handler,
  });

  try {
    await run(server);
  } finally {
    server.stop(true);
  }
}

function urlFor(server: ReturnType<typeof Bun.serve>): string {
  return new URL("/mcp", server.url).toString();
}

function serverConfig(server: ReturnType<typeof Bun.serve>): McpServerConfig {
  return {
    id: "remote",
    name: "Remote MCP",
    transport: "streamableHttp",
    url: urlFor(server),
    headers: {},
    auth: { type: "none" },
    timeoutMs: 50,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

function sseEvent(options: { data: unknown; event?: string; id?: string; retry?: number }): string {
  const lines: string[] = [];
  if (options.id !== undefined) {
    lines.push(`id: ${options.id}`);
  }
  if (options.event !== undefined) {
    lines.push(`event: ${options.event}`);
  }
  if (options.retry !== undefined) {
    lines.push(`retry: ${options.retry}`);
  }
  lines.push(`data: ${JSON.stringify(options.data)}`);
  return `${lines.join("\n")}\n\n`;
}
