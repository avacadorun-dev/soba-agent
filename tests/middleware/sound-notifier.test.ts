/**
 * SoundNotifier tests.
 *
 * Tests:
 * - Play on turn_stop_reason "completed" → done.wav
 * - Play on turn_error → error.wav
 * - Play on dangerous_confirmation → dangerous.wav
 * - No play on other events
 * - Disabled: no play
 * - Repeat mode: interval is set
 * - Update config: toggle enabled/disabled
 * - Dispose: clears intervals
 * - api-error / security-denial → error.wav
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SoundConfig } from "../../src/application/config/types";
import { DEFAULT_SOUND_CONFIG } from "../../src/application/config/types";
import type {
  AgentEvent,
  DangerousConfirmationEvent,
  TurnErrorEvent,
  TurnStopReasonEvent,
} from "../../src/engine/turn/types";
import { defaultPlaySound, type PlaySoundFn, SoundNotifier } from "../../src/infrastructure/terminal/sound-notifier";

function createMockEvent<T extends AgentEvent>(
  type: T["type"],
  overrides: Partial<Omit<T, "type" | "timestamp">> = {},
): T {
  const base = {
    timestamp: Date.now(),
    ...overrides,
  };
  return { type, ...base } as unknown as T;
}

// Set a test audio dir so the path resolution doesn't fail
process.env.SOBA_TEST_AUDIO_DIR = "/tmp/soba-test-audio";

describe("SoundNotifier", () => {
  let notifier: SoundNotifier;
  let config: SoundConfig;
  let playedFiles: string[];
  let fakePlaySound: PlaySoundFn;

  beforeEach(() => {
    playedFiles = [];
    fakePlaySound = mock((filePath: string) => {
      playedFiles.push(filePath);
    });
    config = { ...DEFAULT_SOUND_CONFIG };
  });

  afterEach(() => {
    notifier?.dispose();
  });

  test("воспроизводит done.wav при turn_stop_reason completed", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "completed",
      detail: "task done",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("done.wav");
  });

  test("воспроизводит error.wav при turn_error", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnErrorEvent>("turn_error", {
      error: "connection refused",
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("error.wav");
  });

  test("воспроизводит dangerous.wav при dangerous_confirmation", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<DangerousConfirmationEvent>("dangerous_confirmation", {
      toolName: "bash",
      toolCallId: "call_123",
      description: "rm -rf /",
      level: "dangerous",
      reason: "dangerous command",
      resolve: () => {},
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("dangerous.wav");
  });

  test("не воспроизводит звук на другие события (turn_start, thinking и т.д.)", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent("turn_start", {
      turnIndex: 1,
      userInput: "hello",
    });

    notifier.handleEvent(event);
    expect(playedFiles.length).toBe(0);
  });

  test("не воспроизводит звук при turn_stop_reason с loop-guard или continuation-exhausted", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const loopGuardEvent = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 5,
      reason: "loop-guard",
      detail: "too many iterations",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });
    notifier.handleEvent(loopGuardEvent);
    expect(playedFiles.length).toBe(0);

    const contExhaustedEvent = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "continuation-exhausted",
      detail: "max follow-ups",
      hasUsedTools: true,
      autonomousFollowUps: 5,
    });
    notifier.handleEvent(contExhaustedEvent);
    expect(playedFiles.length).toBe(0);

    const budgetEvent = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "budget-exceeded",
      detail: "budget hit",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });
    notifier.handleEvent(budgetEvent);
    expect(playedFiles.length).toBe(0);
  });

  test("не воспроизводит звук когда enabled = false", () => {
    config.enabled = false;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "completed",
      detail: "done",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);
    expect(playedFiles.length).toBe(0);
  });

  test("режим повтора: setInterval вызывается когда repeatMode = repeat", () => {
    const setIntervalSpy = spyOn(globalThis, "setInterval");

    try {
      config.enabled = true;
      config.repeatMode = "repeat";
      config.repeatIntervalMs = 3000;
      notifier = new SoundNotifier(config, fakePlaySound);

      const event = createMockEvent<DangerousConfirmationEvent>("dangerous_confirmation", {
        toolName: "bash",
        toolCallId: "call_456",
        description: "sudo rm -rf /",
        level: "dangerous",
        reason: "dangerous",
        resolve: () => {},
      });

      notifier.handleEvent(event);

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy.mock.calls[0][1]).toBe(3000);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test("режим once: setInterval не вызывается", () => {
    const setIntervalSpy = spyOn(globalThis, "setInterval");

    try {
      config.enabled = true;
      config.repeatMode = "once";
      notifier = new SoundNotifier(config, fakePlaySound);

      const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
        turn: 1,
        iteration: 1,
        reason: "completed",
        detail: "done",
        hasUsedTools: true,
        autonomousFollowUps: 0,
      });

      notifier.handleEvent(event);
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test("новое событие очищает предыдущий repeat-интервал", () => {
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");

    // We need to simulate having an interval. set up repeat mode, trigger
    // first event (which creates an interval), then trigger second event
    // and verify clearInterval was called.
    try {
      config.enabled = true;
      config.repeatMode = "repeat";
      notifier = new SoundNotifier(config, fakePlaySound);

      // First event — creates interval
      const event1 = createMockEvent<DangerousConfirmationEvent>("dangerous_confirmation", {
        toolName: "bash",
        toolCallId: "call_1",
        description: "cmd1",
        level: "dangerous",
        reason: "dangerous",
        resolve: () => {},
      });
      notifier.handleEvent(event1);

      // Clear the spy history so we only track clearInterval call from second event
      clearIntervalSpy.mockClear();

      // Second event — should clear old interval
      const event2 = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
        turn: 1,
        iteration: 1,
        reason: "completed",
        detail: "done",
        hasUsedTools: true,
        autonomousFollowUps: 0,
      });
      notifier.handleEvent(event2);

      // clearInterval should have been called with the interval id
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      clearIntervalSpy.mockRestore();
    }
  });

  test("dispose: не бросает ошибку при очистке", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    // dispose should not throw even when no interval is active
    expect(() => notifier.dispose()).not.toThrow();
  });

  test("updateConfig: переключение enabled на false очищает интервал", () => {
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");

    try {
      config.enabled = true;
      config.repeatMode = "repeat";
      notifier = new SoundNotifier(config, fakePlaySound);

      // Start a repeat
      const event = createMockEvent<DangerousConfirmationEvent>("dangerous_confirmation", {
        toolName: "bash",
        toolCallId: "call_1",
        description: "cmd",
        level: "dangerous",
        reason: "dangerous",
        resolve: () => {},
      });
      notifier.handleEvent(event);

      clearIntervalSpy.mockClear();

      // Now disable sound
      notifier.updateConfig({ ...config, enabled: false });

      // clearInterval should have been called to stop the repeat
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      clearIntervalSpy.mockRestore();
    }
  });

  test("updateConfig: обновление конфига после отключения", () => {
    config.enabled = false;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "completed",
      detail: "done",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);
    expect(playedFiles.length).toBe(0);

    // Enable sound
    notifier.updateConfig({ ...config, enabled: true });
    notifier.handleEvent(event);
    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("done.wav");
  });

  test("turn_stop_reason с api-error воспроизводит error.wav", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "api-error",
      detail: "rate limited",
      hasUsedTools: false,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("error.wav");
  });

  test("turn_stop_reason с security-denial воспроизводит error.wav", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "security-denial",
      detail: "command blocked",
      hasUsedTools: false,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("error.wav");
  });

  test("turn_stop_reason с aborted воспроизводит error.wav", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "aborted",
      detail: "user aborted",
      hasUsedTools: false,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);

    expect(playedFiles.length).toBe(1);
    expect(playedFiles[0]).toContain("error.wav");
  });

  test("путь к аудиофайлу содержит SOBA_TEST_AUDIO_DIR", () => {
    config.enabled = true;
    notifier = new SoundNotifier(config, fakePlaySound);

    const event = createMockEvent<TurnStopReasonEvent>("turn_stop_reason", {
      turn: 1,
      iteration: 1,
      reason: "completed",
      detail: "done",
      hasUsedTools: true,
      autonomousFollowUps: 0,
    });

    notifier.handleEvent(event);

    expect(playedFiles[0]).toBe("/tmp/soba-test-audio/done.wav");
  });

  test("defaultPlaySound не падает, когда системный проигрыватель отсутствует", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";

    try {
      expect(() => defaultPlaySound("/tmp/soba-test-audio/done.wav")).not.toThrow();
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
