import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MCP_SECRET_STORE_VERSION = 1;
const ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface McpSecretStoreOptions {
  path?: string;
  homeDir?: string;
}

interface StoredSecretFile {
  version: 1;
  secrets: Record<string, string>;
}

export class McpSecretStore {
  readonly path: string;

  constructor(options: McpSecretStoreOptions = {}) {
    this.path = options.path ?? getDefaultMcpSecretStorePath(options.homeDir);
  }

  async get(name: string): Promise<string | null> {
    assertValidMcpSecretName(name);
    const file = await this.readFile();
    const value = file.secrets[name];
    return value && value.length > 0 ? value : null;
  }

  async set(name: string, value: string): Promise<void> {
    assertValidMcpSecretName(name);
    if (value.length === 0) {
      throw new McpSecretStoreError("empty_secret", "MCP secret value must be non-empty.");
    }

    const file = await this.readFile();
    file.secrets[name] = value;
    await this.writeFile(file);
  }

  async delete(name: string): Promise<boolean> {
    assertValidMcpSecretName(name);
    const file = await this.readFile();
    const existed = Object.hasOwn(file.secrets, name);
    delete file.secrets[name];
    await this.writeFile(file);
    return existed;
  }

  async listNames(): Promise<string[]> {
    const file = await this.readFile();
    return Object.keys(file.secrets).sort((a, b) => a.localeCompare(b));
  }

  async env(baseEnv: Record<string, string | undefined> = process.env): Promise<Record<string, string | undefined>> {
    const file = await this.readFile();
    return mergeMcpSecretEnv(baseEnv, file.secrets);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }

  async permissions(): Promise<number | null> {
    if (process.platform === "win32") {
      return null;
    }

    try {
      const info = await stat(this.path);
      return info.mode & 0o777;
    } catch {
      return null;
    }
  }

  private async readFile(): Promise<StoredSecretFile> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      if (!isStoredSecretFile(raw)) {
        return emptySecretFile();
      }

      return raw;
    } catch {
      return emptySecretFile();
    }
  }

  private async writeFile(file: StoredSecretFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
    });

    if (process.platform !== "win32") {
      await chmod(this.path, 0o600);
    }
  }
}

export class McpSecretStoreError extends Error {
  readonly code: "invalid_name" | "empty_secret";

  constructor(code: "invalid_name" | "empty_secret", message: string) {
    super(message);
    this.name = "McpSecretStoreError";
    this.code = code;
  }
}

export function getDefaultMcpSecretStorePath(homeDir = homedir()): string {
  return join(homeDir, ".soba", "mcp-secrets.json");
}

export function mergeMcpSecretEnv(
  baseEnv: Record<string, string | undefined>,
  secrets: Record<string, string>,
): Record<string, string | undefined> {
  return {
    ...secrets,
    ...baseEnv,
  };
}

export function assertValidMcpSecretName(name: string): void {
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new McpSecretStoreError("invalid_name", "MCP secret name must be a valid environment variable name.");
  }
}

function emptySecretFile(): StoredSecretFile {
  return {
    version: MCP_SECRET_STORE_VERSION,
    secrets: {},
  };
}

function isStoredSecretFile(value: unknown): value is StoredSecretFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.version !== MCP_SECRET_STORE_VERSION || typeof record.secrets !== "object" || record.secrets === null || Array.isArray(record.secrets)) {
    return false;
  }

  return Object.values(record.secrets).every((entry) => typeof entry === "string");
}
