import { describe, expect, test } from "bun:test";
import {
  executeMemoryCommand,
  memoryCommandExitCode,
  renderMemoryCommandView,
} from "../../src/application/commands/memory";
import type { MemoryDoctorReport } from "../../src/kernel/memory/types";

describe("memory command", () => {
  test("renders a healthy memory doctor report as text", () => {
    const view = executeMemoryCommand({
      args: ["doctor"],
      memory: {
        doctor: () => report({ status: "healthy" }),
        getMemoryDir: () => "/repo/.soba/memory",
      },
    });

    expect(view.kind).toBe("report");
    expect(memoryCommandExitCode(view)).toBe(0);
    const rendered = renderMemoryCommandView(view);
    expect(rendered).toContain("SOBA Memory Doctor");
    expect(rendered).toContain("Status: healthy");
    expect(rendered).toContain("Capsules: total=1 fresh=1 stale=0 broken=0 untracked=0");
    expect(rendered).toContain("Issue details: none");
  });

  test("renders stale reports as json and exits non-zero", () => {
    const view = executeMemoryCommand({
      args: ["doctor", "--format=json"],
      memory: {
        doctor: () => report({ status: "stale" }),
        getMemoryDir: () => "/repo/.soba/memory",
      },
    });

    expect(memoryCommandExitCode(view)).toBe(1);
    expect(JSON.parse(renderMemoryCommandView(view))).toMatchObject({
      status: "stale",
      summary: {
        staleCapsules: 1,
        issues: 1,
      },
      issues: [
        {
          code: "capsule_source_newer",
          severity: "warning",
        },
      ],
    });
  });

  test("rejects missing or invalid subcommands", () => {
    const missing = executeMemoryCommand({
      args: [],
      memory: {
        doctor: () => report({ status: "healthy" }),
        getMemoryDir: () => "/repo/.soba/memory",
      },
    });
    const invalid = executeMemoryCommand({
      args: ["status"],
      memory: {
        doctor: () => report({ status: "healthy" }),
        getMemoryDir: () => "/repo/.soba/memory",
      },
    });

    expect(memoryCommandExitCode(missing)).toBe(1);
    expect(renderMemoryCommandView(missing)).toContain("Usage: soba memory doctor");
    expect(renderMemoryCommandView(invalid)).toContain('Unknown memory subcommand "status"');
  });

  test("reports memory backend errors", () => {
    const view = executeMemoryCommand({
      args: ["doctor"],
      memory: {
        doctor: () => {
          throw new Error("disk unavailable");
        },
        getMemoryDir: () => "/repo/.soba/memory",
      },
    });

    expect(memoryCommandExitCode(view)).toBe(1);
    expect(renderMemoryCommandView(view)).toBe("Memory doctor error: disk unavailable");
  });
});

function report(overrides: Partial<MemoryDoctorReport> = {}): MemoryDoctorReport {
  const status = overrides.status ?? "healthy";
  const stale = status === "stale" ? 1 : 0;
  return {
    status,
    generatedAt: "2026-06-19T10:00:00.000Z",
    memoryDir: "/repo/.soba/memory",
    summary: {
      knowledgeFiles: 4,
      knowledgeTokens: 12,
      capsules: 1,
      freshCapsules: status === "healthy" ? 1 : 0,
      staleCapsules: stale,
      brokenCapsules: status === "broken" ? 1 : 0,
      untrackedCapsules: 0,
      issues: stale,
      ...overrides.summary,
    },
    knowledge: [],
    capsules: [
      {
        id: "cap-1",
        type: "decision",
        priority: "high",
        timestamp: "2026-06-19T10:00:00.000Z",
        sourceState: status === "healthy" ? "fresh" : "stale",
        sourcePath: "src/app.ts",
      },
    ],
    issues: stale > 0
      ? [
          {
            code: "capsule_source_newer",
            severity: "warning",
            target: { kind: "capsule", id: "cap-1" },
            message: "Memory capsule cap-1 may be stale because its source file changed after the capsule was recorded.",
            path: "src/app.ts",
          },
        ]
      : [],
    ...overrides,
  };
}
