import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { KNOWLEDGE_KEYS, type KnowledgeDocument, type KnowledgeKey, type KnowledgeStoreOptions } from "./types";

interface KnowledgeDefinition {
  key: KnowledgeKey;
  filename: string;
  title: string;
  template: string;
}

const KNOWLEDGE_DEFINITIONS: Record<KnowledgeKey, KnowledgeDefinition> = {
  architecture: {
    key: "architecture",
    filename: "architecture.md",
    title: "Architecture",
    template: `# Architecture

Describe the project's architecture, core modules, data flow, and important design constraints.
`,
  },
  conventions: {
    key: "conventions",
    filename: "conventions.md",
    title: "Conventions",
    template: `# Conventions

Document coding conventions, naming rules, test expectations, and project-specific practices.
`,
  },
  "known-errors": {
    key: "known-errors",
    filename: "known-errors.md",
    title: "Known Errors",
    template: `# Known Errors

Record recurring errors, root causes, fixes, and commands that help verify the fix.
`,
  },
  dependencies: {
    key: "dependencies",
    filename: "dependencies.md",
    title: "Dependencies",
    template: `# Dependencies

Track important dependencies, integration notes, runtime constraints, and upgrade caveats.
`,
  },
};

export function isKnowledgeKey(key: string): key is KnowledgeKey {
  return KNOWLEDGE_KEYS.includes(key as KnowledgeKey);
}

export function estimateMarkdownTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export class KnowledgeStore {
  private readonly projectRoot: string;
  private readonly memoryDir: string;
  private readonly knowledgeDir: string;

  constructor(options: KnowledgeStoreOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.memoryDir = resolve(options.memoryDir ?? join(this.projectRoot, ".soba", "memory"));
    this.knowledgeDir = join(this.memoryDir, "knowledge");
  }

  init(): void {
    mkdirSync(this.knowledgeDir, { recursive: true });

    for (const key of KNOWLEDGE_KEYS) {
      const definition = KNOWLEDGE_DEFINITIONS[key];
      const path = this.getPathForKey(key);

      if (!existsSync(path)) {
        writeFileSync(path, definition.template, "utf-8");
      }
    }
  }

  getMemoryDir(): string {
    return this.memoryDir;
  }

  getKnowledgeDir(): string {
    return this.knowledgeDir;
  }

  loadAll(): KnowledgeDocument[] {
    this.init();
    return KNOWLEDGE_KEYS.map((key) => this.read(key));
  }

  read(key: KnowledgeKey): KnowledgeDocument {
    this.init();

    const definition = this.getDefinition(key);
    const path = this.getPathForKey(key);
    const content = readFileSync(path, "utf-8");

    return {
      key: definition.key,
      filename: definition.filename,
      path,
      title: definition.title,
      content,
      estimatedTokens: estimateMarkdownTokens(content),
    };
  }

  write(key: KnowledgeKey, content: string): KnowledgeDocument {
    this.init();

    const path = this.getPathForKey(key);
    writeFileSync(path, content, "utf-8");
    return this.read(key);
  }

  append(key: KnowledgeKey, content: string): KnowledgeDocument {
    const current = this.read(key).content;
    const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";

    return this.write(key, `${current}${separator}${content}`);
  }

  reset(key: KnowledgeKey): KnowledgeDocument {
    const definition = this.getDefinition(key);
    return this.write(key, definition.template);
  }

  exists(key: KnowledgeKey): boolean {
    if (!isKnowledgeKey(key)) {
      return false;
    }

    return existsSync(this.getPathForKey(key));
  }

  estimateTotalTokens(): number {
    return this.loadAll().reduce((sum, document) => sum + document.estimatedTokens, 0);
  }

  formatForPrompt(): string {
    const documents = this.loadAll();
    const sections = documents.map((document) => {
      const content = document.content.trim();
      return `## ${document.filename}\n\n${content}`;
    });

    return `# Project Memory: Knowledge\n\n${sections.join("\n\n")}`;
  }

  private getDefinition(key: KnowledgeKey): KnowledgeDefinition {
    if (!isKnowledgeKey(key)) {
      throw new Error(`Unknown knowledge key: ${String(key)}`);
    }

    return KNOWLEDGE_DEFINITIONS[key];
  }

  private getPathForKey(key: KnowledgeKey): string {
    const definition = this.getDefinition(key);
    const path = resolve(this.knowledgeDir, definition.filename);
    this.assertInsideKnowledgeDir(path);
    return path;
  }

  private assertInsideKnowledgeDir(path: string): void {
    const base = this.resolveExistingOrParent(this.knowledgeDir);
    const targetParent = this.resolveExistingOrParent(dirname(path));
    const target = resolve(targetParent, path.slice(dirname(path).length + 1));
    const relativePath = relative(base, target);

    if (relativePath.startsWith("..") || relativePath === "" || resolve(relativePath) === relativePath) {
      throw new Error(`Knowledge path escapes memory directory: ${path}`);
    }
  }

  private resolveExistingOrParent(path: string): string {
    if (existsSync(path)) {
      return realpathSync(path);
    }

    const parent = dirname(path);
    if (parent === path) {
      return resolve(path);
    }

    return resolve(this.resolveExistingOrParent(parent), path.slice(parent.length + 1));
  }
}
