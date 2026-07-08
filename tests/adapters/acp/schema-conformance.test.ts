import { describe, expect, test } from "bun:test";
import {
  AGENT_METHODS,
  type AgentCapabilities,
  CLIENT_METHODS,
  type InitializeResponse,
  PROTOCOL_METHODS,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import schema from "@agentclientprotocol/sdk/schema/schema.json";
import { ACP_PROTOCOL_VERSION, buildAgentCapabilities } from "../../../src/adapters/acp/capabilities";

describe("ACP schema conformance fixture", () => {
  test("tracks the official ACP protocol version and schema definitions", () => {
    expect(ACP_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$defs).toHaveProperty("InitializeResponse");
    expect(schema.$defs).toHaveProperty("SessionUpdate");
    expect(schema.$defs).toHaveProperty("ListSessionsRequest");
    expect(schema.$defs).toHaveProperty("CancelRequestNotification");
  });

  test("uses official method names for the implemented ACP v1 surface", () => {
    expect(AGENT_METHODS.initialize).toBe("initialize");
    expect(AGENT_METHODS.session_new).toBe("session/new");
    expect(AGENT_METHODS.session_load).toBe("session/load");
    expect(AGENT_METHODS.session_resume).toBe("session/resume");
    expect(AGENT_METHODS.session_list).toBe("session/list");
    expect(AGENT_METHODS.session_prompt).toBe("session/prompt");
    expect(AGENT_METHODS.session_cancel).toBe("session/cancel");
    expect(CLIENT_METHODS.session_request_permission).toBe("session/request_permission");
    expect(CLIENT_METHODS.fs_read_text_file).toBe("fs/read_text_file");
    expect(CLIENT_METHODS.fs_write_text_file).toBe("fs/write_text_file");
    expect(PROTOCOL_METHODS.cancel_request).toBe("$/cancel_request");
  });

  test("builds initialize capabilities assignable to the official SDK types", () => {
    const agentCapabilities = buildAgentCapabilities() as unknown as AgentCapabilities;
    const response = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities,
      agentInfo: { name: "soba-agent", version: "test" },
    } satisfies InitializeResponse;

    expect(response.agentCapabilities?.auth).toEqual({});
    expect(response.agentCapabilities?.mcpCapabilities).toMatchObject({
      http: false,
      sse: false,
      _meta: { soba: { sessionScopedMcpServers: "runtime_input_only" } },
    });
    expect(response.agentCapabilities?.sessionCapabilities).toMatchObject({
      additionalDirectories: {},
      close: {},
      delete: {},
      list: {},
      resume: {},
    });
  });
});
