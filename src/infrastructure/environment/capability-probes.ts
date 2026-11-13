/**
 * Environment capability probes.
 *
 * Each probe is a real, bounded check against the OS so `soba doctor`
 * reflects the current permission state (granting Screen Recording or
 * Accessibility access changes the next report). Probes never throw; a failed
 * probe is an unavailable capability with the failure reason attached.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EnvironmentProbeResult {
  available: boolean;
  reason: string;
}

const PROBE_TIMEOUT_MS = 8000;

function runProbe(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr: `${stderr}\n[probe timed out after ${PROBE_TIMEOUT_MS}ms]`.trim() });
    }, PROBE_TIMEOUT_MS);
    timer.unref();

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", (error) => finish({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr });
    });
  });
}

async function probeScreenshot(): Promise<EnvironmentProbeResult> {
  if (process.platform !== "darwin") {
    return { available: false, reason: `screenshot probe not implemented on ${process.platform}` };
  }
  const dir = mkdtempSync(join(tmpdir(), "soba-cap-"));
  const target = join(dir, "shot.png");
  try {
    const result = await runProbe("screencapture", ["-x", target]);
    if (result.code !== 0) {
      return {
        available: false,
        reason: `screencapture failed (exit ${result.code ?? "signal"}): ${result.stderr.slice(0, 160) || "no stderr"}`,
      };
    }
    const size = statSync(target).size;
    if (size === 0) return { available: false, reason: "screencapture produced an empty image (permission not granted?)" };
    return { available: true, reason: `screencapture produced a ${size}-byte image` };
  } catch (error) {
    return { available: false, reason: `screencapture probe error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function probeAccessibility(): Promise<EnvironmentProbeResult> {
  if (process.platform !== "darwin") {
    return { available: false, reason: `accessibility probe not implemented on ${process.platform}` };
  }
  const result = await runProbe("osascript", [
    "-e",
    'tell application "System Events" to count processes',
  ]);
  if (result.code === 0) {
    return { available: true, reason: `System Events responded (${result.stdout.trim()} processes)` };
  }
  return {
    available: false,
    reason: `assistive access denied or System Events unavailable: ${(result.stderr || result.stdout).slice(0, 160)}`,
  };
}

async function probeClipboard(): Promise<EnvironmentProbeResult> {
  const command = process.platform === "darwin" ? "pbpaste" : process.platform === "linux" ? "xclip" : null;
  if (!command) {
    return { available: false, reason: `clipboard probe not implemented on ${process.platform}` };
  }
  const args = command === "xclip" ? ["-o", "-selection", "clipboard"] : [];
  const result = await runProbe(command, args);
  if (result.code === 0) return { available: true, reason: `${command} succeeded` };
  return { available: false, reason: `${command} failed (exit ${result.code ?? "signal"})` };
}

async function probeDisplayServer(): Promise<EnvironmentProbeResult> {
  if (process.platform === "darwin") {
    return { available: true, reason: "macOS WindowServer session present" };
  }
  if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY) return { available: true, reason: `Wayland display ${process.env.WAYLAND_DISPLAY}` };
    if (process.env.DISPLAY) return { available: true, reason: `X11 display ${process.env.DISPLAY}` };
    return { available: false, reason: "no DISPLAY or WAYLAND_DISPLAY in this environment" };
  }
  return { available: true, reason: `${process.platform} session` };
}

async function probeBrowser(): Promise<EnvironmentProbeResult> {
  if (process.platform === "darwin") {
    const browsers = [
      "/Applications/Safari.app",
      "/Applications/Google Chrome.app",
      "/Applications/Chromium.app",
      "/Applications/Microsoft Edge.app",
      "/Applications/Firefox.app",
    ].filter((path) => existsSync(path));
    if (browsers.length > 0) return { available: true, reason: `browser present: ${browsers[0].split("/").pop()}` };
    return { available: false, reason: "no common browser application found in /Applications" };
  }
  if (process.platform === "linux") {
    const result = await runProbe("sh", ["-c", "command -v xdg-open >/dev/null 2>&1"]);
    return result.code === 0
      ? { available: true, reason: "xdg-open available" }
      : { available: false, reason: "xdg-open not found" };
  }
  return { available: false, reason: `browser probe not implemented on ${process.platform}` };
}

/** Run every environment probe concurrently and return results by name. */
export async function probeEnvironmentCapabilities(): Promise<Record<string, EnvironmentProbeResult>> {
  const [screenshot, accessibility, clipboard, displayServer, browser] = await Promise.all([
    probeScreenshot(),
    probeAccessibility(),
    probeClipboard(),
    probeDisplayServer(),
    probeBrowser(),
  ]);
  return {
    screenshot,
    accessibility,
    clipboard,
    display_server: displayServer,
    browser,
  };
}

export function ensureCapabilityCacheDir(projectRoot: string): string {
  const dir = join(projectRoot, ".soba");
  mkdirSync(dir, { recursive: true });
  return dir;
}
