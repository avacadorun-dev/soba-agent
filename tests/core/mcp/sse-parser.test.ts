import { describe, expect, test } from "bun:test";
import { SseParser } from "../../../src/core/mcp/sse-parser";

describe("MCP SSE parser", () => {
  test("multi-line data parses as one event", () => {
    const parser = new SseParser();

    expect(parser.push("event: message\ndata: {\"a\":1}\ndata: {\"b\":2}\n\n")).toEqual([
      {
        event: "message",
        data: "{\"a\":1}\n{\"b\":2}",
      },
    ]);
  });

  test("comments and heartbeat events are ignored", () => {
    const parser = new SseParser();

    expect(parser.push(": ping\n\n\n")).toEqual([]);
  });

  test("id and retry fields are preserved", () => {
    const parser = new SseParser();

    expect(parser.push("id: event-1\nretry: 2500\ndata: {\"ok\":true}\n\n")).toEqual([
      {
        id: "event-1",
        retry: 2500,
        data: "{\"ok\":true}",
      },
    ]);
  });

  test("flush emits a buffered event without trailing blank line", () => {
    const parser = new SseParser();

    expect(parser.push("data: {\"ok\":")).toEqual([]);
    expect(parser.flush()).toEqual([
      {
        data: "{\"ok\":",
      },
    ]);
  });
});
