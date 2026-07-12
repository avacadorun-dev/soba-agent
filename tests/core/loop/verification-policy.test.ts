import { describe, expect, test } from "bun:test";
import {
  allowsUnverifiedCompletion,
  decideVerificationPolicy,
  decideVerificationPolicyForContext,
  inferTaskKindFromPrompt,
  isCodePath,
  isDocumentationPath,
  verificationKindFromCommand,
} from "../../../src/engine/verification/verification-policy";

describe("verification policy", () => {
  test("feature/refactor/bug fix require command evidence", () => {
    expect(decideVerificationPolicy("feature")).toMatchObject({
      requirement: "command",
      acceptedKinds: ["test", "lint", "typecheck", "build", "run"],
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
    expect(decision.acceptedKinds).toEqual(["test", "lint", "typecheck", "build", "run"]);
    expect(decision.commands).toEqual([]);
    expect(decision.reason).toContain("project verification gate");
  });

  test("policy context derives docs-only verification from mutation shape", () => {
    expect(
      decideVerificationPolicyForContext({
        taskKind: "feature",
        hasDocsMutations: true,
        hasCodeMutations: false,
      }),
    ).toMatchObject({
      requirement: "inspection",
      acceptedKinds: ["diff_inspection", "manual_inspection"],
    });
    expect(
      decideVerificationPolicyForContext({
        taskKind: "feature",
        hasDocsMutations: true,
        hasCodeMutations: false,
        forceFullGate: true,
      }).requirement,
    ).toBe("full_gate");
  });

  test("command classifier maps Bun/Biome project commands to verification kinds", () => {
    expect(verificationKindFromCommand("bun test tests/parser.test.ts")).toBe("test");
    expect(verificationKindFromCommand("uv run pytest -v 2>&1")).toBe("test");
    expect(
      verificationKindFromCommand(
        "cd /Users/avacado/Projects/ai-projects/tests-soba/fastapi-users && uv run pytest -v 2>&1",
      ),
    ).toBe("test");
    expect(verificationKindFromCommand("bun run lint")).toBe("lint");
    expect(verificationKindFromCommand("uv run ruff check . 2>&1")).toBe("lint");
    expect(verificationKindFromCommand("uv run ruff format --check . 2>&1")).toBe("lint");
    expect(verificationKindFromCommand("bunx tsc --noEmit")).toBe("typecheck");
    expect(verificationKindFromCommand("bun run build")).toBe("build");
    expect(verificationKindFromCommand("zig build test")).toBe("test");
    expect(verificationKindFromCommand("make verify")).toBe("run");
    expect(verificationKindFromCommand("./ci/verify-users")).toBe("run");
    expect(verificationKindFromCommand("git diff -- docs")).toBe("diff_inspection");
  });

  test("command classifier rejects probes and output-truncated checks as verification evidence", () => {
    expect(verificationKindFromCommand("bun lint --help 2>&1 | head -20")).toBeNull();
    expect(verificationKindFromCommand("bun test 2>&1 | tail -80")).toBeNull();
    expect(verificationKindFromCommand("bun run typecheck 2>&1 | tee /tmp/typecheck.txt")).toBeNull();
    expect(
      verificationKindFromCommand(
        'bun run lint 2>&1 | tee /tmp/lint.txt; echo "---lint exit: ${PIPESTATUS[0]}"',
      ),
    ).toBeNull();
    expect(verificationKindFromCommand('bun test; echo "---test exit: $?"')).toBeNull();
    expect(verificationKindFromCommand("bun run format")).toBeNull();
    expect(verificationKindFromCommand("biome check --write .")).toBeNull();
    expect(verificationKindFromCommand("prettier --write src/**/*.ts")).toBeNull();
    expect(verificationKindFromCommand("ruff format .")).toBeNull();
    expect(verificationKindFromCommand("bun run typecheck --version")).toBeNull();
    expect(verificationKindFromCommand("node -v")).toBeNull();
    expect(verificationKindFromCommand("ruff -v")).toBeNull();
    expect(verificationKindFromCommand("which bun")).toBeNull();
    expect(verificationKindFromCommand("command -v bun")).toBeNull();
    expect(verificationKindFromCommand("man tsc")).toBeNull();
    expect(verificationKindFromCommand("cat test.log")).toBeNull();
    expect(verificationKindFromCommand("tail test.log")).toBeNull();
    expect(verificationKindFromCommand("grep test src/app.ts")).toBeNull();
    expect(verificationKindFromCommand("pwd && ls -la")).toBeNull();
    expect(verificationKindFromCommand("echo ok")).toBeNull();
    expect(verificationKindFromCommand("chi")).toBeNull();
    expect(
      verificationKindFromCommand(
        ". ├── main.go # app entry └── handlers/ └── handlers_test.go # end-to-end tests",
      ),
    ).toBeNull();
    expect(verificationKindFromCommand("npm install")).toBeNull();
    expect(verificationKindFromCommand("uv add fastapi")).toBeNull();
  });

  test("prompt inference recognizes common task kinds", () => {
    expect(inferTaskKindFromPrompt("Почини падение тестов")).toBe("test_failure");
    expect(inferTaskKindFromPrompt("Почини lint")).toBe("lint_failure");
    expect(inferTaskKindFromPrompt("Обнови README под новую команду")).toBe("docs_change");
    expect(inferTaskKindFromPrompt("Сделай ревью изменений")).toBe("review");
    expect(inferTaskKindFromPrompt("Добавь поддержку флага --json")).toBe("feature");
    expect(inferTaskKindFromPrompt("Создай с нуля TypeScript/Bun CLI-проект NoteVault с README")).toBe("feature");
    expect(inferTaskKindFromPrompt("修复失败的测试")).toBe("test_failure");
    expect(inferTaskKindFromPrompt("更新项目文档")).toBe("docs_change");
    expect(inferTaskKindFromPrompt("Repariere den Fehler", { bug_fix: ["repariere", "fehler"] })).toBe("bug_fix");
    expect(
      inferTaskKindFromPrompt(
        "Создай с нуля TypeScript/Bun CLI-проект NoteVault. Написать тесты. Добавить package scripts: test, typecheck, lint если линтер уместен.",
      ),
    ).toBe("feature");
  });

  test("detects explicit user permission for unverified completion", () => {
    expect(allowsUnverifiedCompletion("Сделай правку, можно без тестов")).toBe(true);
    expect(allowsUnverifiedCompletion("Implement it without verification")).toBe(true);
    expect(allowsUnverifiedCompletion("可以跳过验证")).toBe(true);
    expect(allowsUnverifiedCompletion("Implementiere ohne Prüfung", ["ohne prüfung"])).toBe(true);
    expect(allowsUnverifiedCompletion("Почини и проверь")).toBe(false);
  });

  test("path classification separates docs from code mutations", () => {
    expect(isDocumentationPath("README.md")).toBe(true);
    expect(isDocumentationPath("docs/phase/plan.md")).toBe(true);
    expect(isCodePath("../../../src/engine/turn/agent-loop")).toBe(true);
    expect(isCodePath("tests/core/loop/verification-policy.test.ts")).toBe(true);
    expect(isCodePath("src/main.zig")).toBe(true);
    expect(isCodePath("legacy/PAYROLL.COB")).toBe(true);
    expect(isCodePath("desktop/MainForm.pas")).toBe(true);
    expect(isCodePath("Makefile")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
  });
});
