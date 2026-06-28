/**
 * Session Manager tests.
 *
 * Tests cover use cases UC-4 (Continue session), UC-6 (Rewind / branching).
 * Each test corresponds to a specific scenario from use-cases.md.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  decodeSessionPath,
  encodeSessionPath,
  estimateItemTokens,
  estimateTokens,
  findMostRecentSession,
  loadEntriesFromFile,
  parseSessionEntries,
  SessionManager,
  serializeItem,
} from "../src/infrastructure/persistence/sessions/session-manager";
import type {
  AssistantMessageItemParam,
  CompactionSummaryItemParam,
  FunctionCallItemParam,
  FunctionCallOutputItemParam,
  ItemParam,
  SessionItemEntry,
  UserMessageItemParam,
} from "../src/kernel/transcript/types";

// ─── Helpers ───

function makeUserMessage(text: string): UserMessageItemParam {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function makeAssistantMessage(text: string): AssistantMessageItemParam {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

function makeFunctionCall(callId: string, name: string, args: string): FunctionCallItemParam {
  return {
    type: "function_call",
    call_id: callId,
    name,
    arguments: args,
  };
}

function makeFunctionCallOutput(callId: string, output: string): FunctionCallOutputItemParam {
  return {
    type: "function_call_output",
    call_id: callId,
    output,
  };
}

function makeCompactionItem(summary: string): CompactionSummaryItemParam {
  return {
    type: "compaction",
    encrypted_content: summary,
  };
}

// ─── Tests ───

describe("SessionManager", () => {
  // ── Basic session creation ──

  test("create создаёт новую сессию с заголовком", () => {
    const sm = SessionManager.inMemory("/test/project");
    const header = sm.getHeader();

    expect(header).not.toBeNull();
    expect(header?.type).toBe("session");
    expect(header?.version).toBe(CURRENT_SESSION_VERSION);
    expect(header?.cwd).toContain("test");
    expect(sm.getSessionId()).toBeTruthy();
    expect(sm.isPersisted()).toBe(false);
  });

  test("inMemory сессия имеет корректный cwd", () => {
    const sm = SessionManager.inMemory("/my/project");
    expect(sm.getCwd()).toContain("my");
    expect(sm.getCwd()).toContain("project");
  });

  test("create с persist флагом создаёт файл на диске", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-session-"));
    const sm = SessionManager.create("/test/project", tmpDir);

    expect(sm.isPersisted()).toBe(true);
    expect(sm.getSessionFile()).toBeTruthy();
    expect(existsSync(sm.getSessionFile()!)).toBe(true);

    const content = readFileSync(sm.getSessionFile()!, "utf-8");
    const parsed = JSON.parse(content.trim().split("\n")[0]);
    expect(parsed.type).toBe("session");
    expect(parsed.version).toBe(CURRENT_SESSION_VERSION);

    rmSync(tmpDir, { recursive: true });
  });

  // ── appendItem and getBranch (UC-2: basic conversation flow) ──

  test("appendItem добавляет элементы и getBranch возвращает путь от листа к корню", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("Hello"));
    sm.appendItem(makeAssistantMessage("Hi! How can I help?"));
    sm.appendItem(makeUserMessage("Read file.txt"));

    const branch = sm.getBranch();
    expect(branch.length).toBe(3);
    expect(branch[0].type).toBe("item");
    expect(((branch[0] as SessionItemEntry).item as UserMessageItemParam).role).toBe("user");
    expect(((branch[1] as SessionItemEntry).item as AssistantMessageItemParam).role).toBe("assistant");
    expect(((branch[2] as SessionItemEntry).item as UserMessageItemParam).role).toBe("user");
  });

  test("getLeafId возвращает id последнего добавленного элемента", () => {
    const sm = SessionManager.inMemory("/project");

    const id1 = sm.appendItem(makeUserMessage("first"));
    expect(sm.getLeafId()).toBe(id1);

    const id2 = sm.appendItem(makeAssistantMessage("response"));
    expect(sm.getLeafId()).toBe(id2);
    expect(id2).not.toBe(id1);
  });

  // ── buildInput without compaction (UC-2) ──

  test("buildInput без compaction возвращает все items", () => {
    const sm = SessionManager.inMemory("/project");

    const userMsg = makeUserMessage("Hello");
    sm.appendItem(userMsg);
    sm.appendItem(makeAssistantMessage("Hi!"));

    const input = sm.buildInput();
    expect(input.items.length).toBe(2);
    expect(input.items[0].type).toBe("message");
    expect(input.items[1].type).toBe("message");
    expect(input.previousResponseId).toBeUndefined();
  });

  test("buildInput включает function_call и function_call_output", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("List files"));
    sm.appendItem(makeFunctionCall("call_1", "bash", '{"command":"ls"}'));
    sm.appendItem(makeFunctionCallOutput("call_1", "file1.txt\nfile2.txt"));
    sm.appendItem(makeAssistantMessage("Found 2 files"));

    const input = sm.buildInput();
    expect(input.items.length).toBe(4);
    expect(input.items[1].type).toBe("function_call");
    expect((input.items[1] as FunctionCallItemParam).name).toBe("bash");
    expect(input.items[2].type).toBe("function_call_output");
  });

  // ── Compaction (UC-5: manual compaction) ──

  test("appendCompaction добавляет checkpoint в сессию", () => {
    const sm = SessionManager.inMemory("/project");

    const id1 = sm.appendItem(makeUserMessage("Hello"));
    sm.appendItem(makeAssistantMessage("Hi!"));
    sm.appendItem(makeUserMessage("Do something complex"));
    sm.appendItem(makeAssistantMessage("I'll help"));

    const compactionItem = makeCompactionItem("Summary of first 2 messages");
    const compactionId = sm.appendCompaction("resp_123", compactionItem, id1, 500);

    expect(compactionId).toBeTruthy();

    const branch = sm.getBranch();
    const compactionEntries = branch.filter((e) => e.type === "compaction");
    expect(compactionEntries.length).toBe(1);
  });

  test("buildInput с compaction возвращает compactionItem + items начиная с firstKeptEntryId", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("Old message 1"));
    sm.appendItem(makeAssistantMessage("Old response 1"));

    const keptId = sm.appendItem(makeUserMessage("Recent message"));
    sm.appendItem(makeAssistantMessage("Recent response"));
    sm.appendItem(makeUserMessage("New question"));
    sm.appendItem(makeAssistantMessage("New answer"));

    const compactionItem = makeCompactionItem("Summary of old conversation");
    sm.appendCompaction("resp_compact_1", compactionItem, keptId, 300);

    const input = sm.buildInput();
    expect(input.items[0].type).toBe("compaction");
    expect(input.items.length).toBe(5); // compaction + 4 items
    expect(input.items[1].type).toBe("message");
    expect(input.previousResponseId).toBe("resp_compact_1");
  });

  test("buildInput с множественными compaction использует только последнюю", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("msg1"));
    const kept1Id = sm.appendItem(makeUserMessage("msg2"));
    sm.appendItem(makeAssistantMessage("msg3"));
    sm.appendCompaction("resp_1", makeCompactionItem("Summary 1"), kept1Id, 200);

    const kept2Id = sm.appendItem(makeUserMessage("msg4"));
    sm.appendItem(makeAssistantMessage("msg5"));
    sm.appendCompaction("resp_2", makeCompactionItem("Summary 2"), kept2Id, 150);

    const input = sm.buildInput();
    expect(input.items[0].type).toBe("compaction");
    expect((input.items[0] as CompactionSummaryItemParam).encrypted_content).toBe("Summary 2");
    expect(input.previousResponseId).toBe("resp_2");
  });

  // ── Branching (UC-6: rewind) ──

  test("branch переключает leaf на более раннюю запись", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("Hello"));
    sm.appendItem(makeAssistantMessage("Hi!"));
    const id3 = sm.appendItem(makeUserMessage("Branch point"));

    sm.appendItem(makeAssistantMessage("Path A response"));
    sm.branch(id3);

    const newId = sm.appendItem(makeAssistantMessage("Path B response"));

    const branch = sm.getBranch();
    expect(branch.length).toBe(4);
    expect(branch[3].id).toBe(newId);

    const tree = sm.getTree();
    expect(tree.length).toBe(1);
    const nodeId3 = tree[0].children[0]?.children?.find((n) => n.entry.id === id3);
    expect(nodeId3).toBeDefined();
    expect(nodeId3?.children.length).toBe(2);
  });

  test("branch создаёт альтернативную ветку без удаления старой", () => {
    const sm = SessionManager.inMemory("/project");

    const id1 = sm.appendItem(makeUserMessage("root"));
    sm.appendItem(makeAssistantMessage("A1"));
    sm.appendItem(makeAssistantMessage("A2"));

    sm.branch(id1);
    sm.appendItem(makeAssistantMessage("B1"));
    sm.appendItem(makeAssistantMessage("B2"));

    const branch = sm.getBranch();
    expect(branch.length).toBe(3);

    const allEntries = sm.getEntries();
    expect(allEntries.length).toBe(5); // root + A1 + A2 + B1 + B2
  });

  test("buildInput на альтернативной ветке возвращает только текущую ветку", () => {
    const sm = SessionManager.inMemory("/project");

    const id1 = sm.appendItem(makeUserMessage("root"));
    sm.appendItem(makeAssistantMessage("A1"));
    sm.appendItem(makeAssistantMessage("A2"));

    sm.branch(id1);
    sm.appendItem(makeAssistantMessage("B1"));

    const input = sm.buildInput();
    expect(input.items.length).toBe(2);
  });

  // ── resetLeaf ──

  test("resetLeaf сбрасывает leaf в null и новый append создаёт root", () => {
    const sm = SessionManager.inMemory("/project");

    sm.appendItem(makeUserMessage("first"));
    sm.appendItem(makeAssistantMessage("response"));
    sm.resetLeaf();

    const newId = sm.appendItem(makeUserMessage("new start"));
    const entry = sm.getEntry(newId);
    expect(entry?.parentId).toBeNull();
  });

  // ── Edge cases ──

  test("buildInput на пустой сессии возвращает пустой массив", () => {
    const sm = SessionManager.inMemory("/project");
    const input = sm.buildInput();
    expect(input.items).toEqual([]);
  });

  test("getBranch на пустой сессии возвращает пустой массив", () => {
    const sm = SessionManager.inMemory("/project");
    expect(sm.getBranch()).toEqual([]);
  });

  test("appendItem генерирует уникальные 8-символьные id", () => {
    const sm = SessionManager.inMemory("/project");
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(sm.appendItem(makeUserMessage(`msg ${i}`)));
    }
    expect(ids.size).toBe(100);
  });

  test("session file содержит валидный JSONL", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-jsonl-"));
    const sm = SessionManager.create("/test/project", tmpDir);

    sm.appendItem(makeUserMessage("Hello"));
    sm.appendItem(makeAssistantMessage("World"));

    const entries = loadEntriesFromFile(sm.getSessionFile()!);
    expect(entries.length).toBe(3); // header + 2 items
    expect(entries[0].type).toBe("session");
    expect(entries[1].type).toBe("item");
    expect(entries[2].type).toBe("item");

    rmSync(tmpDir, { recursive: true });
  });

  // ── continueMostRecent (UC-4) ──

  test("continueRecent открывает последнюю сессию", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-continue-"));

    SessionManager.create("/test/project", tmpDir).appendItem(makeUserMessage("session 1 message"));

    const sm2 = SessionManager.create("/test/project", tmpDir);
    sm2.appendItem(makeUserMessage("session 2 message"));

    const continued = SessionManager.continueRecent("/test/project", tmpDir);
    const branch = continued.getBranch();
    expect(branch.length).toBe(1);

    rmSync(tmpDir, { recursive: true });
  });

  test("continueRecent создаёт новую сессию если директория пуста", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-empty-"));

    const sm = SessionManager.continueRecent("/test/project", tmpDir);
    expect(sm.getBranch()).toEqual([]);
    expect(sm.getHeader()?.cwd).toContain("test");

    rmSync(tmpDir, { recursive: true });
  });

  test("openById открывает сессию по короткому ID", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-open-id-"));
    const sm = SessionManager.create("/test/project", tmpDir);
    sm.appendItem(makeUserMessage("specific session"));

    const opened = SessionManager.openById("/test/project", sm.getSessionId().slice(0, 8), tmpDir);

    expect(opened.getSessionId()).toBe(sm.getSessionId());
    expect(opened.buildInput().items).toHaveLength(1);

    rmSync(tmpDir, { recursive: true });
  });

  test("openById сообщает об отсутствующей сессии", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-missing-id-"));
    expect(() => SessionManager.openById("/test/project", "missing", tmpDir)).toThrow("Session not found");
    rmSync(tmpDir, { recursive: true });
  });

  // ── Open existing session ──

  test("open загружает существующую сессию с правильным leaf", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-open-"));

    const sm = SessionManager.create("/test/project", tmpDir);
    sm.appendItem(makeUserMessage("Hello"));
    sm.appendItem(makeAssistantMessage("World"));
    const lastId = sm.appendItem(makeUserMessage("Continue"));

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);
    expect(sm2.getLeafId()).toBe(lastId);
    expect(sm2.getBranch().length).toBe(3);

    rmSync(tmpDir, { recursive: true });
  });

  test("debug entries сохраняются в JSONL и не участвуют в дереве после reopen", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-session-debug-"));
    const sm = SessionManager.create("/test/project", tmpDir);
    const itemId = sm.appendItem(makeUserMessage("Hello"));
    sm.appendDebug({
      event: "loop/stop",
      turn: 1,
      iteration: 2,
      reason: "completed",
      detail: "diagnostic",
    });

    expect(sm.getEntries()).toHaveLength(1);
    expect(sm.getDebugEntries()).toHaveLength(1);

    const reopened = SessionManager.open(sm.getSessionFile()!);
    expect(reopened.getEntries()).toHaveLength(1);
    expect(reopened.getLeafId()).toBe(itemId);
    expect(reopened.getDebugEntries()[0]?.data.detail).toBe("diagnostic");

    rmSync(tmpDir, { recursive: true });
  });

  test("open восстанавливает дерево с branching", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-open2-"));

    const sm = SessionManager.create("/test/project", tmpDir);
    const rootId = sm.appendItem(makeUserMessage("root"));
    sm.appendItem(makeAssistantMessage("A"));
    sm.branch(rootId);
    sm.appendItem(makeAssistantMessage("B"));

    const sm2 = SessionManager.open(sm.getSessionFile()!, tmpDir);

    const branch = sm2.getBranch();
    expect(branch.length).toBe(2);
    expect(sm2.getEntries().length).toBe(3);

    const tree = sm2.getTree();
    expect(tree[0].children.length).toBe(2);

    rmSync(tmpDir, { recursive: true });
  });

  // ── getEntries ──

  test("getEntries возвращает все записи исключая заголовок", () => {
    const sm = SessionManager.inMemory("/project");
    sm.appendItem(makeUserMessage("msg1"));
    sm.appendItem(makeAssistantMessage("msg2"));

    const entries = sm.getEntries();
    expect(entries.length).toBe(2);
    expect(entries.every((e) => (e as { type: string }).type !== "session")).toBe(true);
  });

  // ── getLeafEntry ──

  test("getLeafEntry возвращает последний элемент", () => {
    const sm = SessionManager.inMemory("/project");
    expect(sm.getLeafEntry()).toBeUndefined();

    sm.appendItem(makeUserMessage("first"));
    const entry = sm.getLeafEntry();
    expect(entry?.type).toBe("item");
  });
});

// ─── Token estimation ───

describe("estimateItemTokens", () => {
  test("оценивает токены для user message", () => {
    const item: ItemParam = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello, world!" }],
    };
    const tokens = estimateItemTokens(item);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  test("оценивает токены для function_call", () => {
    const item: ItemParam = {
      type: "function_call",
      call_id: "c1",
      name: "read",
      arguments: '{"path":"/file.txt"}',
    };
    const tokens = estimateItemTokens(item);
    expect(tokens).toBeGreaterThan(5);
  });

  test("учитывает reasoning_content в оценке контекста", () => {
    const visibleOnly: ItemParam = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Готово" }],
    };
    const withReasoning: ItemParam = {
      ...visibleOnly,
      reasoning_content: "x".repeat(3500),
    };

    expect(estimateItemTokens(withReasoning)).toBeGreaterThan(estimateItemTokens(visibleOnly) + 900);
  });

  test("оценивает токены для длинного вывода", () => {
    const longText = "x".repeat(3500);
    const item: ItemParam = {
      type: "function_call_output",
      call_id: "c1",
      output: longText,
    };
    const tokens = estimateItemTokens(item);
    expect(tokens).toBe(1000);
  });
});

describe("estimateTokens", () => {
  test("суммирует токены массива items", () => {
    const items: ItemParam[] = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi there" }] },
    ];
    const tokens = estimateTokens(items);
    expect(tokens).toBeGreaterThan(0);
  });

  test("возвращает 0 для пустого массива", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

// ─── Path encoding ───

describe("encodeSessionPath / decodeSessionPath", () => {
  test("кодирует путь заменяя / на -", () => {
    const encoded = encodeSessionPath("/workspace/project");
    expect(encoded).not.toContain("/");
    expect(encoded).toContain("workspace");
    expect(encoded).toContain("project");
    expect(encoded).toContain("project");
  });

  test("roundtrip encode + decode", () => {
    const path = "/workspace/project";
    const decoded = decodeSessionPath(encodeSessionPath(path));
    expect(decoded).toBe(path);
  });
});

// ─── parseSessionEntries ───

describe("parseSessionEntries", () => {
  test("парсит валидный JSONL", () => {
    const content = [
      '{"type":"session","version":1,"id":"abc","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
      '{"type":"item","id":"d1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","item":{"type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
    ].join("\n");

    const entries = parseSessionEntries(content);
    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe("session");
    expect(entries[1].type).toBe("item");
  });

  test("игнорирует пустые строки", () => {
    const content = [
      "",
      '{"type":"session","version":1,"id":"abc","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
      "",
    ].join("\n");

    const entries = parseSessionEntries(content);
    expect(entries.length).toBe(1);
  });

  test("игнорирует некорректный JSON", () => {
    const content = [
      "not json",
      '{"type":"session","version":1,"id":"abc","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
      "{invalid",
    ].join("\n");

    const entries = parseSessionEntries(content);
    expect(entries.length).toBe(1);
  });
});

// ─── findMostRecentSession ───

describe("findMostRecentSession", () => {
  test("возвращает null для несуществующей директории", () => {
    const result = findMostRecentSession("/nonexistent/path/to/sessions");
    expect(result).toBeNull();
  });

  test("возвращает самый свежий файл", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-recent-"));

    SessionManager.create("/test/project", tmpDir);
    // Small delay to ensure filename timestamps differ
    await Bun.sleep(5);
    const sm2 = SessionManager.create("/test/project", tmpDir);

    const mostRecent = findMostRecentSession(tmpDir);
    expect(mostRecent).toBe(sm2.getSessionFile() as string);

    rmSync(tmpDir, { recursive: true });
  });

  test("возвращает null если нет JSONL файлов", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "soba-test-recent2-"));
    const result = findMostRecentSession(tmpDir);
    expect(result).toBeNull();
    rmSync(tmpDir, { recursive: true });
  });
});

// ─── serializeItem ───

describe("serializeItem", () => {
  test("сериализует user message", () => {
    const result = serializeItem(makeUserMessage("Hello"));
    expect(result).toContain("[user]");
    expect(result).toContain("Hello");
  });

  test("сериализует function_call", () => {
    const result = serializeItem(makeFunctionCall("c1", "read", '{"path":"/f.txt"}'));
    expect(result).toContain("read");
  });

  test("сериализует compaction", () => {
    const result = serializeItem(makeCompactionItem("summary text"));
    expect(result).toContain("[Compaction");
  });
});
