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

export const ACP_LIFECYCLE_FEATURES: AcpFeatureSet = {
  initialize: true,
  sessionNew: true,
  sessionPrompt: true,
  loadSession: true,
  sessionConfig: true,
  sessionModes: true,
  embeddedContext: true,
  image: true,
  audio: false,
};

export function buildAgentCapabilities(features: AcpFeatureSet = ACP_LIFECYCLE_FEATURES): JsonValue {
  return {
    promptCapabilities: {
      audio: features.audio,
      embeddedContext: features.embeddedContext,
      image: features.image,
    },
    sessionCapabilities: {
      cancel: true,
      close: true,
      delete: true,
      list: true,
      load: features.loadSession,
      update: true,
    },
    sessionConfig: features.sessionConfig,
    sessionModes: features.sessionModes,
  };
}
