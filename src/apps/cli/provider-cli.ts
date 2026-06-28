/**
 * `soba provider <subcommand>` — manage custom providers from the CLI.
 *
 * Subcommands:
 *   soba provider list              — list built-in + custom providers
 *   soba provider add <id>          — add a custom provider (flags below)
 *   soba provider remove <id>       — remove a custom provider
 *   soba provider show <id>         — print a provider's full definition
 *   soba provider use <id>          — switch the active selection
 *
 * `add` flags:
 *   --name <name>                   — human-readable name (default = id)
 *   --base-url <url>                — OpenAI-compatible base URL (required)
 *   --api-key-env <ENV_VAR>         — env var name holding the API key
 *                                     (omit / pass `--api-key-env ""` for
 *                                     keyless local servers like Ollama)
 *   --adapter <openai|anthropic>    — adapter id (default: openai)
 *   --default-model <model-id>      — default model id (required)
 *   --model <id=name,contextWindow,maxOutput[,supportsStreaming[,supportsThinking]]>
 *                                    — register a model. Repeat for multiple.
 *                                    The shorthand form accepts up to 5
 *                                    comma-separated fields, in that order.
 *   --from-file <path>              — load full provider JSON from file;
 *                                     mutually exclusive with the flags above
 *   --set-active                    — switch the active selection to this
 *                                     provider's default model after add
 *
 * The module is intentionally a pure function layer over `ProviderRegistry`:
 *   - It accepts a registry and an i18n instance (no hidden globals).
 *   - It returns a `ProviderCliResult` describing the outcome; the caller
 *     in `cli.ts` is responsible for writing to stdout/stderr and setting
 *     the process exit code.
 *   - All human-readable strings flow through i18n keys so the same
 *     messages are reused by the TUI in Phase 2.6.
 *
 * Side effects:
 *   - `add` / `remove` / `use` call `registry.persistConfig()` so the change
 *     survives a restart.
 *
 * Errors:
 *   - Validation errors are thrown as `ProviderCliError` with a stable
 *     `code` so the caller can map them to exit codes and to the right
 *     translation key.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelDefinition, ProviderDefinition } from "../../application/cli/public";
import { I18n, ProviderRegistry } from "../../application/cli/public";

// ─── Public types ───

export type ProviderCliSubcommand = "list" | "add" | "remove" | "show" | "use" | "help" | "-h" | "--help";

export interface ProviderCliOptions {
  /** Pre-parsed positional args after the subcommand (e.g. provider id). */
  positional: string[];
  /** Pre-parsed flags as `--name=foo` or `--name foo`. Repeatable flags accumulate as string[]. */
  flags: Record<string, string | boolean | string[]>;
  /** Working directory for `--from-file`. Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface ProviderCliResult {
  /** Lines to print to stdout, in order. May be empty. */
  stdout: string[];
  /** Lines to print to stderr, in order. */
  stderr: string[];
  /** Process exit code: 0 = ok, 1 = validation error, 2 = persistence error. */
  exitCode: 0 | 1 | 2;
  /** If a subcommand produced side effects (add/remove/use), this flag is true. */
  changed: boolean;
}

export class ProviderCliError extends Error {
  readonly code:
    | "unknown-subcommand"
    | "missing-args"
    | "validation"
    | "duplicate"
    | "builtin-immutable"
    | "unknown-id"
    | "io"
    | "json-parse"
    | "internal";
  constructor(code: ProviderCliError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ProviderCliError";
  }
}

// ─── Entry point ───

/**
 * Execute a `soba provider <sub> [args]` invocation against the given
 * registry. The registry is mutated in-place when the subcommand succeeds
 * (add/remove/use); on failure it is left untouched.
 */
export async function runProviderCli(
  subcommand: string | undefined,
  options: ProviderCliOptions,
  registry: ProviderRegistry,
  i18n: I18n,
): Promise<ProviderCliResult> {
  const t = (key: string, vars?: Record<string, string | number>): string => i18n.t(key, vars);
  const sub = (subcommand ?? "help").toLowerCase() as ProviderCliSubcommand;
  try {
    switch (sub) {
      case "list":
        return handleList(registry, t);
      case "add":
        return await handleAdd(options, registry, t);
      case "remove":
        return await handleRemove(options, registry, t);
      case "show":
        return handleShow(options, registry, t);
      case "use":
        return await handleUse(options, registry, t);
      case "help":
      case "-h":
      case "--help":
        return { stdout: [providerHelp(t)], stderr: [], exitCode: 0, changed: false };
      default:
        throw new ProviderCliError(
          "unknown-subcommand",
          t("cli.provider.error.unknownSubcommand", { subcommand: String(subcommand) }),
        );
    }
  } catch (err) {
    if (err instanceof ProviderCliError) {
      return { stdout: [], stderr: [err.message], exitCode: err.code === "io" ? 2 : 1, changed: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: [],
      stderr: [t("cli.provider.error.internal", { error: message })],
      exitCode: 1,
      changed: false,
    };
  }
}

// ─── Subcommand handlers ───

function handleList(registry: ProviderRegistry, t: (k: string, v?: Record<string, string | number>) => string): ProviderCliResult {
  const providers = registry.getAllProviders();
  const active = registry.getActiveProvider();
  const activeModel = registry.getActiveModel();
  const lines: string[] = [t("cli.provider.list.title", { active: active.name, model: activeModel.name })];
  for (const p of providers) {
    const tag = p.custom ? t("cli.provider.list.tagCustom") : t("cli.provider.list.tagBuiltin");
    const defaultMark = p.id === active.id ? t("cli.provider.list.tagActive") : "";
    const modelsForStars = p.models && p.models.length > 0
      ? p.models
      : (p.defaultModel ? [p.defaultModel] : []);
    const stars = modelsForStars.map((m) => (typeof m === "string" ? m : m.id))
      .map((id) => (id === p.defaultModel ? `*${id}` : id)).join(", ");
    lines.push(t("cli.provider.list.row", {
      tag,
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKeyEnv: p.apiKeyEnv ?? t("cli.provider.list.keyless"),
      models: stars,
      active: defaultMark,
    }));
  }
  return { stdout: lines, stderr: [], exitCode: 0, changed: false };
}

function handleShow(
  options: ProviderCliOptions,
  registry: ProviderRegistry,
  t: (k: string, v?: Record<string, string | number>) => string,
): ProviderCliResult {
  const id = options.positional[0];
  if (!id) throw new ProviderCliError("missing-args", t("cli.provider.error.missingId", { sub: "show" }));
  const provider = registry.getProvider(id);
  if (!provider) throw new ProviderCliError("unknown-id", t("cli.provider.error.unknownId", { id }));
  return { stdout: [JSON.stringify(provider, null, 2)], stderr: [], exitCode: 0, changed: false };
}

async function handleAdd(
  options: ProviderCliOptions,
  registry: ProviderRegistry,
  t: (k: string, v?: Record<string, string | number>) => string,
): Promise<ProviderCliResult> {
  // Resolve the id up front so we can reject duplicate-id errors before
  // running more expensive validation (file read, model parse, etc.).
  // This matches the user mental model: "the id is wrong" should not
  // require specifying a base-url or models first.
  const requestedId = options.positional[0];
  if (!requestedId && !stringFlag(options.flags, "from-file")) {
    throw new ProviderCliError("missing-args", t("cli.provider.error.missingId", { sub: "add" }));
  }
  if (requestedId && registry.getProvider(requestedId)) {
    throw new ProviderCliError(
      "duplicate",
      t("cli.provider.error.duplicate", { id: requestedId }),
    );
  }
  const fromFile = stringFlag(options.flags, "from-file");
  let definition: ProviderDefinition;
  if (fromFile) {
    definition = loadProviderFromFile(fromFile, options.cwd ?? process.cwd(), t);
  } else {
    if (!requestedId) {
      throw new ProviderCliError("missing-args", t("cli.provider.error.missingId", { sub: "add" }));
    }
    definition = buildProviderFromFlags(requestedId, options, t);
  }
  // Re-check after we have a definitive id (--from-file could declare a
  // different id than the positional one).
  if (registry.getProvider(definition.id)) {
    throw new ProviderCliError(
      "duplicate",
      t("cli.provider.error.duplicate", { id: definition.id }),
    );
  }
  registry.addProvider(definition);
  // Persist: keep the message and exit code aligned with persistConfig's
  // behavior — the registry never throws on persist, but the call can
  // still fail in pathological FS conditions, so we wrap defensively.
  try {
    await registry.persistConfig();
  } catch (err) {
    // Roll back the in-memory addition so the user can retry cleanly.
    registry.removeProvider(definition.id);
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderCliError("io", t("cli.provider.error.persistFailed", { error: message }));
  }
  // Activate on request.
  if (booleanFlag(options.flags, "set-active")) {
    const switched = registry.switchModel(definition.id, definition.defaultModel ?? "");
    if (!switched) {
      // Should not happen — we just added it — but fail loudly if it does.
      throw new ProviderCliError(
        "internal",
        t("cli.provider.error.internal", { error: "switchModel returned false after addProvider" }),
      );
    }
    await registry.persistConfig();
  }
  return {
    stdout: [t("cli.provider.add.added", { id: definition.id, name: definition.name })],
    stderr: [],
    exitCode: 0,
    changed: true,
  };
}

async function handleRemove(
  options: ProviderCliOptions,
  registry: ProviderRegistry,
  t: (k: string, v?: Record<string, string | number>) => string,
): Promise<ProviderCliResult> {
  const id = options.positional[0];
  if (!id) throw new ProviderCliError("missing-args", t("cli.provider.error.missingId", { sub: "remove" }));
  const provider = registry.getProvider(id);
  if (!provider) throw new ProviderCliError("unknown-id", t("cli.provider.error.unknownId", { id }));
  if (!provider.custom) {
    throw new ProviderCliError(
      "builtin-immutable",
      t("cli.provider.error.builtinImmutable", { id }),
    );
  }
  const removed = registry.removeProvider(id);
  if (!removed) {
    // Race condition: provider was removed between getProvider and remove.
    throw new ProviderCliError("unknown-id", t("cli.provider.error.unknownId", { id }));
  }
  try {
    await registry.persistConfig();
  } catch (err) {
    // Re-add to keep the registry consistent with the user's intent.
    registry.addProvider(provider);
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderCliError("io", t("cli.provider.error.persistFailed", { error: message }));
  }
  return {
    stdout: [t("cli.provider.remove.removed", { id })],
    stderr: [],
    exitCode: 0,
    changed: true,
  };
}

async function handleUse(
  options: ProviderCliOptions,
  registry: ProviderRegistry,
  t: (k: string, v?: Record<string, string | number>) => string,
): Promise<ProviderCliResult> {
  const id = options.positional[0];
  if (!id) throw new ProviderCliError("missing-args", t("cli.provider.error.missingId", { sub: "use" }));
  const provider = registry.getProvider(id);
  if (!provider) throw new ProviderCliError("unknown-id", t("cli.provider.error.unknownId", { id: id! }));
  const modelId = provider.defaultModel ?? "";
  const switched = registry.switchModel(id!, modelId);
  if (!switched && modelId) {
    throw new ProviderCliError(
      "internal",
      t("cli.provider.error.internal", { error: `switchModel returned false for ${id}/${modelId}` }),
    );
  }
  try {
    await registry.persistConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderCliError("io", t("cli.provider.error.persistFailed", { error: message }));
  }
  return {
    stdout: [
      modelId
        ? t("cli.provider.use.switched", { id: id!, model: modelId })
        : t("cli.provider.use.switchedNoModel", { id: id! }),
    ],
    stderr: [],
    exitCode: 0,
    changed: true,
  };
}

// ─── Helpers ───

function stringFlag(flags: Record<string, string | boolean | string[]>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function booleanFlag(flags: Record<string, string | boolean | string[]>, name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

function buildProviderFromFlags(
  id: string,
  options: ProviderCliOptions,
  t: (k: string, v?: Record<string, string | number>) => string,
): ProviderDefinition {
  const name = stringFlag(options.flags, "name") ?? id;
  const baseUrl = stringFlag(options.flags, "base-url");
  if (!baseUrl) {
    throw new ProviderCliError("validation", t("cli.provider.error.missingBaseUrl", { id }));
  }
  const apiKeyEnvRaw = stringFlag(options.flags, "api-key-env");
  // Treat an empty string the same as "no env var" so users can opt into
  // keyless servers without resorting to --api-key-env=none.
  const apiKeyEnv = apiKeyEnvRaw && apiKeyEnvRaw.length > 0 ? apiKeyEnvRaw : null;
  const adapterRaw = stringFlag(options.flags, "adapter") ?? "openai";
  if (adapterRaw !== "openai" && adapterRaw !== "anthropic") {
    throw new ProviderCliError(
      "validation",
      t("cli.provider.error.invalidAdapter", { adapter: adapterRaw }),
    );
  }
  const adapter = adapterRaw;
  const modelFlags = collectRepeatableFlag(options.flags, "model");
  if (modelFlags.length === 0) {
    throw new ProviderCliError("validation", t("cli.provider.error.noModels", { id }));
  }
  const models: ModelDefinition[] = modelFlags.map((raw, idx) => parseModelFlag(raw, idx, t));
  const defaultModel = stringFlag(options.flags, "default-model") ?? models[0].id;
  if (!models.some((m) => m.id === defaultModel)) {
    throw new ProviderCliError(
      "validation",
      t("cli.provider.error.defaultModelMissing", { model: defaultModel, id }),
    );
  }
  return {
    id,
    name,
    baseUrl,
    apiKeyEnv,
    adapter,
    models,
    defaultModel,
  };
}

function parseModelFlag(
  raw: string,
  index: number,
  t: (k: string, v?: Record<string, string | number>) => string,
): ModelDefinition {
  // Format: id=name,contextWindow,maxOutput[,supportsStreaming[,supportsThinking]]
  // or legacy: id,name,contextWindow,maxOutput[,supportsStreaming[,supportsThinking]]
  // The 4 trailing fields are optional; missing values fall back to safe defaults.
  //
  // First split on the first `=` (if present before the first `,`) to
  // extract the id and name, then split the remainder by `,` for numeric fields.
  let id: string;
  let name: string;
  let remainder: string;
  const eqIdx = raw.indexOf("=");
  const firstCommaIdx = raw.indexOf(",");
  if (eqIdx > 0 && (firstCommaIdx < 0 || eqIdx < firstCommaIdx)) {
    // id=name,contextWindow,maxOutput,...
    id = raw.slice(0, eqIdx).trim();
    const afterEq = raw.slice(eqIdx + 1);
    const nameCommaIdx = afterEq.indexOf(",");
    if (nameCommaIdx >= 0) {
      name = afterEq.slice(0, nameCommaIdx).trim();
      remainder = afterEq.slice(nameCommaIdx + 1);
    } else {
      name = afterEq.trim();
      remainder = "";
    }
  } else {
    // Legacy: id,name,contextWindow,maxOutput,... or just id
    const parts = raw.split(",").map((p) => p.trim());
    if (parts.length < 1 || parts[0].length === 0) {
      throw new ProviderCliError("validation", t("cli.provider.error.modelFlagEmpty", { index }));
    }
    id = parts[0];
    name = parts[1] ?? id;
    remainder = parts.slice(2).join(",");
  }
  const parts = remainder.length > 0 ? remainder.split(",").map((p) => p.trim()) : [];
  const [contextRaw, outputRaw, streamRaw, thinkingRaw] = parts;
  const contextWindow = parsePositiveInt(contextRaw, 8192, `model[${index}].contextWindow`);
  const maxOutput = parsePositiveInt(outputRaw, 4096, `model[${index}].maxOutput`);
  const supportsStreaming = streamRaw === undefined ? true : streamRaw === "true" || streamRaw === "1";
  const supportsThinking = thinkingRaw === undefined ? false : thinkingRaw === "true" || thinkingRaw === "1";
  return { id, name, contextWindow, maxOutput, supportsStreaming, supportsThinking };
}

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ProviderCliError("validation", `Invalid integer for ${label}: "${raw}"`);
  }
  return n;
}

function collectRepeatableFlag(flags: Record<string, string | boolean | string[]>, name: string): string[] {
  const value = flags[name];
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") return [value];
  return [];
}

function loadProviderFromFile(
  rawPath: string,
  cwd: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): ProviderDefinition {
  const abs = resolve(cwd, rawPath);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderCliError("io", t("cli.provider.error.readFile", { path: abs, error: message }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderCliError("json-parse", t("cli.provider.error.jsonParse", { error: message }));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ProviderCliError("json-parse", t("cli.provider.error.jsonShape"));
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string" || typeof obj.baseUrl !== "string") {
    throw new ProviderCliError("json-parse", t("cli.provider.error.jsonShape"));
  }
  if (!Array.isArray(obj.models) || obj.models.length === 0) {
    throw new ProviderCliError("json-parse", t("cli.provider.error.jsonShape"));
  }
  const models: ModelDefinition[] = [];
  for (const m of obj.models) {
    if (typeof m !== "object" || m === null) {
      throw new ProviderCliError("json-parse", t("cli.provider.error.jsonShape"));
    }
    const mm = m as Record<string, unknown>;
    if (typeof mm.id !== "string" || typeof mm.name !== "string") {
      throw new ProviderCliError("json-parse", t("cli.provider.error.jsonShape"));
    }
    models.push({
      id: mm.id,
      name: mm.name,
      contextWindow: typeof mm.contextWindow === "number" ? mm.contextWindow : 8192,
      maxOutput: typeof mm.maxOutput === "number" ? mm.maxOutput : 4096,
      supportsStreaming: typeof mm.supportsStreaming === "boolean" ? mm.supportsStreaming : true,
      supportsThinking: typeof mm.supportsThinking === "boolean" ? mm.supportsThinking : false,
    });
  }
  const defaultModel = typeof obj.defaultModel === "string" ? obj.defaultModel : models[0].id;
  if (!models.some((m) => m.id === defaultModel)) {
    throw new ProviderCliError(
      "json-parse",
      t("cli.provider.error.defaultModelMissing", { model: defaultModel, id: obj.id }),
    );
  }
  return {
    id: obj.id,
    name: obj.name,
    baseUrl: obj.baseUrl,
    apiKeyEnv: typeof obj.apiKeyEnv === "string" ? obj.apiKeyEnv : null,
    adapter: obj.adapter === "anthropic" ? "anthropic" : "openai",
    models,
    defaultModel,
  };
}

function providerHelp(t: (k: string, v?: Record<string, string | number>) => string): string {
  return [
    t("cli.provider.help.title"),
    t("cli.provider.help.usage"),
    t("cli.provider.help.subcommands"),
    t("cli.provider.help.addFlags"),
    t("cli.provider.help.examples"),
  ].join("\n");
}

// ─── Parser helper for raw argv ───

/**
 * Parse `argv` (the slice of `process.argv` AFTER the `provider` token) into
 * a `ProviderCliOptions` value. Exported separately from `runProviderCli` so
 * tests can exercise the parser in isolation.
 *
 * Repeated `--model <value>` flags accumulate into a string array under
 * `flags.model` so the caller can register multiple models in one invocation.
 * For all other flags the parser keeps "last wins" semantics — the CLI
 * surface does not need anything more, and ambiguity is rejected at the
 * schema level rather than by the parser.
 */
export function parseProviderCliArgs(argv: readonly string[]): ProviderCliOptions {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    let name: string;
    let inlineValue: string | undefined;
    if (eq !== -1) {
      name = arg.slice(2, eq);
      inlineValue = arg.slice(eq + 1);
    } else {
      name = arg.slice(2);
    }
    if (inlineValue !== undefined) {
      assignFlagValue(flags, name, inlineValue);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      assignFlagValue(flags, name, next);
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

const REPEATABLE_FLAGS = new Set<string>(["model"]);

function assignFlagValue(
  flags: Record<string, string | boolean | string[]>,
  name: string,
  value: string,
): void {
  if (REPEATABLE_FLAGS.has(name)) {
    const existing = flags[name];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (typeof existing === "string") {
      flags[name] = [existing, value];
    } else {
      flags[name] = [value];
    }
    return;
  }
  flags[name] = value;
}

// ─── Default config path helper (exported for convenience) ───

