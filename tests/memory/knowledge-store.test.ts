import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateMarkdownTokens, KnowledgeStore } from "../../src/core/memory/knowledge-store";
import { KNOWLEDGE_KEYS, type KnowledgeKey } from "../../src/core/memory/types";

describe("KnowledgeStore", () => {
  let projectRoot: string;
  let store: KnowledgeStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-knowledge-store-"));
    store = new KnowledgeStore({ projectRoot });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("first init creates knowledge directory and default templates", () => {
    store.init();

    expect(existsSync(store.getKnowledgeDir())).toBe(true);

    for (const key of KNOWLEDGE_KEYS) {
      const document = store.read(key);
      expect(existsSync(document.path)).toBe(true);
      expect(document.filename.endsWith(".md")).toBe(true);
      expect(document.content).toStartWith("# ");
    }
  });

  test("read returns existing knowledge file", () => {
    store.init();

    const architecture = store.read("architecture");

    expect(architecture.key).toBe("architecture");
    expect(architecture.filename).toBe("architecture.md");
    expect(architecture.content).toContain("Architecture");
  });

  test("write overwrites the expected knowledge file", () => {
    const document = store.write("conventions", "# Team Conventions\n\nUse Bun only.\n");

    expect(document.content).toBe("# Team Conventions\n\nUse Bun only.\n");
    expect(readFileSync(join(store.getKnowledgeDir(), "conventions.md"), "utf-8")).toBe(document.content);
  });

  test("append adds content without removing existing content", () => {
    store.write("known-errors", "# Known Errors\n\n- First fix.\n");

    const document = store.append("known-errors", "- Second fix.\n");

    expect(document.content).toBe("# Known Errors\n\n- First fix.\n- Second fix.\n");
  });

  test("reset restores the default template", () => {
    store.write("dependencies", "# Custom\n");

    const reset = store.reset("dependencies");

    expect(reset.content).toContain("# Dependencies");
    expect(reset.content).toContain("Track important dependencies");
  });

  test("loadAll returns only known markdown documents in stable order", () => {
    store.init();
    writeFileSync(join(store.getKnowledgeDir(), "extra.md"), "# Extra\n", "utf-8");
    writeFileSync(join(store.getKnowledgeDir(), "capsule.json"), '{"id":"not-knowledge"}', "utf-8");

    const documents = store.loadAll();

    expect(documents.map((document) => document.key)).toEqual([...KNOWLEDGE_KEYS]);
    expect(documents.map((document) => document.filename)).not.toContain("extra.md");
    expect(documents.map((document) => document.filename)).not.toContain("capsule.json");
  });

  test("missing or unknown knowledge key is rejected", () => {
    expect(() => store.read("missing" as KnowledgeKey)).toThrow("Unknown knowledge key");
    expect(() => store.write("../capsules/not-knowledge" as KnowledgeKey, "bad")).toThrow("Unknown knowledge key");
    expect(store.exists("missing" as KnowledgeKey)).toBe(false);
    expect(existsSync(join(projectRoot, ".soba", "memory", "capsules", "not-knowledge.json"))).toBe(false);
  });

  test("token estimate is deterministic enough for budget tests", () => {
    store.write("architecture", "123456789");
    store.write("conventions", "abcd");
    store.write("known-errors", "");
    store.write("dependencies", "12345");

    expect(estimateMarkdownTokens("123456789")).toBe(3);
    expect(store.estimateTotalTokens()).toBe(3 + 1 + 0 + 2);
  });

  test("formatForPrompt renders all knowledge sections", () => {
    store.write("architecture", "# Architecture\n\nLayered CLI.\n");
    store.write("conventions", "# Conventions\n\nBun only.\n");

    const prompt = store.formatForPrompt();

    expect(prompt).toStartWith("# Project Memory: Knowledge");
    expect(prompt).toContain("## architecture.md");
    expect(prompt).toContain("Layered CLI.");
    expect(prompt).toContain("## conventions.md");
    expect(prompt).toContain("Bun only.");
    expect(prompt).toContain("## known-errors.md");
    expect(prompt).toContain("## dependencies.md");
  });
});
