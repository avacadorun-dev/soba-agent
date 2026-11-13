/**
 * process tool lifecycle tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processTool } from "../../src/infrastructure/tools/local/process";
import type { ToolContext } from "../../src/kernel/tools/types";

let dirs: string[] = [];

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "soba-process-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

function context(cwd: string, sessionId = "test-session"): ToolContext {
  return { cwd, sessionId };
}

function jobIdOf(result: Awaited<ReturnType<typeof processTool.execute>>): string {
  const job = result.details?.job as { jobId: string };
  return job.jobId;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("process tool", () => {
  test("start returns a stable job id and status/logs are readable while running", async () => {
    const cwd = await makeCwd();
    const start = await processTool.execute(
      { action: "start", command: "printf 'hello\\n'; sleep 5" },
      context(cwd),
    );

    expect(start.isError).toBe(false);
    const jobId = jobIdOf(start);
    expect(jobId).toMatch(/^pj_/);

    const status = await processTool.execute({ action: "status", jobId }, context(cwd));
    expect(status.isError).toBe(false);
    expect(status.content[0].text).toContain("running");

    await sleep(300);
    const logs = await processTool.execute({ action: "logs", jobId }, context(cwd));
    expect(logs.isError).toBe(false);
    expect(logs.content[0].text).toContain("hello");

    const stop = await processTool.execute({ action: "stop", jobId }, context(cwd));
    expect(stop.isError).toBe(false);
    expect(stop.content[0].text).toContain("SIGTERM");

    await sleep(300);
    const afterStop = await processTool.execute({ action: "status", jobId }, context(cwd));
    expect(afterStop.content[0].text).toContain("exited");
  });

  test("stopping a job leaves no orphan process", async () => {
    const cwd = await makeCwd();
    const start = await processTool.execute(
      { action: "start", command: "sleep 60" },
      context(cwd),
    );
    const jobId = jobIdOf(start);
    const pid = (start.details?.job as { pid?: number }).pid;
    expect(pid).toBeGreaterThan(0);

    await processTool.execute({ action: "stop", jobId }, context(cwd));
    await sleep(700);

    const check = await Bun.spawn(["kill", "-0", String(pid)]).exited;
    expect(check).not.toBe(0);
  });

  test("a job that exits on its own reports exit code and timing", async () => {
    const cwd = await makeCwd();
    const start = await processTool.execute(
      { action: "start", command: "exit 3" },
      context(cwd),
    );
    const jobId = jobIdOf(start);

    await sleep(400);
    const status = await processTool.execute({ action: "status", jobId }, context(cwd));
    expect(status.content[0].text).toContain("exited");
    expect(status.content[0].text).toContain("exitCode: 3");
  });

  test("logs are bounded and redacted like bash", async () => {
    const cwd = await makeCwd();
    const start = await processTool.execute(
      { action: "start", command: "printf 'api_key=secret-value\\n'; seq 1 100; sleep 3" },
      context(cwd),
    );
    const jobId = jobIdOf(start);
    await sleep(400);

    const full = await processTool.execute({ action: "logs", jobId, tailLines: 200 }, context(cwd));
    expect(full.isError).toBe(false);
    expect(full.content[0].text).toContain("api_key=[REDACTED]");
    expect(full.content[0].text).not.toContain("secret-value");

    const bounded = await processTool.execute({ action: "logs", jobId, tailLines: 5 }, context(cwd));
    expect(bounded.content[0].text).toContain("100");
    expect(bounded.content[0].text).not.toContain("api_key=");

    await processTool.execute({ action: "stop", jobId }, context(cwd));
  });

  test("list shows session jobs sorted by start time", async () => {
    const cwd = await makeCwd();
    const first = await processTool.execute({ action: "start", command: "sleep 5" }, context(cwd));
    const second = await processTool.execute({ action: "start", command: "sleep 5" }, context(cwd));

    const list = await processTool.execute({ action: "list" }, context(cwd));
    expect(list.isError).toBe(false);
    const jobs = list.details?.jobs as { jobId: string }[];
    const ids = jobs.map((job) => job.jobId);
    expect(ids.indexOf(jobIdOf(first))).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(jobIdOf(second))).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(jobIdOf(first))).toBeLessThan(ids.indexOf(jobIdOf(second)));

    await processTool.execute({ action: "stop", jobId: jobIdOf(first) }, context(cwd));
    await processTool.execute({ action: "stop", jobId: jobIdOf(second) }, context(cwd));
  });

  test("start validation: missing command, cwd outside project, unknown job", async () => {
    const cwd = await makeCwd();

    const missing = await processTool.execute({ action: "start" }, context(cwd));
    expect(missing.isError).toBe(true);
    expect(missing.error?.code).toBe("process_missing_command");

    const outside = await processTool.execute(
      { action: "start", command: "echo hi", cwd: "../../.." },
      context(cwd),
    );
    expect(outside.isError).toBe(true);
    expect(outside.error?.code).toBe("process_cwd_outside_project");

    const unknown = await processTool.execute({ action: "status", jobId: "pj_nope" }, context(cwd));
    expect(unknown.isError).toBe(true);
    expect(unknown.error?.code).toBe("process_unknown_job");
  });

  test("custom logPath persists complete output inside the project", async () => {
    const cwd = await makeCwd();
    const start = await processTool.execute(
      { action: "start", command: "printf 'logged\\n'", logPath: "out/custom.log" },
      context(cwd),
    );
    expect(start.isError).toBe(false);
    await sleep(400);

    expect(await readFile(join(cwd, "out", "custom.log"), "utf-8")).toContain("logged");
  });
});
