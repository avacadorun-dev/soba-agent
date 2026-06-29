import { describe, expect, test } from "bun:test";
import { EvidenceLedger } from "../../../src/engine/evidence/evidence-ledger";
import { FixUntilGreenController, parseVerificationDiagnostics } from "../../../src/engine/recovery";

describe("Fix-Until-Green diagnostics", () => {
  test("parses Bun test, Biome, TypeScript and build diagnostics", () => {
    expect(parseVerificationDiagnostics("bun test", "(fail) parser > expected 1 got 2").tool).toBe("bun-test");
    expect(parseVerificationDiagnostics("bun run lint", "src/a.ts:1:2 lint/style/useConst Use const").tool).toBe(
      "biome",
    );
    expect(parseVerificationDiagnostics("bunx tsc --noEmit", "src/a.ts(2,3): error TS2322: Bad type").tool).toBe(
      "typescript",
    );
    expect(parseVerificationDiagnostics("bun run build", "Build failed with error: missing export").tool).toBe("build");
  });
});

describe("FixUntilGreenController", () => {
  test("UC-AL-05 passes: failed verification leads to fix and passing verification", () => {
    const controller = new FixUntilGreenController();

    const recover = controller.recordVerificationFailure({
      command: "bun test",
      output: "(fail) parser > expected 1 got 2",
    });
    controller.recordProgress("edit_1");
    const passed = controller.recordVerificationPassed("bun test");

    expect(recover.action).toBe("recover");
    expect(passed.status).toBe("passed");
    expect(controller.getStatus()).toBe("passed");
  });

  test("UC-AL-06 stops with typed blocker on repeated same error", () => {
    const controller = new FixUntilGreenController();
    controller.recordVerificationFailure({
      command: "bun test",
      output: "(fail) parser > expected 1 got 2",
    });

    const blocked = controller.recordVerificationFailure({
      command: "bun test",
      output: "(fail) parser > expected 1 got 2",
    });

    expect(blocked.action).toBe("stop");
    expect(blocked.status).toBe("blocked");
    if (blocked.action === "stop") expect(blocked.message).toContain("Repeated diagnostic");
  });

  test("max iterations stops without claiming success", () => {
    const controller = new FixUntilGreenController({ maxIterations: 2 });
    controller.recordVerificationFailure({ command: "bun test", output: "(fail) first" });
    controller.recordProgress("edit_1");
    controller.recordVerificationFailure({ command: "bun test", output: "(fail) second" });
    controller.recordProgress("edit_2");

    const stopped = controller.recordVerificationFailure({ command: "bun test", output: "(fail) third" });

    expect(stopped.action).toBe("stop");
    expect(stopped.status).toBe("max_iterations");
  });

  test("unsafe recovery action is not executed automatically", () => {
    const controller = new FixUntilGreenController();

    const unsafe = controller.recordVerificationFailure({
      command: "bun test",
      output: "(fail) cleanup required",
      proposedRecoveryCommand: "rm -rf src",
    });

    expect(unsafe.action).toBe("stop");
    expect(unsafe.status).toBe("unsafe");
  });

  test("iteration evidence appears in ledger", () => {
    const controller = new FixUntilGreenController();
    const ledger = new EvidenceLedger();
    const decision = controller.recordVerificationFailure({
      command: "bunx tsc --noEmit",
      output: "src/a.ts(2,3): error TS2322: Bad type",
    });

    ledger.recordRecoveryIteration(decision);

    expect(ledger.getEntries().some((entry) => entry.kind === "recovery_attempt")).toBe(true);
    expect(ledger.getEntries().at(-1)?.summary).toContain("Fix-Until-Green");
  });
});
