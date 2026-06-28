import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface McpOAuthTokenRecord {
  projectRoot: string;
  serverId: string;
  issuer: string;
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
  refreshToken?: string;
  scope?: string;
  updatedAt: string;
}

export interface McpOAuthTokenStoreOptions {
  path?: string;
  homeDir?: string;
}

interface StoredTokenFile {
  version: 1;
  tokens: Record<string, McpOAuthTokenRecord>;
}

const TOKEN_STORE_VERSION = 1;

export class McpOAuthTokenStore {
  readonly path: string;

  constructor(options: McpOAuthTokenStoreOptions = {}) {
    this.path = options.path ?? getDefaultMcpOAuthTokenStorePath(options.homeDir);
  }

  async save(record: McpOAuthTokenRecord): Promise<void> {
    const file = await this.readFile();
    file.tokens[tokenRecordKey(record.projectRoot, record.serverId, record.issuer)] = {
      ...record,
      projectRoot: resolve(record.projectRoot),
    };
    await this.writeFile(file);
  }

  async load(projectRoot: string, serverId: string, issuer: string): Promise<McpOAuthTokenRecord | null> {
    const file = await this.readFile();
    return file.tokens[tokenRecordKey(projectRoot, serverId, issuer)] ?? null;
  }

  async delete(projectRoot: string, serverId: string, issuer: string): Promise<void> {
    const file = await this.readFile();
    delete file.tokens[tokenRecordKey(projectRoot, serverId, issuer)];
    await this.writeFile(file);
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

  private async readFile(): Promise<StoredTokenFile> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      if (!isStoredTokenFile(raw)) {
        return emptyTokenFile();
      }

      return raw;
    } catch {
      return emptyTokenFile();
    }
  }

  private async writeFile(file: StoredTokenFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
    });

    if (process.platform !== "win32") {
      await chmod(this.path, 0o600);
    }
  }
}

export function getDefaultMcpOAuthTokenStorePath(homeDir = homedir()): string {
  return join(homeDir, ".soba", "mcp-oauth-tokens.json");
}

export function tokenRecordKey(projectRoot: string, serverId: string, issuer: string): string {
  const hash = createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 24);
  return `${hash}:${serverId}:${issuer}`;
}

export function recordFromTokenSet(options: {
  projectRoot: string;
  serverId: string;
  issuer: string;
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  now?: number;
}): McpOAuthTokenRecord {
  const now = options.now ?? Date.now();

  return {
    projectRoot: resolve(options.projectRoot),
    serverId: options.serverId,
    issuer: options.issuer,
    accessToken: options.accessToken,
    tokenType: options.tokenType ?? "Bearer",
    expiresAt: options.expiresIn === undefined ? null : now + options.expiresIn * 1000,
    refreshToken: options.refreshToken,
    scope: options.scope,
    updatedAt: new Date(now).toISOString(),
  };
}

function emptyTokenFile(): StoredTokenFile {
  return {
    version: TOKEN_STORE_VERSION,
    tokens: {},
  };
}

function isStoredTokenFile(value: unknown): value is StoredTokenFile {
  if (!isRecord(value) || value.version !== TOKEN_STORE_VERSION || !isRecord(value.tokens)) {
    return false;
  }

  return Object.values(value.tokens).every(isTokenRecord);
}

function isTokenRecord(value: unknown): value is McpOAuthTokenRecord {
  return (
    isRecord(value) &&
    typeof value.projectRoot === "string" &&
    typeof value.serverId === "string" &&
    typeof value.issuer === "string" &&
    typeof value.accessToken === "string" &&
    typeof value.tokenType === "string" &&
    (typeof value.expiresAt === "number" || value.expiresAt === null) &&
    (value.refreshToken === undefined || typeof value.refreshToken === "string") &&
    (value.scope === undefined || typeof value.scope === "string") &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
