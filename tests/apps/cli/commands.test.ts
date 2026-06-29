import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../../src/application/config/types";
import type { SkillManager } from "../../../src/application/skills/skill-manager";
import { TrustManager } from "../../../src/application/trust/trust-manager";
import { type CommandContext, executeCommand } from "../../../src/apps/cli/commands";
import type { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { McpClientManagerStatus, McpManagedServerStatus, McpRemoteAuthCommandResult } from "../../../src/infrastructure/mcp/client-manager";
import { McpSecretStore } from "../../../src/infrastructure/mcp/secret-store";
import { type McpServerSecurity, redactMcpSensitiveText } from "../../../src/infrastructure/mcp/security";
import { createFilesystemPortableCapsuleService } from "../../../src/infrastructure/persistence/capsules/portable-capsule-storage";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { createFilesystemProjectTrustStore } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import type { ContextCapsuleEntry } from "../../../src/kernel/transcript/types-v2";
import { I18n } from "../../../src/shared/i18n/i18n";

describe("slash commands", () => {
  function appendCapsuleCheckpoint(session: SessionManager, checkpointId = "ck_111111111111"): void {
    session.appendContextCapsule({
      checkpointId,
      trigger: "user_request",
      strategy: "deterministic",
      quality: "portable",
      portableState: {
        goal: `Export checkpoint ${checkpointId}`,
        constraints: ["Bun only"],
        completed: ["Implemented capsule command"],
        inProgress: ["Testing CLI integration"],
        pending: ["Run gates"],
        decisions: [{ decision: "Loaded capsules are untrusted" }],
        blockers: [],
        nextSteps: ["Run capsule command tests"],
      },
      artifacts: {
        readFiles: ["src/apps/cli/commands.ts"],
        modifiedFiles: ["src/apps/cli/commands.ts"],
        verificationCommands: ["bun test tests/commands.test.ts"],
        verificationStatus: "passed",
      },
      activatedSkills: [],
      provenance: {
        firstCompactedEntryId: "root",
        firstKeptEntryId: "root",
        sourceEntryIds: [],
      },
      metrics: {
        effectiveTokensBefore: 10_000,
        estimatedTokensAfter: 1_000,
        reclaimedTokens: 9_000,
        savingsRatio: 0.9,
        generationDurationMs: 5,
      },
    } satisfies Omit<ContextCapsuleEntry, "id" | "parentId" | "timestamp" | "type">);
  }

  function makeCommandContext(
    session: SessionManager,
    output: Array<{ type: string; message?: string }>,
  ): CommandContext {
    return {
      session,
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      portableCapsuleServiceFactory: createFilesystemPortableCapsuleService,
      redactMcpSensitiveText,
    } as unknown as CommandContext;
  }

  test("/session различает effective context и полную историю после compaction", async () => {
    const session = SessionManager.inMemory(process.cwd());
    session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "old ".repeat(200) }],
    });
    session.appendItem({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "answer ".repeat(200) }],
    });
    const keptId = session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "latest" }],
    });
    session.appendCompaction("compact-response", { type: "compaction", encrypted_content: "summary" }, keptId, 300);

    const output: Array<{ type: string; message?: string }> = [];
    const context = {
      session,
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
    } as unknown as CommandContext;

    await executeCommand("/session", context);

    const message = output[0]?.message ?? "";
    const effective = Number(message.match(/Effective context tokens: (\d+)/)?.[1]);
    const historical = Number(message.match(/Historical tokens: (\d+)/)?.[1]);
    expect(effective).toBeLessThan(historical);
  });

  test("/session и /budget локализуются на русском и китайском", async () => {
    for (const [locale, expected] of [
      ["ru", "Сессия:"],
      ["zh", "会话:"],
    ] as const) {
      const output: Array<{ type: string; message?: string }> = [];
      const context = {
        session: SessionManager.inMemory(process.cwd()),
        config: { ...DEFAULT_CONFIG },
        i18n: new I18n(locale),
        renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      } as unknown as CommandContext;

      await executeCommand("/session", context);
      await executeCommand("/budget", context);

      expect(output[0]?.message).toContain(expected);
      expect(output[1]?.message).not.toContain("Tokens used:");
    }
  });

  test("/lang меняет язык до формирования события", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const i18n = new I18n("en");
    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n,
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
    } as unknown as CommandContext;

    await executeCommand("/lang ru", context);

    expect(i18n.getLocale()).toBe("ru");
    expect(output[0]).toMatchObject({ type: "language_changed", message: "Язык изменён на: ru" });
  });

  test("/auto-compact меняет policy и AgentLoop override", async () => {
    let policyAuto = true;
    let loopAuto: boolean | undefined;
    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG, compaction: { auto: true } },
      i18n: new I18n("en"),
      renderer: { emit: () => {} },
      contextManager: {
        getPolicy: () => ({
          getConfig: () => ({ auto: policyAuto }),
          setAuto: (enabled: boolean) => {
            policyAuto = enabled;
          },
        }),
      },
      agentLoop: {
        setAutoCompactOverride: ({ enabled }: { enabled: boolean }) => {
          loopAuto = enabled;
        },
        getAutoCompactOverride: () => (loopAuto === undefined ? undefined : { enabled: loopAuto }),
      } as unknown as AgentLoop,
    } as unknown as CommandContext;

    await executeCommand("/auto-compact off", context);

    expect(policyAuto).toBe(false);
    expect(loopAuto).toBe(false);
  });

  test("/compact emits skipped event when manual compaction has no reclaimable context", async () => {
    const session = SessionManager.inMemory(process.cwd());
    session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "short context" }],
    });
    const output: Array<{ type: string; message?: string; reason?: string }> = [];
    const context = {
      ...makeCommandContext(session, output),
      contextManager: {
        manualCompact: async () => ({
          compacted: false,
          reason: "No reclaimable context (estimatedTokensAfter >= effectiveTokensBefore)",
          metrics: {
            effectiveTokensBefore: 42,
            estimatedTokensAfter: 42,
          },
        }),
      },
    } as unknown as CommandContext;

    await executeCommand("/compact", context);

    expect(output.map((event) => event.type)).toEqual(["info", "compaction_start", "info", "compaction_skipped"]);
    expect(output[2]?.message).toContain("Manual compaction skipped");
    expect(output[3]).toMatchObject({
      type: "compaction_skipped",
      reason: "No reclaimable context (estimatedTokensAfter >= effectiveTokensBefore)",
    });
  });

  test("/skill:<name> возвращает обычный user prompt после активации", async () => {
    const session = SessionManager.inMemory(process.cwd());
    const result = await executeCommand("/skill:commit-message Проверь staged diff", {
      session,
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: () => {} },
      skillManager: {
        activate: () => ({ success: true }),
        getSkill: () => ({
          name: "commit-message",
          scope: "bundled",
          revision: "rev-1",
          contentHash: "hash-1",
        }),
      } as unknown as SkillManager,
    } as unknown as CommandContext);

    expect(result).toEqual({ handled: false, prompt: "Проверь staged diff" });
    expect(session.getActiveSkillRefs()).toHaveLength(1);
  });

  test("/capsule create создаёт portable capsule в .soba/capsules", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-capsule-command-create-"));
    try {
      const session = SessionManager.inMemory(tempDir);
      appendCapsuleCheckpoint(session, "ck_222222222222");
      const output: Array<{ type: string; message?: string }> = [];

      await executeCommand('/capsule create "Передать auth work"', makeCommandContext(session, output));

      const message = output[0]?.message ?? "";
      const path = message.match(/Path: (.+)$/m)?.[1];
      expect(output[0]?.type).toBe("info");
      expect(message).toContain("Portable capsule created");
      expect(path).toContain(join(".soba", "capsules"));
      expect(path ? existsSync(path) : false).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("/capsule export пишет файл по prefix и не перезаписывает destination", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-capsule-command-export-"));
    try {
      const session = SessionManager.inMemory(tempDir);
      appendCapsuleCheckpoint(session, "ck_abcdef111111");
      const output: Array<{ type: string; message?: string }> = [];
      const context = makeCommandContext(session, output);

      await executeCommand("/capsule export ck_abc exported.capsule.md", context);
      await executeCommand("/capsule export ck_abc exported.capsule.md", context);

      expect(output[0]?.type).toBe("info");
      expect(output[0]?.message).toContain("Portable capsule exported");
      expect(existsSync(join(tempDir, "exported.capsule.md"))).toBe(true);
      expect(output[1]?.type).toBe("error");
      expect(output[1]?.message).toContain("Capsule error");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("/capsule load возвращает untrusted prompt и не меняет session tree", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-capsule-command-load-"));
    try {
      const session = SessionManager.inMemory(tempDir);
      appendCapsuleCheckpoint(session, "ck_333333333333");
      const output: Array<{ type: string; message?: string }> = [];
      const context = makeCommandContext(session, output);

      await executeCommand("/capsule export ck_333 loadable.capsule.md", context);
      const beforeCount = session.getCapsuleEntries().length;
      const result = await executeCommand("/capsule load loadable.capsule.md", context);

      expect(result.handled).toBe(false);
      if (result.handled) {
        throw new Error("Expected /capsule load to return an untrusted prompt");
      }
      expect(result.prompt).toContain("untrusted portable capsule");
      expect(result.prompt).toContain("Do not execute commands");
      expect(session.getCapsuleEntries()).toHaveLength(beforeCount);
      expect(output[1]?.type).toBe("info");
      expect(output[1]?.message).toContain("Portable capsule loaded");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("/capsule load отклоняет corrupted файл без запуска следующего turn", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "soba-capsule-command-corrupted-"));
    try {
      const session = SessionManager.inMemory(tempDir);
      const output: Array<{ type: string; message?: string }> = [];
      writeFileSync(join(tempDir, "broken.capsule.md"), "# broken", "utf-8");

      const result = await executeCommand("/capsule load broken.capsule.md", makeCommandContext(session, output));

      expect(result).toEqual({ handled: true });
      expect(output[0]?.type).toBe("error");
      expect(output[0]?.message).toContain("Capsule error");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("/mcp status работает без MCP config", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const context = makeCommandContext(SessionManager.inMemory(process.cwd()), output);

    await executeCommand("/mcp status", context);

    expect(output[0]?.type).toBe("info");
    expect(output[0]?.message).toContain("MCP status:");
    expect(output[0]?.message).toContain("No MCP servers configured.");
  });

  test("/mcp status показывает два сервера и агрегированные статусы", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([
      fakeMcpServer({ id: "docs", state: "ready", started: true, lifecycle: "modern", protocolVersion: "2026-07-28" }),
      fakeMcpServer({ id: "git", state: "stopped", started: false }),
    ]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp status", context);

    const message = output[0]?.message ?? "";
    expect(message).toContain("Configured: 2, running: 1, ready: 1");
    expect(message).toContain("docs — docs");
    expect(message).toContain("git — git");
    expect(message).toContain("state=stopped");
  });

  test("/mcp start запускает сервер", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "docs", state: "idle", started: false })]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp start docs", context);

    expect(mcpManager.calls).toEqual(["start:docs"]);
    expect(output[0]).toMatchObject({ type: "info", message: "MCP start docs: ok" });
    expect(mcpManager.getStatus().servers[0]?.state).toBe("ready");
  });

  test("/mcp stop останавливает сервер", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "docs", state: "ready", started: true })]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp stop docs", context);

    expect(mcpManager.calls).toEqual(["stop:docs"]);
    expect(output[0]).toMatchObject({ type: "info", message: "MCP stop docs: ok" });
    expect(mcpManager.getStatus().servers[0]?.state).toBe("stopped");
  });

  test("/mcp restart перезапускает crashed server", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "docs", state: "crashed", started: true, lastError: "crashed" })]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp restart docs", context);

    expect(mcpManager.calls).toEqual(["restart:docs"]);
    expect(output[0]).toMatchObject({ type: "info", message: "MCP restart docs: ok" });
    expect(mcpManager.getStatus().servers[0]?.state).toBe("ready");
  });

  test("/mcp unknown server возвращает понятную ошибку", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "docs", state: "ready", started: true })]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp start missing", context);

    expect(output[0]?.type).toBe("error");
    expect(output[0]?.message).toContain("MCP start missing:");
    expect(output[0]?.message).toContain("Unknown MCP server id");
  });

  test("/mcp errors redact env secrets", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const secret = "ghp-secret-value-that-must-not-leak";
    const mcpManager = new FakeMcpCommandManager(
      [fakeMcpServer({ id: "github", state: "idle", started: false })],
      {
        github: {
          serverId: "github",
          trustMode: "safe",
          timeoutMs: 30_000,
          maxOutputBytes: 1024,
          env: { GITHUB_TOKEN: secret },
        },
      },
    );
    mcpManager.failStart("github", `failed with ${secret}`);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp start github", context);

    expect(output[0]?.type).toBe("error");
    expect(output[0]?.message).not.toContain(secret);
    expect(output[0]?.message).toContain("[REDACTED:MCP_ENV]");
  });

  test("/mcp status shows remote server auth state", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([
      fakeMcpServer({
        id: "remote",
        transport: "streamableHttp",
        authState: {
          type: "oauth",
          state: "auth_required",
          detail: "server rejected the current credentials",
          nextAction: "Run /mcp auth login remote",
        },
      }),
    ]);
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp status", context);

    const message = output[0]?.message ?? "";
    expect(message).toContain("transport=streamableHttp");
    expect(message).toContain("auth=oauth/auth_required");
    expect(message).toContain("Run /mcp auth login remote");
  });

  test("/mcp auth login starts remote auth flow and keeps compact notification bounded", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const longUrl = `https://auth.example.com/oauth/authorize?${"x".repeat(180)}`;
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "remote", transport: "streamableHttp" })]);
    mcpManager.setAuthResult("login", "remote", {
      status: { type: "oauth", state: "login_required", detail: "oauth", nextAction: "Open the authorization URL." },
      message: "OAuth login started. Open the URL from Details if the browser did not open.",
      details: longUrl,
    });
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp auth login remote", context);

    const message = output[0]?.message ?? "";
    const firstLine = message.split("\n")[0] ?? "";
    expect(mcpManager.calls).toEqual(["auth-login:remote"]);
    expect(output[0]?.type).toBe("info");
    expect(firstLine.length).toBeLessThan(160);
    expect(firstLine).not.toContain(longUrl);
    expect(message).toContain(longUrl);
  });

  test("/mcp auth logout clears remote token and updates state", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "remote", transport: "streamableHttp" })]);
    mcpManager.setAuthResult("logout", "remote", {
      status: { type: "oauth", state: "login_required", detail: "oauth", nextAction: "Run /mcp auth login remote" },
      message: "OAuth token cleared.",
      details: null,
    });
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp auth logout remote", context);

    expect(mcpManager.calls).toEqual(["auth-logout:remote"]);
    expect(output[0]?.message).toContain("login_required");
    expect(output[0]?.message).toContain("OAuth token cleared.");
  });

  test("/mcp auth status includes next action when auth is required", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const mcpManager = new FakeMcpCommandManager([fakeMcpServer({ id: "remote", transport: "streamableHttp" })]);
    mcpManager.setAuthResult("status", "remote", {
      status: {
        type: "oauth",
        state: "auth_required",
        detail: "server rejected the current credentials",
        nextAction: "Run /mcp auth login remote",
      },
      message: "Authentication is required.",
      details: null,
    });
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpManager,
    } as unknown as CommandContext;

    await executeCommand("/mcp auth status remote", context);

    expect(mcpManager.calls).toEqual(["auth-status:remote"]);
    expect(output[0]?.message).toContain("auth_required");
    expect(output[0]?.message).toContain("Next action: Run /mcp auth login remote");
  });

  test("/mcp reload вызывает runtime hotreload и показывает сводку", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const calls: string[] = [];
    const mcpRuntime = {
      getManager: () => undefined,
      syncTools: async () => ({
        removed: 0,
        registered: [],
        trustRules: [],
        skipped: [],
      }),
      reload: async () => {
        calls.push("reload");
        return {
          previousServerIds: ["old"],
          serverIds: ["docs", "github"],
          addedServerIds: ["github"],
          removedServerIds: ["old"],
          restartedServerIds: ["docs"],
          toolSync: {
            removed: 1,
            registered: ["mcp_docs_search", "mcp_github_issue"],
            trustRules: [],
            skipped: [],
          },
        };
      },
    };
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpRuntime,
    } as unknown as CommandContext;

    await executeCommand("/mcp reload", context);

    expect(calls).toEqual(["reload"]);
    expect(output[0]?.type).toBe("info");
    expect(output[0]?.message).toContain("MCP reload:");
    expect(output[0]?.message).toContain("configured=2");
    expect(output[0]?.message).toContain("added=github");
    expect(output[0]?.message).toContain("removed=old");
    expect(output[0]?.message).toContain("restarted=docs");
    expect(output[0]?.message).toContain("tools=2");
  });

  test("/mcp secret set/list/unset stores names without echoing secret values", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const tempDir = mkdtempSync(join(tmpdir(), "soba-mcp-secret-command-"));
    const mcpSecretStore = new McpSecretStore({ homeDir: tempDir });
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      mcpSecretStore,
    } as unknown as CommandContext;

    try {
      await executeCommand("/mcp secret set REMOTE_MCP_API_KEY tavily-secret-value", context);
      await executeCommand("/mcp secret list", context);
      await executeCommand("/mcp secret unset REMOTE_MCP_API_KEY", context);

      expect(await mcpSecretStore.get("REMOTE_MCP_API_KEY")).toBeNull();
      expect(output.map((entry) => entry.type)).toEqual(["info", "info", "info"]);
      expect(output[0]?.message).toContain("REMOTE_MCP_API_KEY");
      expect(output[0]?.message).toContain("/mcp reload");
      expect(output[1]?.message).toContain("REMOTE_MCP_API_KEY");
      expect(output[2]?.message).toContain("removed");
      expect(output.map((entry) => entry.message ?? "").join("\n")).not.toContain("tavily-secret-value");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("/mcp auth locale keys exist for ru en zh", () => {
    const keys = [
      "command.mcp.auth.details",
      "command.mcp.auth.login",
      "command.mcp.auth.logout",
      "command.mcp.auth.nextAction",
      "command.mcp.auth.status",
      "command.mcp.auth.usage",
      "command.mcp.secret.error",
      "command.mcp.secret.list",
      "command.mcp.secret.none",
      "command.mcp.secret.notFound",
      "command.mcp.secret.removed",
      "command.mcp.secret.set",
      "command.mcp.secret.unset",
      "command.mcp.secret.usage",
      "command.mcp.reload.error",
      "command.mcp.reload.result",
      "command.mcp.reload.unavailable",
    ];

    for (const locale of ["en", "ru", "zh"]) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), "locales", `${locale}.json`), "utf8")) as Record<string, unknown>;
      for (const key of keys) {
        expect(typeof messages[key]).toBe("string");
      }
    }
  });

  test("/permissions показывает и меняет режим разрешений", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const trustManager = new TrustManager();
    const context = {
      ...makeCommandContext(SessionManager.inMemory(process.cwd()), output),
      trustManager,
    } as unknown as CommandContext;

    await executeCommand("/permissions", context);
    await executeCommand("/permissions repo", context);
    await executeCommand("/permissions full", context);
    await executeCommand("/permissions clear", context);

    expect(output.map((event) => event.type)).toEqual(["info", "info", "info", "info"]);
    expect(output[0]?.message).toContain("Permission mode: ask");
    expect(output[1]?.message).toContain("repo");
    expect(output[2]?.message).toContain("full");
    expect(output[3]?.message).toContain("permission mode: ask");
    expect(trustManager.getPermissionMode()).toBe("ask");
  });
});

describe("/project-trust commands", () => {
  let tempDir: string;
  let sobaDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-project-trust-test-"));
    sobaDir = join(tempDir, ".soba");
    mkdirSync(sobaDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createMockSkillManager(): SkillManager {
    const trustStore = createFilesystemProjectTrustStore({ sobaDir });
    const discovery = {
      computeFingerprint: (_root: string) => "mock-fingerprint-hash",
      discover: () => ({ skills: [], diagnostics: [] }),
    };
    const catalog = {
      refresh: () => {},
      list: () => [],
      get: () => undefined,
      activate: () => ({ success: false, error: "not found", diagnostics: [] }),
      getModelInvocable: () => [],
      getSummary: () => "",
    };
    return {
      trustStore,
      discovery,
      catalog,
      refresh: () => catalog.refresh(),
      activate: () => catalog.activate(),
      getSkill: () => undefined,
    } as unknown as SkillManager;
  }

  test("/project-trust status показывает информацию о проекте", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const skillManager = createMockSkillManager();
    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust status", context);

    expect(output[0]?.type).toBe("info");
    expect(output[0]?.message).toContain("Project trust status");
  });

  test("/project-trust approve одобряет новый проект", async () => {
    const output: Array<{ type: string; message?: string; trusted?: boolean }> = [];
    const skillManager = createMockSkillManager();
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(process.cwd());
    expect(skillManager.trustStore.isTrusted(identity)).toBe(false);

    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string; trusted?: boolean }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust approve", context);

    expect(output[0]?.type).toBe("info");
    expect(output.some((e) => e.type === "trust_changed" && e.trusted === true)).toBe(true);
    expect(skillManager.trustStore.isTrusted(identity)).toBe(true);
  });

  test("/project-trust approve обновляет fingerprint для уже одобренного проекта", async () => {
    const output: Array<{ type: string; message?: string; trusted?: boolean }> = [];
    const skillManager = createMockSkillManager();

    // Pre-approve the project (using process.cwd() identity since that's what the command uses)
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(process.cwd());
    skillManager.trustStore.approve(identity, "old-fingerprint");

    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string; trusted?: boolean }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust approve", context);

    expect(output[0]?.type).toBe("info");
    expect(output.some((e) => e.type === "trust_changed" && e.trusted === true)).toBe(true);
    const record = skillManager.trustStore.getRecord(identity);
    expect(record?.skillsFingerprint).toBe("mock-fingerprint-hash");
  });

  test("/project-trust revoke отзывает доверие", async () => {
    const output: Array<{ type: string; message?: string; trusted?: boolean }> = [];
    const skillManager = createMockSkillManager();

    // Pre-approve the project (using process.cwd() identity since that's what the command uses)
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(process.cwd());
    skillManager.trustStore.approve(identity, "fingerprint");
    expect(skillManager.trustStore.isTrusted(identity)).toBe(true);

    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string; trusted?: boolean }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust revoke", context);

    expect(output[0]?.type).toBe("info");
    expect(output.some((e) => e.type === "trust_changed" && e.trusted === false)).toBe(true);
    expect(skillManager.trustStore.isTrusted(identity)).toBe(false);
  });

  test("/project-trust revoke для недоверенного проекта возвращает ошибку", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const skillManager = createMockSkillManager();

    // Ensure project is not trusted (using process.cwd() identity)
    const identity = createFilesystemProjectTrustStore({ sobaDir }).computeProjectIdentity(process.cwd());
    skillManager.trustStore.revoke(identity);
    expect(skillManager.trustStore.isTrusted(identity)).toBe(false);

    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust revoke", context);

    expect(output[0]?.type).toBe("error");
  });

  test("/project-trust без подкоманды показывает usage", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const skillManager = createMockSkillManager();
    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust", context);

    expect(output[0]?.type).toBe("error");
    expect(output[0]?.message).toContain("status|approve|revoke");
  });

  test("/project-trust с неизвестной подкомандой возвращает ошибку", async () => {
    const output: Array<{ type: string; message?: string }> = [];
    const skillManager = createMockSkillManager();
    const context = {
      session: SessionManager.inMemory(process.cwd()),
      config: { ...DEFAULT_CONFIG },
      i18n: new I18n("en"),
      renderer: { emit: (event: { type: string; message?: string }) => output.push(event) },
      skillManager,
    } as unknown as CommandContext;

    await executeCommand("/project-trust unknown", context);

    expect(output[0]?.type).toBe("error");
  });
});

type FakeMcpServerInput = Partial<McpManagedServerStatus> & { id: string };

class FakeMcpCommandManager {
  readonly calls: string[] = [];
  private readonly servers = new Map<string, McpManagedServerStatus>();
  private readonly securityByServer: Record<string, McpServerSecurity>;
  private readonly startFailures = new Map<string, string>();
  private readonly authResults = new Map<string, McpRemoteAuthCommandResult>();

  constructor(servers: McpManagedServerStatus[], securityByServer: Record<string, McpServerSecurity> = {}) {
    for (const server of servers) {
      this.servers.set(server.id, server);
    }
    this.securityByServer = securityByServer;
  }

  getStatus(): McpClientManagerStatus {
    const servers = [...this.servers.values()];
    return {
      servers,
      counts: {
        idle: servers.filter((server) => server.state === "idle").length,
        starting: servers.filter((server) => server.state === "starting").length,
        ready: servers.filter((server) => server.state === "ready").length,
        degraded: servers.filter((server) => server.state === "degraded").length,
        stopping: servers.filter((server) => server.state === "stopping").length,
        stopped: servers.filter((server) => server.state === "stopped").length,
        crashed: servers.filter((server) => server.state === "crashed").length,
      },
    };
  }

  async start(serverId: string): Promise<unknown> {
    this.calls.push(`start:${serverId}`);
    this.assertKnown(serverId);
    const failure = this.startFailures.get(serverId);
    if (failure) {
      throw new Error(failure);
    }
    this.patchServer(serverId, { state: "ready", started: true, lifecycle: "modern", protocolVersion: "2026-07-28", lastError: null });
    return {};
  }

  async stop(serverId: string): Promise<void> {
    this.calls.push(`stop:${serverId}`);
    this.assertKnown(serverId);
    this.patchServer(serverId, { state: "stopped", started: false, lifecycle: null, protocolVersion: null, lastError: null });
  }

  async restart(serverId: string): Promise<unknown> {
    this.calls.push(`restart:${serverId}`);
    this.assertKnown(serverId);
    this.patchServer(serverId, {
      state: "ready",
      started: true,
      lifecycle: "modern",
      protocolVersion: "2026-07-28",
      lastError: null,
      crashRestartCount: 0,
      restartExhausted: false,
    });
    return {};
  }

  getServerSecurity(serverId: string): McpServerSecurity {
    const security = this.securityByServer[serverId];
    if (security) {
      return security;
    }

    return {
      serverId,
      trustMode: "normal",
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      env: {},
    };
  }

  failStart(serverId: string, message: string): void {
    this.startFailures.set(serverId, message);
  }

  setAuthResult(action: "status" | "login" | "logout", serverId: string, result: McpRemoteAuthCommandResult): void {
    this.authResults.set(`${action}:${serverId}`, result);
  }

  async getAuthStatus(serverId: string): Promise<McpRemoteAuthCommandResult> {
    this.calls.push(`auth-status:${serverId}`);
    this.assertKnown(serverId);
    return this.authResult("status", serverId);
  }

  async login(serverId: string): Promise<McpRemoteAuthCommandResult> {
    this.calls.push(`auth-login:${serverId}`);
    this.assertKnown(serverId);
    return this.authResult("login", serverId);
  }

  async logout(serverId: string): Promise<McpRemoteAuthCommandResult> {
    this.calls.push(`auth-logout:${serverId}`);
    this.assertKnown(serverId);
    return this.authResult("logout", serverId);
  }

  private patchServer(serverId: string, patch: Partial<McpManagedServerStatus>): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Unknown MCP server id: ${serverId}`);
    }

    this.servers.set(serverId, { ...server, ...patch });
  }

  private assertKnown(serverId: string): void {
    if (!this.servers.has(serverId)) {
      throw new Error(`Unknown MCP server id: ${serverId}`);
    }
  }

  private authResult(action: "status" | "login" | "logout", serverId: string): McpRemoteAuthCommandResult {
    const configured = this.authResults.get(`${action}:${serverId}`);
    if (configured) {
      return configured;
    }

    const authState = this.servers.get(serverId)?.authState ?? {
      type: "not_applicable",
      state: "not_required",
      detail: "stdio",
      nextAction: null,
    };

    return {
      status: authState,
      message: `MCP auth ${action} ${serverId}: ${authState.state}.`,
      details: null,
    };
  }
}

function fakeMcpServer(input: FakeMcpServerInput): McpManagedServerStatus {
  return {
    id: input.id,
    name: input.name ?? input.id,
    transport: input.transport,
    authState: input.authState,
    enabled: input.enabled ?? true,
    started: input.started ?? false,
    state: input.state ?? "idle",
    lifecycle: input.lifecycle ?? null,
    protocolVersion: input.protocolVersion ?? null,
    lastError: input.lastError ?? null,
    lastErrorCode: input.lastError ? "test_error" : null,
    toolsListChanged: input.toolsListChanged ?? false,
    crashRestartCount: input.crashRestartCount ?? 0,
    restartExhausted: input.restartExhausted ?? false,
  };
}
