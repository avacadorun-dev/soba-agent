/**
 * SoundNotifier — event listener that plays audio on agent events.
 *
 * Subscribes to AgentEvent and plays system sounds for:
 *   - turn_stop_reason "completed" → done.wav (агент перешёл в ожидание)
 *   - turn_error → error.wav (ошибка или аварийная остановка)
 *   - dangerous_confirmation → dangerous.wav (требуется разрешение)
 *
 * Platform-specific playback:
 *   - macOS:   afplay <file>
 *   - Linux:   paplay <file> (PulseAudio) or aplay <file> (ALSA)
 *   - Windows: powershell -c (New-Object Media.SoundPlayer '<file>').PlaySync()
 */

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { SoundConfig } from "../config/types";
import { type AgentEvent } from "../loop/types";

export type PlaySoundFn = (filePath: string) => void;

/** Resolve audio files directory relative to the module or binary location */
export function getAudioDir(): string {
  const packageRoot = process.env.SOBA_PACKAGE_ROOT;
  const candidates = [
    ...(packageRoot ? [resolve(packageRoot, "src", "audio")] : []),
    resolve(process.cwd(), "src", "audio"),
    resolve(dirname(process.argv[1] ?? process.cwd()), "..", "src", "audio"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/** Default platform-specific sound playback. Can be overridden for testing. */
export function defaultPlaySound(filePath: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      if (!which("afplay")) return;
      spawnDetached("afplay", [filePath]);
    } else if (platform === "linux") {
      const cmd = firstAvailableCommand(["paplay", "aplay"]);
      if (!cmd) return;
      spawnDetached(cmd, [filePath]);
    } else if (platform === "win32") {
      spawnDetached(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`,
        ],
      );
    }
  } catch {
    // Audio playback failures should never crash the agent
  }
}

function firstAvailableCommand(commands: string[]): string | null {
  return commands.find((cmd) => which(cmd)) ?? null;
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    // Missing audio backends or broken sound devices are non-fatal.
  });
  child.unref();
}

function which(cmd: string): boolean {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return false;

  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const directory of pathEnv.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const suffix =
        process.platform === "win32" && !cmd.toUpperCase().endsWith(extension.toUpperCase()) ? extension : "";
      try {
        accessSync(join(directory, `${cmd}${suffix}`), constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

export class SoundNotifier {
  private config: SoundConfig;
  private repeatInterval: ReturnType<typeof setInterval> | null = null;
  private playSound: PlaySoundFn;

  constructor(config: SoundConfig, playSoundFn?: PlaySoundFn) {
    this.config = config;
    this.playSound = playSoundFn ?? defaultPlaySound;
  }

  /** Handle an agent event and play the appropriate sound if enabled */
  handleEvent(event: AgentEvent): void {
    if (!this.config.enabled) return;

    let soundFile: string | null = null;

    switch (event.type) {
      case "turn_stop_reason": {
        if (event.reason === "completed") {
          soundFile = "done.wav";
        } else if (event.reason === "api-error" || event.reason === "aborted" || event.reason === "security-denial") {
          soundFile = "error.wav";
        }
        break;
      }
      case "turn_error": {
        soundFile = "error.wav";
        break;
      }
      case "dangerous_confirmation": {
        soundFile = "dangerous.wav";
        break;
      }
    }

    if (soundFile) {
      this.play(soundFile);
    }
  }

  /** Update config at runtime (e.g. user toggles sound on/off) */
  updateConfig(config: SoundConfig): void {
    const oldEnabled = this.config.enabled;
    this.config = config;
    if (oldEnabled && !config.enabled) {
      this.stopRepeat();
    }
  }

  /** Clean up intervals */
  dispose(): void {
    this.stopRepeat();
  }

  private play(soundFile: string): void {
    this.stopRepeat();

    const audioDir = process.env.SOBA_TEST_AUDIO_DIR ?? getAudioDir();
    const filePath = `${audioDir}/${soundFile}`;
    this.playSound(filePath);

    if (this.config.repeatMode === "repeat") {
      this.repeatInterval = setInterval(() => {
        this.playSound(filePath);
      }, this.config.repeatIntervalMs);
    }
  }

  private stopRepeat(): void {
    if (this.repeatInterval !== null) {
      clearInterval(this.repeatInterval);
      this.repeatInterval = null;
    }
  }
}
