import type { AgentCapabilities } from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { JsonValue } from "./json-rpc";

export interface AcpFeatureSet {
  initialize: boolean;
  sessionNew: boolean;
  sessionPrompt: boolean;
  loadSession: boolean;
  additionalDirectories: boolean;
  embeddedContext: boolean;
  image: boolean;
  audio: boolean;
  mcpHttp: boolean;
  mcpSse: boolean;
}

export const ACP_PROTOCOL_VERSION = PROTOCOL_VERSION;

export const ACP_LIFECYCLE_FEATURES: AcpFeatureSet = {
  initialize: true,
  sessionNew: true,
  sessionPrompt: true,
  loadSession: true,
  additionalDirectories: true,
  embeddedContext: true,
  image: true,
  audio: false,
  mcpHttp: false,
  mcpSse: false,
};

export function buildAgentCapabilities(features: AcpFeatureSet = ACP_LIFECYCLE_FEATURES): JsonValue {
  const sessionCapabilities: NonNullable<AgentCapabilities["sessionCapabilities"]> = {
    close: {},
    delete: {},
    list: {},
  };
  if (features.loadSession) {
    sessionCapabilities.resume = {};
  }
  if (features.additionalDirectories) {
    sessionCapabilities.additionalDirectories = {};
  }

  const capabilities: AgentCapabilities = {
    loadSession: features.loadSession,
    auth: {},
    mcpCapabilities: {
      http: features.mcpHttp,
      sse: features.mcpSse,
      _meta: {
        soba: {
          sessionScopedMcpServers: "runtime_input_only",
        },
      },
    },
    promptCapabilities: {
      audio: features.audio,
      embeddedContext: features.embeddedContext,
      image: features.image,
    },
    sessionCapabilities,
    _meta: {
      soba: {
        extensions: {
          fsListDirectory: "fs/list_directory",
          fsInspectTextFile: "fs/inspect_text_file",
          fsSearchFiles: "fs/search_files",
        },
      },
    },
  };
  return capabilities as JsonValue;
}
