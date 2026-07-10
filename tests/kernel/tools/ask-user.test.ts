import { describe, expect, test } from "bun:test";
import { askUserTool } from "../../../src/kernel/tools/ask-user";

const rawArgs = {
  question: "Which release channel?",
  options: [
    { id: "stable", label: "Stable" },
    { id: "rc", label: "Release candidate", description: "Test first." },
  ],
  allowOther: true,
};

describe("ask_user tool", () => {
  test("validates one concise question and stable choices", () => {
    expect(askUserTool.prepareArgs?.(rawArgs)).toEqual(rawArgs);
    expect(() => askUserTool.prepareArgs?.({ ...rawArgs, options: [{ id: "one", label: "One" }] })).toThrow();
    expect(() => askUserTool.prepareArgs?.({ ...rawArgs, options: [{ id: "same", label: "One" }, { id: "same", label: "Two" }] })).toThrow();
  });

  test("returns the selected answer to the model", async () => {
    const result = await askUserTool.execute(rawArgs, {
      cwd: "/repo",
      requestClarification: async () => ({ status: "answered", choice: "rc", other: "Ship Friday" }),
    });
    expect(result).toMatchObject({
      isError: false,
      details: { choice: "rc", other: "Ship Friday" },
    });
    expect(result.content[0]?.text).toContain("Release candidate (rc)");
  });

  test("returns an actionable error when no structured UI claims the request", async () => {
    const result = await askUserTool.execute(rawArgs, { cwd: "/repo" });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("clarification_unavailable");
  });
});
