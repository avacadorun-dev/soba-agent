import { describe, expect, test } from "bun:test";
import { buildEvidenceDiffSummary } from "../../../src/engine/evidence";

describe("Evidence diff summary builder", () => {
  test("summarizes created files", () => {
    const summary = buildEvidenceDiffSummary({
      files: [
        {
          path: "src/new.ts",
          operation: "created",
          newText: "export const value = 1;\n",
          mutationIds: ["ev_mutation_write_1"],
        },
      ],
    });

    expect(summary).toMatchObject({
      fileCount: 1,
      added: 1,
      removed: 0,
      truncated: false,
    });
    expect(summary.files[0]).toEqual({
      path: "src/new.ts",
      operation: "created",
      added: 1,
      removed: 0,
      mutationIds: ["ev_mutation_write_1"],
      inlineDiff: "+export const value = 1;",
      truncated: false,
    });
  });

  test("summarizes modified files", () => {
    const summary = buildEvidenceDiffSummary({
      files: [
        {
          path: "src/app.ts",
          operation: "modified",
          oldText: "const value = 1;\n",
          newText: "const value = 2;\n",
          mutationIds: ["ev_mutation_edit_1"],
        },
      ],
    });

    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.files[0]?.inlineDiff).toBe("-const value = 1;\n+const value = 2;");
  });

  test("summarizes deleted files", () => {
    const summary = buildEvidenceDiffSummary({
      files: [
        {
          path: "src/old.ts",
          operation: "deleted",
          oldText: "old\nfile\n",
          mutationIds: ["ev_mutation_shell_1"],
        },
      ],
    });

    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(2);
    expect(summary.files[0]?.inlineDiff).toBe("-old\n-file");
  });

  test("summarizes renamed files without synthetic text diff", () => {
    const summary = buildEvidenceDiffSummary({
      files: [
        {
          oldPath: "src/old-name.ts",
          path: "src/new-name.ts",
          operation: "renamed",
          added: 0,
          removed: 0,
          mutationIds: ["ev_mutation_shell_1"],
        },
      ],
    });

    expect(summary.files[0]).toEqual({
      oldPath: "src/old-name.ts",
      path: "src/new-name.ts",
      operation: "renamed",
      added: 0,
      removed: 0,
      mutationIds: ["ev_mutation_shell_1"],
      inlineDiff: undefined,
      truncated: false,
    });
  });

  test("truncates large inline diffs", () => {
    const summary = buildEvidenceDiffSummary({
      maxInlineDiffChars: 200,
      files: [
        {
          path: "big.txt",
          operation: "created",
          newText: `${"x".repeat(500)}\n`,
        },
      ],
    });

    expect(summary.truncated).toBe(true);
    expect(summary.files[0]?.truncated).toBe(true);
    expect(summary.files[0]?.inlineDiff).toContain("[Diff truncated]");
  });
});
