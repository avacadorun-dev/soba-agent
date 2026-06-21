/**
 * Provider identity, capabilities and error classification tests.
 *
 * Covers plan A.2:
 * - Explicit provider identity and capabilities
 * - Provider-issued continuation compatibility key
 * - Error classification (context_overflow, rate_limit, authentication, etc.)
 * - Generic OpenAI-compatible adapter defaults (nativeCompaction: false)
 * - Developer message fallback contract
 */

import { describe, expect, test } from "bun:test";
import { classifyOpenAIError, OpenAIAdapter } from "../../../src/core/middleware/openai-adapter";
import type { ProviderConfig } from "../../../src/core/middleware/types";

const adapter = new OpenAIAdapter();

const openaiConfig: ProviderConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "fake-api-key",
  model: "gpt-4o",
};

const deepseekConfig: ProviderConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "ds-test",
  model: "deepseek-v4-pro",
};

// ─── Provider Identity ───

describe("OpenAIAdapter.getIdentity", () => {
  test("returns adapterId=openai", () => {
    const identity = adapter.getIdentity(openaiConfig);
    expect(identity.adapterId).toBe("openai");
  });

  test("extracts endpointOrigin from baseUrl", () => {
    const identity = adapter.getIdentity(openaiConfig);
    expect(identity.endpointOrigin).toBe("https://api.openai.com");
  });

  test("includes model in identity", () => {
    const identity = adapter.getIdentity(openaiConfig);
    expect(identity.model).toBe("gpt-4o");
  });

  test("different endpoints produce different identities", () => {
    const id1 = adapter.getIdentity(openaiConfig);
    const id2 = adapter.getIdentity(deepseekConfig);
    expect(id1.endpointOrigin).not.toBe(id2.endpointOrigin);
    expect(id1.model).not.toBe(id2.model);
  });

  test("handles invalid baseUrl gracefully", () => {
    const config: ProviderConfig = { ...openaiConfig, baseUrl: "not-a-url" };
    const identity = adapter.getIdentity(config);
    // Should not throw; endpointOrigin falls back to the raw string
    expect(identity.endpointOrigin).toBe("not-a-url");
  });
});

// ─── Provider Capabilities ───

describe("OpenAIAdapter.getCapabilities", () => {
  test("nativeCompaction is false for generic OpenAI-compatible adapter", () => {
    const caps = adapter.getCapabilities(openaiConfig);
    expect(caps.nativeCompaction).toBe(false);
  });

  test("structuredOutput is true", () => {
    const caps = adapter.getCapabilities(openaiConfig);
    expect(caps.structuredOutput).toBe(true);
  });

  test("developerMessages is false (Chat Completions uses system role)", () => {
    const caps = adapter.getCapabilities(openaiConfig);
    expect(caps.developerMessages).toBe(false);
  });

  test("continuationCompatibilityKey is non-empty string", () => {
    const caps = adapter.getCapabilities(openaiConfig);
    expect(typeof caps.continuationCompatibilityKey).toBe("string");
    expect((caps.continuationCompatibilityKey ?? "").length).toBeGreaterThan(0);
  });

  test("compatibility key changes when model changes", () => {
    const caps1 = adapter.getCapabilities(openaiConfig);
    const caps2 = adapter.getCapabilities({ ...openaiConfig, model: "gpt-4o-mini" });
    expect(caps1.continuationCompatibilityKey).not.toBe(caps2.continuationCompatibilityKey);
  });

  test("compatibility key changes when endpoint changes", () => {
    const caps1 = adapter.getCapabilities(openaiConfig);
    const caps2 = adapter.getCapabilities(deepseekConfig);
    expect(caps1.continuationCompatibilityKey).not.toBe(caps2.continuationCompatibilityKey);
  });

  test("compatibility key is stable for same config", () => {
    const caps1 = adapter.getCapabilities(openaiConfig);
    const caps2 = adapter.getCapabilities(openaiConfig);
    expect(caps1.continuationCompatibilityKey).toBe(caps2.continuationCompatibilityKey);
  });
});

// ─── Error Classification ───

describe("classifyOpenAIError / OpenAIAdapter.classifyError", () => {
  // context_overflow
  test("classifies context_length_exceeded code as context_overflow", () => {
    const err = { status: 400, code: "context_length_exceeded", message: "context_length_exceeded", type: "" };
    expect(classifyOpenAIError(err)).toBe("context_overflow");
  });

  test("classifies 'maximum context length' message as context_overflow", () => {
    const err = new Error("This model's maximum context length is 128000 tokens");
    expect(classifyOpenAIError(err)).toBe("context_overflow");
  });

  test("classifies 'too many tokens' message as context_overflow", () => {
    const err = new Error("Request contains too many tokens");
    expect(classifyOpenAIError(err)).toBe("context_overflow");
  });

  // rate_limit
  test("classifies 429 status as rate_limit", () => {
    const err = { status: 429, code: "rate_limit_exceeded", message: "", type: "" };
    expect(classifyOpenAIError(err)).toBe("rate_limit");
  });

  test("classifies 'rate limit' message as rate_limit", () => {
    const err = new Error("You exceeded your current rate limit");
    expect(classifyOpenAIError(err)).toBe("rate_limit");
  });

  // authentication
  test("classifies 401 status as authentication", () => {
    const err = { status: 401, code: "invalid_api_key", message: "", type: "" };
    expect(classifyOpenAIError(err)).toBe("authentication");
  });

  test("classifies 'invalid api key' message as authentication", () => {
    const err = new Error("Invalid API key provided");
    expect(classifyOpenAIError(err)).toBe("authentication");
  });

  // timeout
  test("classifies timeout message as timeout", () => {
    const err = new Error("Request timed out after 30s");
    expect(classifyOpenAIError(err)).toBe("timeout");
  });

  // transient
  test("classifies 500 status as transient", () => {
    const err = { status: 500, code: "", message: "internal server error", type: "" };
    expect(classifyOpenAIError(err)).toBe("transient");
  });

  test("classifies 503 status as transient", () => {
    const err = { status: 503, code: "", message: "service unavailable", type: "" };
    expect(classifyOpenAIError(err)).toBe("transient");
  });

  // unknown
  test("classifies unknown error as unknown", () => {
    const err = new Error("Something completely unexpected");
    expect(classifyOpenAIError(err)).toBe("unknown");
  });

  test("classifies null as unknown", () => {
    expect(classifyOpenAIError(null)).toBe("unknown");
  });

  test("classifies string as unknown", () => {
    expect(classifyOpenAIError("some random error")).toBe("unknown");
  });

  // Via adapter method
  test("adapter.classifyError delegates to classifyOpenAIError", () => {
    const err = { status: 400, code: "context_length_exceeded", message: "", type: "" };
    expect(adapter.classifyError(err)).toBe("context_overflow");
  });

  // Critical: non-overflow errors must NOT trigger compaction
  test("non-overflow 400 error is not classified as context_overflow", () => {
    const err = { status: 400, code: "invalid_request_error", message: "invalid request", type: "" };
    const kind = classifyOpenAIError(err);
    expect(kind).not.toBe("context_overflow");
  });
});

// ─── Compatibility key contract ───

describe("Continuation compatibility key contract", () => {
  test("compatibility key encodes adapterId + endpointOrigin + model", () => {
    const caps = adapter.getCapabilities(openaiConfig);
    const key = caps.continuationCompatibilityKey ?? "";
    expect(key).toContain("openai");
    expect(key).toContain("api.openai.com");
    expect(key).toContain("gpt-4o");
  });

  test("same key means same provider+endpoint+model", () => {
    const configA: ProviderConfig = { baseUrl: "https://api.openai.com/v1", apiKey: "key1", model: "gpt-4o" };
    const configB: ProviderConfig = { baseUrl: "https://api.openai.com/v1", apiKey: "key2", model: "gpt-4o" };
    // API key should NOT affect compatibility key (it's about provider identity, not auth)
    const caps1 = adapter.getCapabilities(configA);
    const caps2 = adapter.getCapabilities(configB);
    expect(caps1.continuationCompatibilityKey).toBe(caps2.continuationCompatibilityKey);
  });
});
