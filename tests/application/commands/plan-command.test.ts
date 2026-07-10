import { describe, expect, test } from "bun:test";
import { executePlanCommand } from "../../../src/application/commands/plan";
import type { WorkMode } from "../../../src/kernel/work-mode/public";

describe("executePlanCommand", () => {
  test("reports current mode and applies transitions", () => {
    let mode: WorkMode = "agent";
    const controller = {
      getWorkMode: () => mode,
      setWorkMode: (next: WorkMode) => {
        mode = next;
      },
    };

    expect(executePlanCommand({ args: [], controller })).toEqual({ kind: "current", mode: "agent" });
    expect(executePlanCommand({ args: ["on"], controller })).toEqual({ kind: "changed", mode: "plan" });
    expect(controller.getWorkMode()).toBe("plan");
    expect(executePlanCommand({ args: ["toggle"], controller })).toEqual({ kind: "changed", mode: "agent" });
    expect(controller.getWorkMode()).toBe("agent");
    expect(executePlanCommand({ args: ["planning"], controller })).toEqual({ kind: "changed", mode: "plan" });
    expect(executePlanCommand({ args: ["goal"], controller })).toEqual({ kind: "changed", mode: "goal" });
    expect(executePlanCommand({ args: ["toggle"], controller })).toEqual({ kind: "changed", mode: "agent" });
    expect(executePlanCommand({ args: ["off"], controller })).toEqual({ kind: "changed", mode: "agent" });
    expect(controller.getWorkMode()).toBe("agent");
  });

  test("returns usage for invalid args and not_configured without controller", () => {
    expect(executePlanCommand({ args: ["maybe"] })).toEqual({ kind: "not_configured" });
    expect(
      executePlanCommand({
        args: ["maybe"],
        controller: {
          getWorkMode: () => "agent",
          setWorkMode: () => undefined,
        },
      }),
    ).toEqual({ kind: "usage" });
  });
});
