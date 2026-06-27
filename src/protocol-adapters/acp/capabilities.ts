import type { JsonValue } from "./json-rpc";

export interface AcpFeatureSet {
  initialize: boolean;
  sessionNew: boolean;
  sessionPrompt: boolean;
  loadSession: boolean;
  sessionConfig: boolean;
  sessionModes: boolean;
  embeddedContext: boolean;
  image: boolean;
  audio: boolean;
}

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_FOUNDATION_FEATURES: AcpFeatureSet = {
  initialize: true,
  sessionNew: true,
  sessionPrompt: false,
  loadSession: false,
  sessionConfig: false,
  sessionModes: false,
  embeddedContext: false,
  image: false,
  audio: false,
};

export function buildAgentCapabilities(features: AcpFeatureSet = ACP_FOUNDATION_FEATURES): JsonValue {
  return {
    loadSession: features.loadSession,
    promptCapabilities: {
      embeddedContext: features.embeddedContext,
      image: features.image,
      audio: features.audio,
    },
    sessionConfig: features.sessionConfig,
    sessionModes: features.sessionModes,
  };
}
