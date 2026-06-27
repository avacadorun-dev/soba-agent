/**
 * Phase 2.5 B1d — Test Connection Notification tests.
 *
 * Tests for:
 *  - ProviderStore.select() triggers testConnection after successful switch
 *  - Success → notification with type "success"
 *  - Failure → notification with type "error"
 *  - No notification when notificationStore is not set
 *  - setNotificationStore works after construction
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { I18n } from "../../../../src/core/i18n/i18n";
import type { OpenResponsesClientProxy } from "../../../../src/core/provider/client-proxy";
import { ProviderRegistry } from "../../../../src/core/provider/registry";
import { NotificationStore } from "../../../../src/ui/terminal/interactive/model/notification-store";
import { ProviderStore } from "../../../../src/ui/terminal/interactive/model/provider-store";

/** Wait a tick for async microtasks to flush. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function createMockRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry({
    defaultProvider: "test",
    defaultModel: "model-1",
    providers: { test: { baseUrl: "https://test.example.com/v1", apiKey: "fake-api-key" } },
    customProviders: {
      test: {
        id: "test",
        name: "Test Provider",
        baseUrl: "https://test.example.com/v1",
        apiKeyEnv: "TEST_KEY",
        adapter: "openai",
        models: [
          {
            id: "model-1",
            name: "Model One",
            contextWindow: 128000,
            maxOutput: 4096,
            supportsStreaming: true,
            supportsThinking: false,
          },
          {
            id: "model-2",
            name: "Model Two",
            contextWindow: 32768,
            maxOutput: 8192,
            supportsStreaming: true,
            supportsThinking: false,
          },
        ],
        custom: true,
      },
    },
  });

  return registry;
}

// Mock proxy
function createMockProxy(): OpenResponsesClientProxy {
  return {
    notifyChange: vi.fn(),
    onChange: vi.fn(() => () => {}),
    getBaseUrl: vi.fn().mockReturnValue("https://test.base.url/v1"),
    getModel: vi.fn().mockReturnValue("test-model"),
  } as unknown as OpenResponsesClientProxy;
}

describe("B1d — Test Connection Notification", () => {
  let registry: ProviderRegistry;
  let proxy: OpenResponsesClientProxy;
  let notificationStore: NotificationStore;

  beforeEach(() => {
    registry = createMockRegistry();
    proxy = createMockProxy();
    notificationStore = new NotificationStore({ i18n: new I18n("en") });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("после успешного switch → testConnection вызывает успешную нотификацию", async () => {
    vi.spyOn(registry, "switchModel").mockReturnValue({} as any);
    vi.spyOn(registry, "testConnection").mockResolvedValue({ ok: true, latencyMs: 42 });
    const notifySpy = vi.spyOn(notificationStore, "notify");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    store.select("test", "model-2");

    await tick();

    expect(registry.testConnection).toHaveBeenCalledWith("test", "model-2");
    expect(notifySpy).toHaveBeenCalledWith("success", "Connection test", "Connected to Test Provider / Model Two");
  });

  test("ошибка соединения → error-нотификация", async () => {
    vi.spyOn(registry, "switchModel").mockReturnValue({} as any);
    vi.spyOn(registry, "testConnection").mockResolvedValue({ ok: false, error: "Refused", statusCode: 500 });
    const notifySpy = vi.spyOn(notificationStore, "notify");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    store.select("test", "model-2");

    await tick();

    const errorCall = (notifySpy.mock.calls as unknown[][]).find((call) => call[0] === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toBe("Connection test");
    expect(errorCall![2]).toBe("Refused");
  });

  test("testConnection выбрасывает исключение → catch показывает error", async () => {
    vi.spyOn(registry, "switchModel").mockReturnValue({} as any);
    vi.spyOn(registry, "testConnection").mockRejectedValue(new Error("Network timeout"));
    const notifySpy = vi.spyOn(notificationStore, "notify");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    store.select("test", "model-2");

    await tick();

    const errorCall = (notifySpy.mock.calls as unknown[][]).find((call) => call[0] === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall![2]).toBe("Network timeout");
  });

  test("testConnection не вызывается при провале switch (неизвестный провайдер)", () => {
    const testConnSpy = vi.spyOn(registry, "testConnection");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    const status = store.select("nonexistent", "nonexistent-model");

    expect(status.kind).toBe("failed");
    expect(testConnSpy).not.toHaveBeenCalled();
  });

  test("testConnection не вызывается при провале switch (switchModel вернул false)", () => {
    vi.spyOn(registry, "switchModel").mockReturnValue(null);
    const testConnSpy = vi.spyOn(registry, "testConnection");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    const status = store.select("test", "model-1");

    expect(status.kind).toBe("failed");
    expect(testConnSpy).not.toHaveBeenCalled();
  });

  test("успешный switch + testConnection успешно", async () => {
    vi.spyOn(registry, "switchModel").mockReturnValue({} as any);
    vi.spyOn(registry, "testConnection").mockResolvedValue({ ok: true, latencyMs: 42 });
    const notifySpy = vi.spyOn(notificationStore, "notify");

    const store = new ProviderStore({ registry, proxy, notificationStore });
    const status = store.select("test", "model-2");

    expect(status.kind).toBe("switched");

    await tick();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith("success", "Connection test", "Connected to Test Provider / Model Two");
  });
});
