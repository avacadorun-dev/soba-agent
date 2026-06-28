import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type ToolSequence, WorkflowObserver } from "../../../src/application/skills/observer";

describe("WorkflowObserver", () => {
  const testDir = join(process.cwd(), ".test-observer");
  const observationsPath = join(testDir, "observations");

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

  it("записывает tool sequence", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit", "bash"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);

    const patterns = observer.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].toolSequence).toEqual(["read", "edit", "bash"]);
    expect(patterns[0].occurrences).toBe(1);
    expect(patterns[0].outcomes.success).toBe(1);
  });

  it("агрегирует повторяющиеся sequences", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);
    observer.recordSequence(sequence);
    observer.recordSequence(sequence);

    const patterns = observer.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(3);
    expect(patterns[0].outcomes.success).toBe(3);
  });

  it("отслеживает разные outcomes", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const tools = ["bash", "read"];

    observer.recordSequence({
      tools,
      outcome: "success",
      timestamp: new Date().toISOString(),
    });

    observer.recordSequence({
      tools,
      outcome: "failure",
      timestamp: new Date().toISOString(),
    });

    observer.recordSequence({
      tools,
      outcome: "partial",
      timestamp: new Date().toISOString(),
    });

    const patterns = observer.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].outcomes.success).toBe(1);
    expect(patterns[0].outcomes.failure).toBe(1);
    expect(patterns[0].outcomes.partial).toBe(1);
  });

  it("возвращает patterns, достигшие threshold", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 3 });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);
    observer.recordSequence(sequence);

    // Not yet at threshold
    let suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(0);

    observer.recordSequence(sequence);

    // Now at threshold
    suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].occurrences).toBe(3);
  });

  it("сортирует suggestions по occurrences", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 2 });

    const seq1: ToolSequence = {
      tools: ["read"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    const seq2: ToolSequence = {
      tools: ["edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(seq1);
    observer.recordSequence(seq1);
    observer.recordSequence(seq1);

    observer.recordSequence(seq2);
    observer.recordSequence(seq2);

    const suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].occurrences).toBe(3); // seq1 first
    expect(suggestions[1].occurrences).toBe(2); // seq2 second
  });

  it("предлагает skill для pattern", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);

    const patterns = observer.getAllPatterns();
    const patternId = patterns[0].patternId;

    const result = observer.suggestSkill(patternId, "my-skill");
    expect(result).toBe(true);

    const updated = observer.getAllPatterns();
    expect(updated[0].suggestedSkillName).toBe("my-skill");
  });

  it("возвращает false для несуществующего pattern", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const result = observer.suggestSkill("non-existent", "my-skill");
    expect(result).toBe(false);
  });

  it("подавляет pattern после rejection", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 2 });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);
    observer.recordSequence(sequence);

    let suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(1);

    const patternId = suggestions[0].patternId;
    observer.suppressPattern(patternId);

    suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(0);
  });

  it("не записывает sequences когда disabled", () => {
    const observer = new WorkflowObserver({ observationsPath });

    observer.setEnabled(false);

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);

    const patterns = observer.getAllPatterns();
    expect(patterns).toHaveLength(0);
  });

  it("проверяет enabled status", () => {
    const observer = new WorkflowObserver({ observationsPath });

    expect(observer.isEnabled()).toBe(true);

    observer.setEnabled(false);
    expect(observer.isEnabled()).toBe(false);

    observer.setEnabled(true);
    expect(observer.isEnabled()).toBe(true);
  });

  it("обновляет threshold", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 3 });

    expect(observer.getConfig().threshold).toBe(3);

    observer.setThreshold(5);
    expect(observer.getConfig().threshold).toBe(5);
  });

  it("очищает все observations", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);
    observer.recordSequence(sequence);

    expect(observer.getAllPatterns()).toHaveLength(1);

    observer.clear();

    expect(observer.getAllPatterns()).toHaveLength(0);
  });

  it("сохраняет patterns на диск", () => {
    const observer1 = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer1.recordSequence(sequence);

    // Create new observer instance
    const observer2 = new WorkflowObserver({ observationsPath });

    const patterns = observer2.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].toolSequence).toEqual(["read", "edit"]);
  });

  it("сохраняет config на диск", () => {
    const observer1 = new WorkflowObserver({ observationsPath });

    observer1.setEnabled(false);
    observer1.setThreshold(10);

    // Create new observer instance
    const observer2 = new WorkflowObserver({ observationsPath });

    expect(observer2.isEnabled()).toBe(false);
    expect(observer2.getConfig().threshold).toBe(10);
  });

  it("хеширует tool sequences для privacy", () => {
    const observer = new WorkflowObserver({ observationsPath });

    const sequence: ToolSequence = {
      tools: ["read", "edit", "bash"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);

    const patterns = observer.getAllPatterns();
    expect(patterns[0].patternId).toBeDefined();
    expect(patterns[0].patternId.length).toBeGreaterThan(0);
    // Pattern ID should be a hash, not the raw sequence
    expect(patterns[0].patternId).not.toBe("read,edit,bash");
  });

  it("использует salt для hashing", () => {
    const observer1 = new WorkflowObserver({ observationsPath });
    const observer2 = new WorkflowObserver({ observationsPath });

    const config1 = observer1.getConfig();
    const config2 = observer2.getConfig();

    // Salts should be different
    expect(config1.salt).not.toBe(config2.salt);
  });

  it("возвращает текущую конфигурацию", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 5 });

    const config = observer.getConfig();

    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(5);
    expect(config.salt).toBeDefined();
  });

  it("не автоматический promotion - только suggestion", () => {
    const observer = new WorkflowObserver({ observationsPath, threshold: 2 });

    const sequence: ToolSequence = {
      tools: ["read", "edit"],
      outcome: "success",
      timestamp: new Date().toISOString(),
    };

    observer.recordSequence(sequence);
    observer.recordSequence(sequence);
    observer.recordSequence(sequence);

    const suggestions = observer.getSuggestedPatterns();
    expect(suggestions).toHaveLength(1);

    // Pattern should not have suggestedSkillName until explicitly suggested
    expect(suggestions[0].suggestedSkillName).toBeUndefined();
  });
});
