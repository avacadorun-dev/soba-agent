import type { JsonValue } from "./json-rpc";

export interface AcpFeatureSet {
  initialize: boolean;
  sessionNew: boolean;
  sessionPrompt: boolean;
  loadSession: boolean;
  embeddedContext: boolean;
  image: boolean;
  audio: boolean;
}

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_LIFECYCLE_FEATURES: AcpFeatureSet = {
  initialize: true,
  sessionNew: true,
  sessionPrompt: true,
  loadSession: true,
  embeddedContext: true,
  image: true,
  audio: false,
};

export function buildAgentCapabilities(features: AcpFeatureSet = ACP_LIFECYCLE_FEATURES): JsonValue {
  const sessionCapabilities: Record<string, JsonValue> = {
    close: {},
    delete: {},
    list: {},
  };
  if (features.loadSession) {
    sessionCapabilities.resume = {};
  }

  return {
    loadSession: features.loadSession,
    promptCapabilities: {
      audio: features.audio,
      embeddedContext: features.embeddedContext,
      image: features.image,
    },
    sessionCapabilities,
  };
}
