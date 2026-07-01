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
      memory: memorySource({ doctor: () => report({ status: "healthy" }) }),
    });

    expect(view.kind).toBe("doctor");
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
      memory: memorySource({ doctor: () => report({ status: "stale" }) }),
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
      memory: memorySource({ doctor: () => report({ status: "healthy" }) }),
    });
    const invalid = executeMemoryCommand({
      args: ["status"],
      memory: memorySource({ doctor: () => report({ status: "healthy" }) }),
    });

    expect(memoryCommandExitCode(missing)).toBe(1);
    expect(renderMemoryCommandView(missing)).toContain("soba memory doctor");
    expect(renderMemoryCommandView(invalid)).toContain('Unknown memory subcommand "status"');
  });

  test("rejects explain-only flags on doctor and malformed limits", () => {
    const doctorLimit = executeMemoryCommand({
      args: ["doctor", "--limit", "3"],
      memory: memorySource(),
    });
    const malformedLimit = executeMemoryCommand({
      args: ["explain", "provider", "--limit=2abc"],
      memory: memorySource(),
    });

    expect(memoryCommandExitCode(doctorLimit)).toBe(1);
    expect(renderMemoryCommandView(doctorLimit)).toContain("Memory doctor does not support --limit.");
    expect(memoryCommandExitCode(malformedLimit)).toBe(1);
    expect(renderMemoryCommandView(malformedLimit)).toContain('Invalid --limit value "2abc".');
  });

  test("reports memory backend errors", () => {
    const view = executeMemoryCommand({
      args: ["doctor"],
      memory: memorySource({
        doctor: () => {
          throw new Error("disk unavailable");
        },
      }),
    });

    expect(memoryCommandExitCode(view)).toBe(1);
    expect(renderMemoryCommandView(view)).toBe("Memory command error: disk unavailable");
  });

  test("explains relevant memory with source receipts", () => {
    const view = executeMemoryCommand({
      args: ["explain", "provider", "registry", "--format=json"],
      memory: memorySource({
        doctor: () => report({ status: "healthy" }),
        getRelevantCapsules: () => [
          {
            score: 17,
            capsule: {
              id: "cap-1",
              type: "decision",
              summary: "Provider registry is loaded before runtime composition.",
              detail: "Durable source-backed fact.",
              context: {
                task: "task",
                sessionId: "session",
                timestamp: "2026-06-19T10:00:00.000Z",
              },
              priority: "high",
              tags: ["provider", "registry"],
              related: [],
            },
          },
        ],
      }),
    });

    expect(memoryCommandExitCode(view)).toBe(0);
    expect(JSON.parse(renderMemoryCommandView(view))).toMatchObject({
      query: "provider registry",
      safeToUse: true,
      matches: [
        {
          id: "cap-1",
          score: 17,
          sourceState: "fresh",
          source: {
            sourcePath: "src/app.ts",
            sourceLines: [1, 3],
            sourceCommit: "abc123",
            sourceConfidence: "high",
          },
          issues: [],
        },
      ],
    });
  });

  test("explaining stale memory returns non-zero with issue context", () => {
    const view = executeMemoryCommand({
      args: ["explain", "provider"],
      memory: memorySource({
        doctor: () => report({ status: "stale" }),
        getRelevantCapsules: () => [
          {
            score: 10,
            capsule: {
              id: "cap-1",
              type: "decision",
              summary: "Provider registry is loaded before runtime composition.",
              detail: "Durable source-backed fact.",
              context: {
                task: "task",
                sessionId: "session",
                timestamp: "2026-06-19T10:00:00.000Z",
              },
              priority: "high",
              tags: ["provider"],
              related: [],
            },
          },
        ],
      }),
    });

    expect(memoryCommandExitCode(view)).toBe(1);
    const rendered = renderMemoryCommandView(view);
    expect(rendered).toContain("SOBA Memory Explanation");
    expect(rendered).toContain("Safe to use: no");
    expect(rendered).toContain("capsule_source_newer");
  });

  test("explaining unmatched memory returns non-zero", () => {
    const view = executeMemoryCommand({
      args: ["explain", "missing"],
      memory: memorySource({
        doctor: () => report({ status: "healthy" }),
        getRelevantCapsules: () => [],
      }),
    });

    expect(memoryCommandExitCode(view)).toBe(1);
    expect(renderMemoryCommandView(view)).toContain("No matching memory capsules found.");
  });
});

function memorySource(overrides: {
  doctor?: () => MemoryDoctorReport;
  getRelevantCapsules?: Parameters<typeof executeMemoryCommand>[0]["memory"]["getRelevantCapsules"];
} = {}): Parameters<typeof executeMemoryCommand>[0]["memory"] {
  return {
    doctor: overrides.doctor ?? (() => report({ status: "healthy" })),
    getRelevantCapsules: overrides.getRelevantCapsules ?? (() => []),
    getMemoryDir: () => "/repo/.soba/memory",
  };
}

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
        sourceLines: [1, 3],
        sourceCommit: "abc123",
        sourceConfidence: "high",
        lastVerified: "2026-06-19T10:00:00.000Z",
        staleIfFilesChange: ["src/app.ts"],
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
