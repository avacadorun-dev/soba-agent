# Adding custom providers from scratch

If you have a fresh install (no `~/.soba/config.json` yet), or you want to
add a new OpenAI-compatible LLM that isn't built into SOBA, you can wire it
in via the `soba provider` sub-route. No manual JSON editing, no restart
needed.

## TL;DR

```bash
# See what's available
soba provider list

# Add a local Ollama instance (no API key, keyless)
soba provider add ollama-local \
  --base-url http://127.0.0.1:11434/v1 \
  --default-model llama3 \
  --model llama3,"Llama 3",8192,4096

# Switch to it
soba provider use ollama-local

# Or in one shot
soba provider add ollama-local \
  --base-url http://127.0.0.1:11434/v1 \
  --default-model llama3 \
  --model llama3,"Llama 3",8192,4096 \
  --set-active

# Later: remove
soba provider remove ollama-local
```

## What happens under the hood

- `soba provider add` calls `ProviderRegistry.addProvider()` and then
  `ProviderRegistry.persistConfig()`, which writes (or creates, if it
  doesn't exist yet) `~/.soba/config.json` with a new `registry` block.
- The rest of your `config.json` (sessions, theme, compaction settings)
  is left untouched — `persistConfig` reads the existing file first and
  only replaces the `registry` sub-object.
- If the file doesn't exist, `persistConfig` creates
  `~/.soba/config.json` from scratch with sane defaults
  (`activeProvider: "deepseek"`, `activeModel: "deepseek-chat"`, empty
  `providers` and `customProviders`). The first `soba provider add`
  on a brand-new machine is enough to bootstrap the file.
- If persistence fails (disk full, permission denied), the in-memory
  state is rolled back so you can retry without ending up with a
  registry that's out of sync with the file.

## Step-by-step

### 1. Check what's already there

```bash
soba provider list
```

You'll see every built-in (DeepSeek, Moonshot Kimi, Alibaba Qwen,
OpenRouter, plus any custom providers you've added). Built-ins
cannot be removed — they're always available even without an API
key set. The active one is marked with `*` in the model list and
`(active)` at the end of the row.

### 2. Add a custom provider

Two ways to spell the same thing.

**Inline flags (good for one or two models):**

```bash
soba provider add my-llm \
  --base-url https://api.example.com/v1 \
  --api-key-env MY_LLM_KEY \
  --default-model my-llm-7b \
  --model my-llm-7b,"My LLM 7B",16384,8192 \
  --model my-llm-13b,"My LLM 13B",16384,8192
```

The `--model` shorthand is `id,name,contextWindow,maxOutput[,supportsStreaming[,supportsThinking]]`. The trailing fields are optional; defaults are `8192` context, `4096` output, streaming on, thinking off. Repeat `--model` to register several.

**`--from-file` (good for many models or a reproducible setup):**

Write a JSON file once:

```json
{
  "id": "my-llm",
  "name": "My LLM",
  "baseUrl": "https://api.example.com/v1",
  "apiKeyEnv": "MY_LLM_KEY",
  "adapter": "openai",
  "defaultModel": "my-llm-7b",
  "models": [
    { "id": "my-llm-7b",  "name": "My LLM 7B",  "contextWindow": 16384, "maxOutput": 8192 },
    { "id": "my-llm-13b", "name": "My LLM 13B", "contextWindow": 16384, "maxOutput": 8192 }
  ]
}
```

Then:

```bash
soba provider add my-llm --from-file ./my-llm.json
```

The JSON shape is the same as the one SOBA writes back into
`~/.soba/config.json` under `customProviders`, so you can copy/paste
between environments.

### 3. Switch the active selection

```bash
soba provider use my-llm
```

This sets the active provider/model to `my-llm` and its
`defaultModel`. Persists immediately. From this point on, every
`soba` invocation — REPL, one-shot, TUI — uses `my-llm` until you
`use` something else or pass `--model` / `--base-url` flags.

You can also pass `--set-active` to the `add` call to do steps 2
and 3 in a single command (see the TL;DR example).

### 4. Set the API key

`add` and `use` only register the provider shape; they don't store
the API key. SOBA reads the key from the env var named in
`apiKeyEnv` at request time, so:

```bash
export MY_LLM_KEY=sk-...
soba -i
```

(Or put it in your shell rc file / `~/.config/soba/env` /
whatever you use to manage env vars.) If you set `apiKeyEnv` to
`""` (or omit it), SOBA treats the provider as keyless — that's
the right shape for local Ollama, LM Studio, vLLM, etc.

### 5. Verify

```bash
soba provider show my-llm   # full definition as JSON
soba provider list          # all providers, active marked
```

### 6. Remove

```bash
soba provider remove my-llm
```

Built-ins are rejected with a clear "cannot be removed" message —
that's intentional, you can only remove custom providers. If the
provider you remove is the active one, the registry falls back to
the first built-in (`deepseek / deepseek-chat`) automatically (B1d
slim list: `deepseek`, `kimi`, `alibaba`, `openrouter`).

## Common recipes

### Local Ollama

```bash
soba provider add ollama-local \
  --base-url http://127.0.0.1:11434/v1 \
  --default-model llama3 \
  --model llama3,"Llama 3",8192,4096 \
  --model qwen2.5-coder,"Qwen 2.5 Coder",32768,4096 \
  --set-active
```

### LM Studio

```bash
soba provider add lm-studio \
  --base-url http://127.0.0.1:1234/v1 \
  --default-model the-model-i-loaded \
  --model the-model-i-loaded,"LM Studio Model",32768,4096
```

(LM Studio rotates the model id based on what you've loaded; just
substitute the actual id you see in the LM Studio UI.)

### Corporate OpenAI-compatible proxy

```bash
export CORP_KEY=...
soba provider add corp \
  --base-url https://llm-proxy.corp.example.com/v1 \
  --api-key-env CORP_KEY \
  --default-model corp-gpt-4o \
  --model corp-gpt-4o,"Corporate GPT-4o",128000,8192 \
  --set-active
```

### Multiple regions / accounts

Add as many entries as you need — there's no limit on the number of
custom providers:

```bash
soba provider add prod-east  --base-url https://llm-east.example.com/v1  --api-key-env EAST_KEY  --default-model gpt-4o --model gpt-4o,"GPT-4o (east)",128000,8192
soba provider add prod-west  --base-url https://llm-west.example.com/v1  --api-key-env WEST_KEY  --default-model gpt-4o --model gpt-4o,"GPT-4o (west)",128000,8192
soba provider add staging    --base-url https://llm-staging.example.com/v1 --api-key-env STAGE_KEY --default-model gpt-4o --model gpt-4o,"GPT-4o (staging)",128000,8192
```

Each is listed in the `/model` overlay in the TUI with a `[custom]`
badge, and `soba provider use prod-east` switches the active one in
one call.

## Troubleshooting

**`Provider "x" already exists`** — you tried to add an id that
collides with an existing provider (built-in or custom). Run
`soba provider list` to see what's registered, then either pick a
different id or `soba provider remove x` first.

**`Provider "x" requires --base-url`** — for inline-flag mode, the
base URL is required. Either add `--base-url` or switch to
`--from-file ./path.json`.

**`Failed to persist provider changes: ...`** — something went
wrong writing to `~/.soba/config.json` (permissions, disk space,
read-only mount). The in-memory state is rolled back, so fix the
underlying issue and retry. The exit code is `2` to distinguish
IO errors from validation errors.

**`soba provider list` doesn't show my new provider after a
restart** — the file is `~/.soba/config.json`. Check that it's
there and has a `registry.customProviders` block. SOBA also
silently drops custom providers whose `id`, `name`, or `models`
are missing or malformed on load — check for typos in your
`--from-file` JSON.

**Built-in removal is rejected** — by design. Built-ins are always
listed; the active selection can be switched away from them with
`soba provider use <id>` but they cannot be deleted.
