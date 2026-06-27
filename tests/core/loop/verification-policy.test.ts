import { describe, expect, test } from "bun:test";
import {
  allowsUnverifiedCompletion,
  decideVerificationPolicy,
  inferTaskKindFromPrompt,
  isCodePath,
  isDocumentationPath,
  verificationKindFromCommand,
} from "../../../src/core/loop/verification-policy";

describe("verification policy", () => {
  test("feature/refactor/bug fix require command evidence", () => {
    expect(decideVerificationPolicy("feature")).toMatchObject({
      requirement: "command",
      acceptedKinds: ["test", "lint", "typecheck", "build"],
    });
    expect(decideVerificationPolicy("refactor").requirement).toBe("command");
    expect(decideVerificationPolicy("bug_fix").acceptedKinds).toContain("test");
  });

  test("docs and review tasks require inspection evidence", () => {
    expect(decideVerificationPolicy("docs_change")).toMatchObject({
      requirement: "inspection",
      acceptedKinds: ["diff_inspection", "manual_inspection"],
    });
    expect(decideVerificationPolicy("review")).toMatchObject({
      requirement: "inspection",
      acceptedKinds: ["manual_inspection"],
    });
  });

  test("release tasks require full gate command evidence", () => {
    const decision = decideVerificationPolicy("release_task");

    expect(decision.requirement).toBe("full_gate");
    expect(decision.acceptedKinds).toEqual(["test", "lint", "typecheck", "build"]);
    expect(decision.commands).toEqual([]);
    expect(decision.reason).toContain("project verification gate");
  });

  test("command classifier maps Bun/Biome project commands to verification kinds", () => {
    expect(verificationKindFromCommand("bun test tests/parser.test.ts")).toBe("test");
    expect(verificationKindFromCommand("bun run lint")).toBe("lint");
    expect(verificationKindFromCommand("bunx tsc --noEmit")).toBe("typecheck");
    expect(verificationKindFromCommand("bun run build")).toBe("build");
    expect(verificationKindFromCommand("git diff -- docs")).toBe("diff_inspection");
  });

  test("command classifier rejects probes and output-truncated checks as verification evidence", () => {
    expect(verificationKindFromCommand("bun lint --help 2>&1 | head -20")).toBeNull();
    expect(verificationKindFromCommand("bun test 2>&1 | tail -80")).toBeNull();
    expect(verificationKindFromCommand("bun run typecheck --version")).toBeNull();
    expect(verificationKindFromCommand("which bun")).toBeNull();
    expect(verificationKindFromCommand("command -v bun")).toBeNull();
    expect(verificationKindFromCommand("man tsc")).toBeNull();
    expect(verificationKindFromCommand("cat test.log")).toBeNull();
    expect(verificationKindFromCommand("tail test.log")).toBeNull();
    expect(verificationKindFromCommand("grep test src/app.ts")).toBeNull();
    expect(verificationKindFromCommand("pwd && ls -la")).toBeNull();
  });

  test("prompt inference recognizes common task kinds", () => {
    expect(inferTaskKindFromPrompt("Почини падение тестов")).toBe("test_failure");
    expect(inferTaskKindFromPrompt("Почини lint")).toBe("lint_failure");
    expect(inferTaskKindFromPrompt("Обнови README под новую команду")).toBe("docs_change");
    expect(inferTaskKindFromPrompt("Сделай ревью изменений")).toBe("review");
    expect(inferTaskKindFromPrompt("Добавь поддержку флага --json")).toBe("feature");
  });

  test("detects explicit user permission for unverified completion", () => {
    expect(allowsUnverifiedCompletion("Сделай правку, можно без тестов")).toBe(true);
    expect(allowsUnverifiedCompletion("Implement it without verification")).toBe(true);
    expect(allowsUnverifiedCompletion("Почини и проверь")).toBe(false);
  });

  test("path classification separates docs from code mutations", () => {
    expect(isDocumentationPath("README.md")).toBe(true);
    expect(isDocumentationPath("docs/phase/plan.md")).toBe(true);
    expect(isCodePath("src/core/loop/agent-loop.ts")).toBe(true);
    expect(isCodePath("tests/core/loop/verification-policy.test.ts")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
  });
});
