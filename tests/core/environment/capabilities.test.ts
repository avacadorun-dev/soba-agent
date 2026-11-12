/**
 * Tests for the capability contract and read vision guard (#11).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCapabilityReport,
  formatCapabilityReportForPrompt,
  parseCapabilityReport,
} from "../../../src/application/environment/capabilities";
import { probeEnvironmentCapabilities } from "../../../src/infrastructure/environment/capability-probes";
import { readTool } from "../../../src/infrastructure/tools/local/read";
import type { ToolContext } from "../../../src/kernel/tools/types";

let dirs: string[] = [];

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "soba-cap-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("capability report", () => {
  test("buildCapabilityReport marks vision from model metadata and includes every capability", () => {
    const withVision = buildCapabilityReport({
      model: "vision-model",
      visionSupported: true,
      probes: {
        screenshot: { available: true, reason: "screencapture ok" },
        accessibility: { available: false, reason: "assistive access denied" },
        clipboard: { available: true, reason: "pbpaste ok" },
        display_server: { available: true, reason: "WindowServer" },
        browser: { available: true, reason: "Safari present" },
      },
    });

    expect(withVision.capabilities.map((c) => c.name)).toEqual([
      "vision",
      "screenshot",
      "accessibility",
      "clipboard",
      "display_server",
      "browser",
    ]);
    const vision = withVision.capabilities.find((c) => c.name === "vision");
    expect(vision?.available).toBe(true);

    const withoutVision = buildCapabilityReport({
      model: "text-model",
      visionSupported: false,
      probes: {},
    });
    expect(withoutVision.capabilities.find((c) => c.name === "vision")?.available).toBe(false);
    expect(withoutVision.capabilities.find((c) => c.name === "vision")?.reason).toContain("visual claims are not allowed");
  });

  test("parseCapabilityReport round-trips and rejects garbage", () => {
    const report = buildCapabilityReport({
      model: "m",
      visionSupported: false,
      probes: { browser: { available: true, reason: "ok" } },
    });

    expect(parseCapabilityReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(parseCapabilityReport(null)).toBeNull();
    expect(parseCapabilityReport({ generatedAt: 1 })).toBeNull();
  });

  test("formatCapabilityReportForPrompt lists availability and reasons", () => {
    const report = buildCapabilityReport({
      model: "m",
      visionSupported: false,
      probes: { screenshot: { available: false, reason: "denied" } },
    });

    const text = formatCapabilityReportForPrompt(report);
    expect(text).toContain("vision: unavailable");
    expect(text).toContain("screenshot: unavailable (denied)");
  });
});

describe("read vision guard", () => {
  test("with vision unavailable, read returns a text stub instead of an image block", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "utf-8");

    const context: ToolContext = { cwd, visionSupported: false };
    const result = await readTool.execute({ path: "shot.png" }, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("does not declare vision");
    expect(result.content[0].text).toContain("Visual verification claims are not allowed");
    expect(result.details).toMatchObject({ visionSupported: false, stub: true });
    expect(result.details?.image).toBeUndefined();
  });

  test("with vision supported, read still forwards image bytes", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "utf-8");

    const context: ToolContext = { cwd, visionSupported: true };
    const result = await readTool.execute({ path: "shot.png" }, context);

    expect(result.isError).toBe(false);
    expect(result.details?.image).toBeDefined();
    expect(result.details?.stub).toBeUndefined();
  });

  test("an unset vision flag keeps legacy behavior (permissive)", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "utf-8");

    const context: ToolContext = { cwd };
    const result = await readTool.execute({ path: "shot.png" }, context);

    expect(result.details?.image).toBeDefined();
  });
});

describe("environment probes", () => {
  test("probeEnvironmentCapabilities returns a result for every capability with a reason", async () => {
    const probes = await probeEnvironmentCapabilities();

    for (const name of ["screenshot", "accessibility", "clipboard", "display_server", "browser"]) {
      expect(probes[name]).toBeDefined();
      expect(typeof probes[name].available).toBe("boolean");
      expect(probes[name].reason.length).toBeGreaterThan(0);
    }
  });
});
