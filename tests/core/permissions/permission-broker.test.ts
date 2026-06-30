import { describe, expect, test } from "bun:test";
import { TrustManager } from "../../../src/application/trust/trust-manager";
import {
  createDangerousConfirmationAdapter,
  PermissionBroker,
  type PermissionRequest,
} from "../../../src/engine/permissions/permission-broker";
import type { FunctionCallField } from "../../../src/kernel/model/openresponses-types";

function toolCall(name: string, args: string): Pick<FunctionCallField, "call_id" | "name" | "arguments"> {
  return {
    call_id: `call_${name}`,
    name,
    arguments: args,
  };
}

describe("PermissionBroker", () => {
  test("allows safe operations without requesting permission", async () => {
    let requested = false;
    const broker = new PermissionBroker({
      trustManager: new TrustManager({ repoRoot: "/repo" }),
      requestPermission: async () => {
        requested = true;
        return "deny";
      },
    });

    const result = await broker.authorizeToolCall(toolCall("bash", '{"command":"git status"}'), {
      command: "git status",
    });

    expect(result.approved).toBe(true);
    expect(result.decision).toBe("auto");
    expect(result.receipt).toMatchObject({
      toolCallId: "call_bash",
      toolName: "bash",
      decision: "auto",
      approved: true,
      trustLevel: "safe",
      approvalKind: "command",
      approvalValue: "git status",
      description: "bash: git status",
    });
    expect(requested).toBe(false);
  });

  test("denies dangerous operations when no adapter is active", async () => {
    const broker = new PermissionBroker({
      trustManager: new TrustManager({ repoRoot: "/repo" }),
    });

    const result = await broker.authorizeToolCall(toolCall("bash", '{"command":"rm -rf node_modules"}'), {
      command: "rm -rf node_modules",
    });

    expect(result).toMatchObject({
      approved: false,
      decision: "deny",
      description: "bash: rm -rf node_modules",
      reason: '"rm -rf node_modules" may cause data loss or security risk',
      receipt: {
        toolCallId: "call_bash",
        toolName: "bash",
        decision: "deny",
        approved: false,
        trustLevel: "dangerous",
        approvalKind: "command",
        approvalValue: "rm -rf node_modules",
        description: "bash: rm -rf node_modules",
        reason: '"rm -rf node_modules" may cause data loss or security risk',
      },
    });
  });

  test("redacts sensitive non-bash arguments in permission receipts", async () => {
    const broker = new PermissionBroker({
      trustManager: new TrustManager({ repoRoot: "/repo" }),
    });

    const result = await broker.authorizeToolCall(toolCall("deploy", '{"apiKey":"sk-secret","input":"x"}'), {
      apiKey: "sk-secret",
      input: "x",
    });

    expect(result.approved).toBe(true);
    expect(result.receipt.description).toContain('"apiKey":"[REDACTED]"');
    expect(result.receipt.description).toContain('"input":"x"');
    expect(result.receipt.description).not.toContain("sk-secret");
  });

  test("session approval skips the same dangerous command later in the session", async () => {
    let requests = 0;
    const trustManager = new TrustManager({ repoRoot: "/repo" });
    const broker = new PermissionBroker({
      trustManager,
      requestPermission: async () => {
        requests += 1;
        return "session";
      },
    });
    const call = toolCall("bash", '{"command":"rm -rf node_modules"}');
    const args = { command: "rm -rf node_modules" };

    const first = await broker.authorizeToolCall(call, args);
    const second = await broker.authorizeToolCall(call, args);

    expect(first).toMatchObject({
      approved: true,
      decision: "session",
      receipt: {
        decision: "session",
        approved: true,
        trustLevel: "dangerous",
        approvalKind: "command",
        approvalValue: "rm -rf node_modules",
      },
    });
    expect(second).toMatchObject({
      approved: true,
      decision: "auto",
      receipt: {
        decision: "auto",
        approved: true,
        trustLevel: "dangerous",
        approvalKind: "command",
        approvalValue: "rm -rf node_modules",
      },
    });
    expect(requests).toBe(1);
  });

  test("repo and full decisions update permission mode", async () => {
    const trustManager = new TrustManager({ repoRoot: "/repo" });
    const decisions: Array<"repo" | "full"> = ["repo", "full"];
    const broker = new PermissionBroker({
      trustManager,
      requestPermission: async () => decisions.shift() ?? "deny",
    });

    await broker.authorizeToolCall(toolCall("bash", '{"command":"rm -rf ./build"}'), {
      command: "rm -rf ./build",
    });
    expect(trustManager.getPermissionMode()).toBe("repo");

    trustManager.setPermissionMode("ask");
    await broker.authorizeToolCall(toolCall("bash", '{"command":"curl https://example.com"}'), {
      command: "curl https://example.com",
    });
    expect(trustManager.getPermissionMode()).toBe("full");
  });

  test("dangerous confirmation adapter dispatches legacy agent event", async () => {
    const requestsSeen: PermissionRequest[] = [];
    const adapter = createDangerousConfirmationAdapter({
      hasListeners: () => true,
      dispatch: (event) => {
        requestsSeen.push({
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          description: event.description,
          reason: event.reason,
          level: event.level,
          trustLevel: "dangerous",
          approvalKind: "command",
          approvalValue: "rm -rf node_modules",
        });
        event.resolve("once");
      },
    });

    const decision = await adapter({
      toolName: "bash",
      toolCallId: "call_1",
      description: "bash: rm -rf node_modules",
      reason: "dangerous",
      level: "dangerous",
      trustLevel: "dangerous",
      approvalKind: "command",
      approvalValue: "rm -rf node_modules",
    });

    expect(decision).toBe("once");
    expect(requestsSeen[0]?.toolName).toBe("bash");
    expect(requestsSeen[0]?.toolCallId).toBe("call_1");
  });

  test("dangerous confirmation adapter denies when no listeners are active", async () => {
    const adapter = createDangerousConfirmationAdapter({
      hasListeners: () => false,
      dispatch: () => {
        throw new Error("should not dispatch");
      },
    });

    const decision = await adapter({
      toolName: "bash",
      toolCallId: "call_1",
      description: "bash: rm -rf node_modules",
      reason: "dangerous",
      level: "dangerous",
      trustLevel: "dangerous",
      approvalKind: "command",
      approvalValue: "rm -rf node_modules",
    });

    expect(decision).toBe("deny");
  });
});
