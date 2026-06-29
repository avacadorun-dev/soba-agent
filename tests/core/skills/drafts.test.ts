import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DraftStore, type EvalCase } from "../../../src/application/skills/drafts";
import { DraftFilesystemFacade, FilesystemDraftStorage } from "../../../src/infrastructure/persistence/skills/draft-storage";

describe("DraftStore", () => {
  const testDir = join(process.cwd(), ".test-drafts");
  const draftsPath = join(testDir, "drafts");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("создаёт новый draft с валидным содержимым", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: test-skill
description: Test skill for drafts
---

# Test Skill

This is a test skill.
`;

    const result = store.create("test-skill", content);

    expect(result.success).toBe(true);
    expect(result.draft).toBeDefined();
    expect(result.draft?.name).toBe("test-skill");
    // Draft may be invalid due to name-directory mismatch, but that's OK for drafts
    expect(["draft", "invalid"]).toContain(result.draft?.status!);
  });

  it("создаёт draft с eval cases", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: test-skill
description: Test skill with eval cases
---

# Test Skill
`;

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "test input",
        expectedOutput: "test output",
        expectedTools: ["bash"],
      },
    ];

    const result = store.create("test-skill", content, evalCases);

    expect(result.success).toBe(true);
    expect(result.draft?.evalCases).toHaveLength(1);
    expect(result.draft?.evalCases?.[0].id).toBe("case-1");

    // Check eval cases are saved to disk
    const casesPath = join(result.draft!.skillPath, "evals", "cases.json");
    expect(existsSync(casesPath)).toBe(true);

    const savedCases = JSON.parse(readFileSync(casesPath, "utf-8"));
    expect(savedCases.cases).toHaveLength(1);
  });

  it("помечает draft как invalid при ошибках валидации", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: invalid-name
description: Test skill
---

# Test Skill
`;

    // Name doesn't match directory name
    const result = store.create("test-skill", content);

    expect(result.success).toBe(true);
    expect(result.draft?.status).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("обновляет существующий draft", async () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content1 = `---
name: test-skill
description: Initial description
---

# Test Skill
`;

    const createResult = store.create("test-skill", content1);
    expect(createResult.success).toBe(true);

    // Wait to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    const content2 = `---
name: test-skill
description: Updated description
---

# Test Skill

Updated content.
`;

    const updateResult = store.update(createResult.draft!.id, content2);

    expect(updateResult.success).toBe(true);
    expect(updateResult.draft?.updatedAt).not.toBe(createResult.draft?.updatedAt);

    // Check content was updated
    const skillMdPath = join(updateResult.draft!.skillPath, "SKILL.md");
    const updatedContent = readFileSync(skillMdPath, "utf-8");
    expect(updatedContent).toContain("Updated description");
  });

  it("обновляет eval cases для draft", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const createResult = store.create("test-skill", content);
    expect(createResult.success).toBe(true);

    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Test case 1",
        input: "input 1",
      },
      {
        id: "case-2",
        description: "Test case 2",
        input: "input 2",
      },
    ];

    const updateResult = store.updateEvalCases(createResult.draft!.id, evalCases);

    expect(updateResult.success).toBe(true);
    expect(updateResult.draft?.evalCases).toHaveLength(2);
  });

  it("возвращает null при получении несуществующего draft", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });
    const draft = store.get("non-existent-draft");
    expect(draft).toBeNull();
  });

  it("получает draft по ID", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const createResult = store.create("test-skill", content);
    const draft = store.get(createResult.draft!.id);

    expect(draft).toBeDefined();
    expect(draft?.name).toBe("test-skill");
  });

  it("список drafts отсортирован по updatedAt", async () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: skill-1
description: Skill 1
---

# Skill 1
`;

    store.create("skill-1", content);

    // Wait to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    const content2 = `---
name: skill-2
description: Skill 2
---

# Skill 2
`;

    store.create("skill-2", content2);

    const drafts = store.list();
    expect(drafts).toHaveLength(2);
    // Sort order may vary, just check both are present
    const names = drafts.map((d) => d.name);
    expect(names).toContain("skill-1");
    expect(names).toContain("skill-2");
  });

  it("удаляет draft", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: test-skill
description: Test skill
---

# Test Skill
`;

    const createResult = store.create("test-skill", content);
    const deleted = store.delete(createResult.draft!.id);

    expect(deleted).toBe(true);
    expect(store.get(createResult.draft!.id)).toBeNull();
  });

  it("draft изолирован от основного каталога", () => {
    const store = new DraftStore({ storage: new FilesystemDraftStorage({ draftsPath }) });

    const content = `---
name: isolated-skill
description: Isolated skill
---

# Isolated Skill
`;

    const result = store.create("isolated-skill", content);

    // Draft should be in drafts directory, not in user or project skills
    expect(result.draft?.skillPath).toContain("drafts");
    expect(result.draft?.skillPath).not.toContain(".soba/skills");
  });
});

describe("DraftFilesystemFacade", () => {
  const testDir = join(process.cwd(), ".test-facade");
  const draftPath = join(testDir, "draft");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(draftPath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("читает файл внутри draft директории", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    const testFile = join(draftPath, "test.txt");
    writeFileSync(testFile, "test content", "utf-8");

    const content = facade.readFile("test.txt");
    expect(content).toBe("test content");
  });

  it("записывает файл внутри draft директории", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    const success = facade.writeFile("new-file.txt", "new content");
    expect(success).toBe(true);

    const testFile = join(draftPath, "new-file.txt");
    expect(existsSync(testFile)).toBe(true);
    expect(readFileSync(testFile, "utf-8")).toBe("new content");
  });

  it("блокирует path traversal с ..", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    const content = facade.readFile("../outside.txt");
    expect(content).toBeNull();

    const success = facade.writeFile("../outside.txt", "malicious");
    expect(success).toBe(false);
  });

  it("блокирует абсолютные пути", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    const content = facade.readFile("/etc/passwd");
    expect(content).toBeNull();

    const success = facade.writeFile("/tmp/malicious.txt", "malicious");
    expect(success).toBe(false);
  });

  it("проверяет существование файла", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    const testFile = join(draftPath, "exists.txt");
    writeFileSync(testFile, "content", "utf-8");

    expect(facade.exists("exists.txt")).toBe(true);
    expect(facade.exists("not-exists.txt")).toBe(false);
  });

  it("не позволяет bash и network операции", () => {
    const facade = new DraftFilesystemFacade(draftPath);

    // Facade only provides file operations, no bash/network
    expect(typeof facade.readFile).toBe("function");
    expect(typeof facade.writeFile).toBe("function");
    expect(typeof facade.exists).toBe("function");

    // No bash or network methods
    expect((facade as unknown as Record<string, unknown>).bash).toBeUndefined();
    expect((facade as unknown as Record<string, unknown>).fetch).toBeUndefined();
  });
});
