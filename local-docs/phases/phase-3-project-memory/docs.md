# Phase 3 — Техническая документация

**Версия:** SOBA 0.4.0

---

## 1. Project Memory

### 1.1. Структура файлов

```
.soba/memory/
├── knowledge/
│   ├── architecture.md      — Ключевые архитектурные решения
│   ├── conventions.md       — Стиль кода, нейминг, паттерны
│   ├── known-errors.md      — Известные ошибки и их фиксы
│   └── dependencies.md      — Критические зависимости и версии
├── capsules/
│   ├── index.json           — Индекс с метаданными всех капсул
│   ├── capsule_{id}.json    — Отдельная капсула
│   └── index.json           — Метаданные (createdAt, count, version)
├── graph/
│   └── graph.json           — Граф сущностей проекта
└── config.json              — Конфигурация памяти (maxCapsules, budgetTokens)
```

### 1.2. Формат файлов

#### knowledge/*.md

```markdown
---
version: 1
updated: 2026-06-14
source: user|agent|auto
---

# Заголовок файла

Содержимое...
```

#### capsules/index.json

```json
{
  "version": 1,
  "capsules": [
    {
      "id": "capsule_a1b2c3",
      "type": "fix",
      "priority": "high",
      "tags": ["session-manager", "race-condition"],
      "summary": "Race condition в SessionManager.read() — фикс мьютексом",
      "createdAt": 1718352000000,
      "updatedAt": 1718352000000
    }
  ]
}
```

#### capsules/capsule_{id}.json

```json
{
  "id": "capsule_a1b2c3",
  "type": "fix",
  "priority": "high",
  "tags": ["session-manager", "race-condition"],
  "summary": "Race condition в SessionManager.read()",
  "content": "При параллельном read/write сессии возникает race condition.\nФикс: добавить Mutex в SessionManager.read()\n- Использовать lock/unlock вокруг fs.readFile\n- Заменить Promise.all на последовательные вызовы",
  "createdAt": 1718352000000,
  "updatedAt": 1718352000000,
  "source": {
    "tool": "write_project_memory",
    "turn": 42
  }
}
```

#### graph/graph.json

```json
{
  "version": 1,
  "nodes": [
    { "id": "n1", "type": "file", "name": "src/core/session-manager.ts", "metadata": { "lines": 210 } },
    { "id": "n2", "type": "class", "name": "SessionManager", "metadata": { "file": "src/core/session-manager.ts" } },
    { "id": "n3", "type": "error", "name": "RaceCondition", "metadata": { "severity": "critical" } }
  ],
  "edges": [
    { "from": "n2", "to": "n1", "type": "contains" },
    { "from": "n3", "to": "n2", "type": "affects" }
  ]
}
```

#### config.json

```json
{
  "maxCapsules": 100,
  "pruneThresholdDays": 30,
  "prunePriority": ["low", "medium"],
  "injectorBudgetTokens": 2000,
  "injectorMaxCapsules": 10,
  "knowledgeMaxTokens": 1000
}
```

### 1.3. API

```typescript
// src/core/memory/types.ts

interface MemoryCapsule {
  id: string;
  type: "decision" | "fix" | "insight" | "dependency" | "warning";
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  summary: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  source?: { tool: string; turn: number };
}

interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "module" | "error" | "dependency";
  name: string;
  metadata: Record<string, string>;
}

interface GraphEdge {
  from: string;
  to: string;
  type: "depends_on" | "contains" | "fixes" | "related_to" | "imports";
}

interface KnowledgeFile {
  name: string;
  path: string;
  content: string;
  version: number;
  updated: string;
  tokenCount: number;
}

interface ProjectMemoryConfig {
  maxCapsules: number;
  pruneThresholdDays: number;
  prunePriority: MemoryCapsule["priority"][];
  injectorBudgetTokens: number;
  injectorMaxCapsules: number;
  knowledgeMaxTokens: number;
}

interface ProjectMemory {
  readonly config: ProjectMemoryConfig;

  init(): Promise<void>;
  load(): Promise<void>;
  save(): Promise<void>;

  getKnowledgeFile(name: string): KnowledgeFile | undefined;
  getKnowledgeFiles(): KnowledgeFile[];
  writeKnowledgeFile(name: string, content: string): Promise<void>;

  getCapsule(id: string): MemoryCapsule | undefined;
  getRelevantCapsules(context: { tags?: string; priority?: string; limit?: number }): MemoryCapsule[];
  addCapsule(capsule: Omit<MemoryCapsule, "id" | "createdAt" | "updatedAt">): Promise<void>;
  updateCapsule(id: string, updates: Partial<MemoryCapsule>): Promise<void>;
  deleteCapsule(id: string): Promise<void>;
  pruneCapsules(): Promise<number>;

  getNode(id: string): GraphNode | undefined;
  addNode(node: Omit<GraphNode, "id">): string;
  addEdge(from: string, to: string, type: GraphEdge["type"]): void;
  getNeighbors(nodeId: string): GraphNode[];

  formatForPrompt(budgetTokens?: number): { knowledge: string; capsules: string };
  estimateTotalTokens(): number;

  resetMemory(): Promise<void>;
}
```

### 1.4. MemoryInjector

```typescript
// src/core/memory/injector.ts

/**
 * Формирует секции <project_knowledge> и <project_memory>
 * для включения в system prompt.
 */
class MemoryInjector {
  constructor(private memory: ProjectMemory) {}

  buildMemoryBlock(): string {
    const { knowledge, capsules } = this.memory.formatForPrompt(
      this.memory.config.injectorBudgetTokens,
    );

    let result = "";

    if (knowledge) {
      result += `<project_knowledge>\n${knowledge}\n</project_knowledge>\n`;
    }

    if (capsules) {
      result += `<project_memory>\n${capsules}\n</project_memory>\n`;
    }

    return result;
  }
}
```

### 1.5. Memory Tools

```typescript
// src/core/memory/tools.ts

const readProjectMemoryTool: ToolDefinition = {
  name: "read_project_memory",
  description: "Read project knowledge or memory capsules",
  arguments: {
    type: "object",
    properties: {
      source: {
        type: "string",
        enum: ["knowledge", "capsules", "graph"],
        description: "What to read",
      },
      filter: {
        type: "object",
        properties: {
          name: { type: "string", description: "Knowledge file name (for source=knowledge)" },
          tags: { type: "string", description: "Filter capsules by tags (comma-separated)" },
          type: { type: "string", enum: ["decision", "fix", "insight", "dependency", "warning"] },
          entityId: { type: "string", description: "Graph node ID" },
        },
      },
    },
    required: ["source"],
  },
};

const writeProjectMemoryTool: ToolDefinition = {
  name: "write_project_memory",
  description: "Write a memory capsule to project memory",
  arguments: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["decision", "fix", "insight", "dependency", "warning"] },
      priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
      tags: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      content: { type: "string" },
    },
    required: ["type", "priority", "summary", "content"],
  },
};
```

### 1.6. Auto-Extractor

```typescript
// src/core/memory/auto-extractor.ts

/**
 * Автоматически создаёт капсулы из действий агента.
 */
class AutoExtractor {
  constructor(private memory: ProjectMemory) {}

  /**
   * Создать капсулу из результата Fix-Until-Green.
   */
  async fromFixUntilGreen(fixResult: FixResult, context: { file: string; error: string }): Promise<void> {
    if (!fixResult.success) return;

    await this.memory.addCapsule({
      type: "fix",
      priority: fixResult.attempts.length > 2 ? "high" : "medium",
      tags: [context.file, extractTypeFromError(context.error)],
      summary: `Fix: ${context.error.slice(0, 100)}`,
      content: formatFixContent(fixResult, context),
      source: { tool: "fix_until_green", turn: 0 },
    });
  }

  /**
   * Создать капсулу из write_project_memory tool.
   */
  async fromToolWrite(capsule: Omit<MemoryCapsule, "id" | "createdAt" | "updatedAt">): Promise<void> {
    await this.memory.addCapsule(capsule);
  }
}
```

### 1.7. Инициализация

```typescript
// src/core/memory/init.ts

async function initProjectMemory(basePath: string): Promise<ProjectMemory> {
  const memoryPath = path.join(basePath, ".soba", "memory");

  // Создать структуру директорий
  await fs.mkdir(path.join(memoryPath, "knowledge"), { recursive: true });
  await fs.mkdir(path.join(memoryPath, "capsules"), { recursive: true });
  await fs.mkdir(path.join(memoryPath, "graph"), { recursive: true });

  // Создать шаблоны knowledge-файлов, если их нет
  const templates = {
    "architecture.md": `---
version: 1
updated: ${new Date().toISOString().split("T")[0]}
source: user
---

# Архитектура проекта\n\n<!-- Опишите ключевые архитектурные решения -->\n`,
    "conventions.md": `---
version: 1
updated: ${new Date().toISOString().split("T")[0]}
source: user
---

# Конвенции кода\n\n<!-- Опишите стиль кода, нейминг, паттерны -->\n`,
    "known-errors.md": `---
version: 1
updated: ${new Date().toISOString().split("T")[0]}
source: auto
---

# Известные ошибки\n\n<!-- Автоматически заполняется из Fix-Until-Green -->\n`,
    "dependencies.md": `---
version: 1
updated: ${new Date().toISOString().split("T")[0]}
source: user
---

# Зависимости\n\n<!-- Критические зависимости и версии -->\n`,
  };

  for (const [name, content] of Object.entries(templates)) {
    const filePath = path.join(memoryPath, "knowledge", name);
    if (!await fs.exists(filePath)) {
      await fs.writeFile(filePath, content);
    }
  }

  // Создать capsules/index.json, если нет
  const indexFile = path.join(memoryPath, "capsules", "index.json");
  if (!await fs.exists(indexFile)) {
    await fs.writeFile(indexFile, JSON.stringify({ version: 1, capsules: [] }));
  }

  // Создать graph/graph.json, если нет
  const graphFile = path.join(memoryPath, "graph", "graph.json");
  if (!await fs.exists(graphFile)) {
    await fs.writeFile(graphFile, JSON.stringify({ version: 1, nodes: [], edges: [] }));
  }

  // Создать config.json, если нет
  const configFile = path.join(memoryPath, "config.json");
  if (!await fs.exists(configFile)) {
    const defaultConfig: ProjectMemoryConfig = {
      maxCapsules: 100,
      pruneThresholdDays: 30,
      prunePriority: ["low", "medium"],
      injectorBudgetTokens: 2000,
      injectorMaxCapsules: 10,
      knowledgeMaxTokens: 1000,
    };
    await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2));
  }

  // Загрузить и вернуть инстанс
  const memory = new ProjectMemoryImpl(memoryPath);
  await memory.load();
  return memory;
}
```

### 1.8. Интеграция с BuildSystemPrompt

```typescript
// В src/core/prompt/prompt.ts

function buildSystemPrompt(config: SystemPromptConfig): string {
  const baseParts = [
    loadSystemPrompt(),        // Основной SYSTEM.md
    buildProjectContext(),     // Текущий проект
    buildSkillPrompts(),       // Активные скилы
  ];

  // Phase 3: Project Memory
  if (config.useProjectMemory) {
    const memoryBlock = config.memoryInjector.buildMemoryBlock();
    if (memoryBlock) {
      baseParts.push(memoryBlock);
    }
  }

  return baseParts.join("\n\n");
}
```

### 1.9. Pruning

- CapsuleStore.prune() вызывается:
  - При save(), если capsules.count > maxCapsules * 0.9
  - При addCapsule(), если capsules.count >= maxCapsules
- Удаляет capsules:
  - priority === "low" || priority === "medium"
  - CreatedAt > pruneThresholdDays назад
  - Сортировка по updatedAt (старые удаляются первыми)
- critical капсулы не удаляются никогда
- high капсулы не удаляются, если им < 7 дней

### 1.10. Relevance

CapsuleStore.getRelevant() ранжирует капсулы:

1. Прямое совпадение tags (вес 3x)
2. Частичное совпадение tags (вес 2x)
3. priority: critical > high > medium > low (вес 2x, 1.5x, 1x, 0.5x)
4. Recency (линейное затухание за 30 дней)
5. Суммарный score → топ-N по запрошенному limit

---

## 2. Entity Graph

### 2.1. API

```typescript
class EntityGraph {
  private nodes: Map<string, GraphNode>;
  private edges: GraphEdge[];

  addNode(node: Omit<GraphNode, "id">): string;
  getNode(id: string): GraphNode | undefined;
  updateNode(id: string, updates: Partial<GraphNode>): void;
  deleteNode(id: string): void;
  findNodes(filter: { type?: string; name?: string }): GraphNode[];

  addEdge(from: string, to: string, type: GraphEdge["type"]): void;
  getEdges(nodeId: string): GraphEdge[];
  getNeighbors(nodeId: string, edgeType?: string): GraphNode[];

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] };
  fromJSON(data: { nodes: GraphNode[]; edges: GraphEdge[] }): void;
}
```

### 2.2. Автоматическое добавление

EntityGraph наполняется:

- Из `write_project_memory` tool — если капсула содержит entity references
- Из файловой системы — при сканировании проекта (опционально)
- Из Fix-Until-Green — ошибки привязываются к affected файлам

---

## 3. Fix-Until-Green

### 3.1. Структура файлов

```
src/core/fix-until-green/
├── types.ts                 — Типы и интерфейсы
├── detector.ts              — CommandDetector
├── detector.test.ts         — Тесты детектора
├── runner.ts                — CommandRunner
├── runner.test.ts           — Тесты раннера
├── diagnostics.ts           — ErrorDiagnostics
├── diagnostics.test.ts      — Тесты диагностики
├── loop.ts                  — FixUntilGreenLoop
├── loop.test.ts             — Тесты лупа
├── parsers/
│   ├── typescript.ts        — TypeScript error parser
│   ├── test.ts              — Test error parser (bun/jest/vitest)
│   ├── lint.ts              — Lint error parser (biome/eslint)
│   └── runtime.ts           — Runtime error parser
└── index.ts                 — Public API
```

### 3.2. Типы

```typescript
// src/core/fix-until-green/types.ts

interface ProjectCommands {
  test: string | null;    // "bun test" | "npm test" | null
  lint: string | null;    // "bun run lint" | "eslint ." | null
  build: string | null;   // "bun run build" | "tsc" | null
}

interface ParsedError {
  type: "typescript" | "test" | "lint" | "runtime";
  file: string;
  line: number;
  column?: number;
  message: string;
  ruleId?: string;
  expected?: string;
  actual?: string;
  stack?: string;
}

interface DiagnosticsResult {
  exitCode: number;
  errors: ParsedError[];
  raw: { stdout: string; stderr: string };
  duration: number;
}

interface FixAttempt {
  attempt: number;
  command: string;
  diagnostics: DiagnosticsResult;
  fixApplied?: string;      // Описание фикса
  timestamp: number;
}

interface FixResult {
  success: boolean;
  attempts: FixAttempt[];
  totalDuration: number;
  totalTokens: number;
  lastError?: string;
  partialFix: boolean;      // true если was progression but not 100%
}

interface FixUntilGreenConfig {
  enabled: boolean;
  maxAttempts: number;      // default: 3
  maxTokens: number;        // default: 5000
  timeoutPerCommand: number; // default: 30s
  includeLint: boolean;     // default: true
  includeBuild: boolean;    // default: false
}

// Events
type FUGEvent =
  | { type: "fug_start"; timestamp: number }
  | { type: "fug_attempt"; attempt: FixAttempt }
  | { type: "fug_progress"; errorsBefore: number; errorsAfter: number }
  | { type: "fug_success"; result: FixResult }
  | { type: "fug_failure"; result: FixResult };
```

### 3.3. CommandDetector

```typescript
// src/core/fix-until-green/detector.ts

class CommandDetector {
  /**
   * Определяет test/lint/build команды для проекта.
   * Сканирует package.json (JS/TS), Cargo.toml (Rust), pyproject.toml (Python),
   * go.mod (Go) и т.д.
   */
  async detect(projectRoot: string): Promise<ProjectCommands> {
    const commands: ProjectCommands = { test: null, lint: null, build: null };

    // JS/TS
    if (await fileExists(path.join(projectRoot, "package.json"))) {
      const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8"));

      if (pkg.scripts?.test) commands.test = `bun run test`;
      else if (pkg.scripts?.test) commands.test = `npm test`;
      else commands.test = null;

      if (pkg.scripts?.lint) commands.lint = `bun run lint`;
      else if (pkg.scripts?.["biome:check"]) commands.lint = `bun run biome:check`;
      else commands.lint = null;

      if (pkg.scripts?.build) commands.build = `bun run build`;
      else commands.build = null;
    }

    // Rust
    if (await fileExists(path.join(projectRoot, "Cargo.toml"))) {
      commands.test = "cargo test";
      commands.build = "cargo build";
      // lint для Rust: cargo clippy
      commands.lint = "cargo clippy -- -D warnings";
    }

    // Python
    if (await fileExists(path.join(projectRoot, "pyproject.toml"))) {
      commands.test = "pytest";
      commands.lint = "ruff check .";
      commands.build = null;
    }

    // Go
    if (await fileExists(path.join(projectRoot, "go.mod"))) {
      commands.test = "go test ./...";
      commands.lint = "golangci-lint run";
      commands.build = "go build ./...";
    }

    return commands;
  }
}
```

### 3.4. ErrorDiagnostics

```typescript
// src/core/fix-until-green/diagnostics.ts

class ErrorDiagnostics {
  private parsers: ErrorParser[];

  constructor() {
    this.parsers = [
      new TypeScriptParser(),
      new TestParser(),
      new LintParser(),
      new RuntimeParser(),
    ];
  }

  async diagnose(command: string, stdout: string, stderr: string, exitCode: number): Promise<DiagnosticsResult> {
    const errors: ParsedError[] = [];

    for (const parser of this.parsers) {
      if (parser.canParse(stderr) || parser.canParse(stdout)) {
        errors.push(...parser.parse(stderr + "\n" + stdout));
      }
    }

    return {
      exitCode,
      errors,
      raw: { stdout, stderr },
      duration: 0, // заполняется в runner
    };
  }
}
```

### 3.5. FixUntilGreenLoop

```typescript
// src/core/fix-until-green/loop.ts

class FixUntilGreenLoop {
  private emitter: EventEmitter;

  constructor(
    private detector: CommandDetector,
    private runner: CommandRunner,
    private diagnostics: ErrorDiagnostics,
    private config: FixUntilGreenConfig,
  ) {
    this.emitter = new EventEmitter();
  }

  on(event: FUGEvent["type"], handler: (e: FUGEvent) => void): void {
    this.emitter.on(event, handler);
  }

  async execute(
    projectRoot: string,
    context: {
      changedFiles: string[];
      provider: OpenAICompatibleProvider;
    },
  ): Promise<FixResult> {
    const commands = await this.detector.detect(projectRoot);

    if (!commands.test && !commands.lint && !commands.build) {
      return {
        success: true,
        attempts: [],
        totalDuration: 0,
        totalTokens: 0,
        partialFix: false,
      };
    }

    this.emitter.emit("fug_start", { type: "fug_start", timestamp: Date.now() });

    const attempts: FixAttempt[] = [];
    const startTime = Date.now();
    let totalTokens = 0;
    let currentErrors: ParsedError[] = [];
    let lastFixDescription: string | undefined;

    for (let i = 0; i < this.config.maxAttempts; i++) {
      const attemptNumber = i + 1;

      // Запуск команд
      const diagnostics = await this.runCommandsInSequence(commands);
      currentErrors = diagnostics.errors;
      totalTokens += estimateTokens(diagnostics.raw);

      const attempt: FixAttempt = {
        attempt: attemptNumber,
        command: commands.test || commands.lint || commands.build || "",
        diagnostics,
        timestamp: Date.now(),
        fixApplied: lastFixDescription,
      };
      attempts.push(attempt);

      // Если нет ошибок → успех
      if (diagnostics.exitCode === 0 && currentErrors.length === 0) {
        this.emitter.emit("fug_success", {
          type: "fug_success",
          result: {
            success: true,
            attempts,
            totalDuration: Date.now() - startTime,
            totalTokens,
            partialFix: false,
          },
        });

        return {
          success: true,
          attempts,
          totalDuration: Date.now() - startTime,
          totalTokens,
          partialFix: false,
        };
      }

      // Проверка прогресса
      if (i > 0 && currentErrors.length >= attempts[i - 1].diagnostics.errors.length) {
        // Нет прогресса — стоп
        break;
      }

      this.emitter.emit("fug_progress", {
        type: "fug_progress",
        errorsBefore: attempts.length > 1 ? attempts[i - 1].diagnostics.errors.length : 0,
        errorsAfter: currentErrors.length,
      });

      // Проверка бюджета
      if (totalTokens >= this.config.maxTokens) {
        break;
      }

      // Генерация фикса через LLM
      const fix = await this.generateFix(currentErrors, context);
      if (!fix) break;

      lastFixDescription = fix.description;
      await this.applyFix(fix);
    }

    // Частичный или полный failure
    const wasPartial = attempts.length > 1 &&
      attempts[attempts.length - 1].diagnostics.errors.length < attempts[0].diagnostics.errors.length;

    this.emitter.emit("fug_failure", {
      type: "fug_failure",
      result: {
        success: false,
        attempts,
        totalDuration: Date.now() - startTime,
        totalTokens,
        lastError: currentErrors[0]?.message,
        partialFix: wasPartial,
      },
    });

    return {
      success: false,
      attempts,
      totalDuration: Date.now() - startTime,
      totalTokens,
      lastError: currentErrors[0]?.message,
      partialFix: wasPartial,
    };
  }

  private async runCommandsInSequence(commands: ProjectCommands): Promise<DiagnosticsResult> {
    const order = [commands.test, commands.lint, commands.build].filter(Boolean) as string[];

    for (const cmd of order) {
      const result = await this.runner.run(cmd, this.config.timeoutPerCommand);
      if (result.exitCode !== 0) {
        return this.diagnostics.diagnose(cmd, result.stdout, result.stderr, result.exitCode);
      }
    }

    // Всё ок
    return {
      exitCode: 0,
      errors: [],
      raw: { stdout: "", stderr: "" },
      duration: 0,
    };
  }

  private async generateFix(errors: ParsedError[], context: { provider: OpenAICompatibleProvider }): Promise<{ description: string; edits: Array<{ file: string; oldText: string; newText: string }> } | null> {
    // LLM генерирует фикс на основе структурированных ошибок
    const prompt = buildFixPrompt(errors, context.changedFiles);
    const response = await context.provider.generate(prompt);
    return parseFixFromResponse(response);
  }

  private async applyFix(fix: { edits: Array<{ file: string; oldText: string; newText: string }> }): Promise<void> {
    for (const edit of fix.edits) {
      await applyEdit(edit.file, edit.oldText, edit.newText);
    }
  }
}
```

### 3.6. Error Parsers

```typescript
// parsers/typescript.ts — TypeScript error parser

class TypeScriptParser implements ErrorParser {
  // TS error format: "src/file.ts:23:5 - error TS2322: Type 'X' is not assignable to type 'Y'"
  private TS_REGEX = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.+)$/gm;

  canParse(output: string): boolean {
    return output.includes("error TS") || output.includes("TS_ERROR");
  }

  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    let match;

    while ((match = this.TS_REGEX.exec(output)) !== null) {
      errors.push({
        type: "typescript",
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        message: match[5],
        ruleId: `TS${match[4]}`,
      });
    }

    return errors;
  }
}

// parsers/test.ts — Test error parser (bun/jest/vitest)

class TestParser implements ErrorParser {
  canParse(output: string): boolean {
    return output.includes("FAIL") || output.includes("failed") || output.includes("AssertionError");
  }

  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];

    // Bun/vitest format: " ❯ src/file.test.ts:42:3"
    const bunFailRe = /❯ (.+?):(\d+):(\d+)/g;
    let match;
    while ((match = bunFailRe.exec(output)) !== null) {
      errors.push({
        type: "test",
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        message: extractFailureMessage(output, match.index),
      });
    }

    // Jest format: "  ● Test Name\n\n    expect(received).toBe(expected)\n\n    Expected: ..."
    const jestFailRe = /● (.+?)\n\n\s+(.+?)\n/g;
    while ((match = jestFailRe.exec(output)) !== null) {
      errors.push({
        type: "test",
        file: match[1],
        line: 0,
        message: match[2],
      });
    }

    return errors;
  }
}
```

### 3.7. Интеграция с Agent Loop

```typescript
// В src/core/loop/agent-loop.ts

async function handleToolResult(tool: ToolResult): Promise<void> {
  const result = await executeTool(tool);

  if (config.fixUntilGreen?.enabled && isModifyingTool(tool)) {
    const fug = new FixUntilGreenLoop(
      new CommandDetector(),
      new CommandRunner(),
      new ErrorDiagnostics(),
      config.fixUntilGreen,
    );

    const fixResult = await fug.execute(projectRoot, {
      changedFiles: getChangedFiles(tool, result),
      provider: activeProvider,
    });

    if (fixResult.success) {
      addSystemMessage("✅ All checks passed after Fix-Until-Green");
    } else if (fixResult.partialFix) {
      addSystemMessage(`⚠ Partial fix: ${fixResult.attempts.length} attempts, remaining: ${fixResult.lastError}`);
    } else {
      addSystemMessage(`🔴 Fix failed: ${fixResult.lastError}`);
    }

    // Auto-extract capsule
    if (projectMemory && fixResult.attempts.length > 0) {
      const extractor = new AutoExtractor(projectMemory);
      await extractor.fromFixUntilGreen(fixResult, {
        file: tool.file || "unknown",
        error: fixResult.lastError || "unknown error",
      });
    }
  }
}
```

### 3.8. Команды

```typescript
export const fixCommands: CommandDefinition[] = [
  {
    name: "/fix on",
    description: "Включить Fix-Until-Green",
    handler: () => { config.fixUntilGreen.enabled = true; },
  },
  {
    name: "/fix off",
    description: "Выключить Fix-Until-Green",
    handler: () => { config.fixUntilGreen.enabled = false; },
  },
  {
    name: "/fix status",
    description: "Показать конфигурацию и статистику",
    handler: () => {
      return {
        enabled: config.fixUntilGreen.enabled,
        maxAttempts: config.fixUntilGreen.maxAttempts,
        maxTokens: config.fixUntilGreen.maxTokens,
      };
    },
  },
];
```

### 3.9. FixUntilGreenConfig

```typescript
const DEFAULT_FIX_CONFIG: FixUntilGreenConfig = {
  enabled: true,
  maxAttempts: 3,
  maxTokens: 5000,
  timeoutPerCommand: 30_000,
  includeLint: true,
  includeBuild: false,
};
```

---

## 4. CI/CD Pipeline

### 4.1. Pre-commit hook

```bash
#!/bin/bash
# .hooks/pre-commit

echo "🔍 Running pre-commit checks..."

# Lint + format
echo "  └─ biome check --write"
bun run biome check --write . || exit 1

# Type check
echo "  └─ tsc --noEmit"
bun run tsc --noEmit || exit 1

# Tests (changed only — optional)
echo "  └─ bun test"
bun test || exit 1

echo "✅ All checks passed"
```

### 4.2. GitHub Actions — CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - run: bun install
      - run: bun run biome check .
      - run: bun test
      - run: bun run build
```

### 4.3. GitHub Actions — Release

```yaml
# .github/workflows/release.yml
name: Release

on:
  workflow_dispatch:
    inputs:
      type:
        description: "Release type"
        required: true
        default: "patch"
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Bump version
        run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          bun run bump-version ${{ github.event.inputs.type }}

      - name: Build binaries
        run: |
          bun run build --target bun-linux-x64
          bun run build --target bun-darwin-x64

      - name: Generate changelog
        run: bun run generate-changelog

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v$(node -p "require('./package.json').version")
          body_path: CHANGELOG.md
          files: |
            dist/soba-linux-x64
            dist/soba-darwin-x64
```

### 4.4. Templates

**PULL_REQUEST_TEMPLATE.md:**

```markdown
## Description

<!-- Краткое описание изменений -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring
- [ ] Documentation
- [ ] CI/CD

## Checklist

- [ ] `bun run lint` — 0 errors
- [ ] `bun test` — all green
- [ ] `bun run build` — passes
- [ ] Tests added for new functionality
- [ ] Documentation updated (if needed)

## Related Issues

Closes #...
```

**ISSUE_TEMPLATE/bug_report.md:**

```markdown
---
name: Bug Report
about: Create a report to help us improve
title: "[BUG] "
labels: bug
---

## Description

<!-- Clear description of the bug -->

## Steps to Reproduce

1. Run `...`
2. See error

## Expected Behavior

<!-- What should happen -->

## Actual Behavior

<!-- What actually happens -->

## Environment

- OS:
- Bun version:
- SOBA version:

## Logs

```
<!-- Relevant logs -->
```

## Additional Context

<!-- Any other context -->
```

**ISSUE_TEMPLATE/feature_request.md:**

```markdown
---
name: Feature Request
about: Suggest an idea for SOBA
title: "[FEATURE] "
labels: enhancement
---

## Problem

<!-- What problem does this solve? -->

## Solution

<!-- What should the feature look like? -->

## Alternatives

<!-- What alternatives have you considered? -->

## Additional Context

<!-- Any other context or screenshots -->
```

---

## 5. Архитектура интеграции

```text
┌─────────────────────────────────────────────────────────┐
│                      Phase 3 Additions                    │
├─────────────────────────────────────────────────────────┤
│  + ProjectMemory          — .soba/memory/ структура      │
│  + MemoryInjector         — инжекция в system prompt     │
│  + MemoryTools            — read/write_project_memory    │
│  + AutoExtractor          — авто-капсулы из FUG          │
│  + FixUntilGreenLoop      — self-healing loop            │
│  + CommandDetector        — определение test/lint/build  │
│  + ErrorDiagnostics       — парсинг ошибок               │
│  + CI/CD                  — hooks, actions, templates    │
├─────────────────────────────────────────────────────────┤
│                      Existing Phase 2                     │
├─────────────────────────────────────────────────────────┤
│  AgentLoop | ContextManager | SkillManager | SessionMgr  │
│  OpenResponsesClient | ProviderAdapter | TrustManager     │
└─────────────────────────────────────────────────────────┘
```

### Взаимодействие компонентов

```text
startup ─→ ProjectMemory.init()
              ├── create .soba/memory/ structure
              ├── load knowledge files
              ├── load capsules index
              ├── load entity graph
              └── ready

session_start ─→ MemoryInjector.buildMemoryBlock()
                   ├── read knowledge files
                   ├── query relevant capsules
                   ├── format as XML blocks
                   └── inject into system prompt

tool_execution ─→ handleToolResult()
                   ├── execute tool
                   ├── if modifying tool && FUG enabled:
                   │     FixUntilGreenLoop.execute()
                   │       ├── CommandDetector.detect()
                   │       ├── run test → diagnostics
                   │       ├── if errors: LLM → fix → repeat
                   │       └── fixResult → AutoExtractor
                   └── return result

session_end ─→ ProjectMemory.save()
                ├── save capsules index
                ├── save entity graph
                └── prune if needed
```

---

## 6. Производительность

| Метрика | Target | Допуск |
|---|---|---|
| ProjectMemory.init() | < 50ms | +30ms |
| MemoryInjector.buildMemoryBlock() | < 20ms | +10ms |
| CapsuleStore.getRelevant (100 caps) | < 10ms | +5ms |
| CommandDetector.detect() | < 20ms (cached) | — |
| ErrorDiagnostics.parse() | < 5ms | +5ms |
| FixUntilGreenLoop.runCommand() | < 30s | +10s (timeout) |
| FixUntilGreenLoop.full cycle (3 att.) | < 90s | +30s |
| CI pipeline (lint + test) | < 2 min | +1 min |

---

## 7. Безопасность

- Memory файлы не содержат API ключей (эксплицитная проверка при addCapsule)
- Fix-Until-Green не запускает команды без таймаута
- CommandDetector не выполняет команды, а только определяет их
- EntityGraph не экспортирует чувствительные данные
- Pruning не удаляет critical капсулы
