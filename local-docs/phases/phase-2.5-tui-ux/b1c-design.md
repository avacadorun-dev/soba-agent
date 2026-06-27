# B1c — `soba provider` CLI for custom providers

**Phase:** 2.5 B1c — TUI UX
**Status:** implemented
**Depends on:** B1a (ProviderStore, model selector)

## Problem

`ProviderRegistry.addProvider()` and `removeProvider()` already exist and
the registry persists custom providers to `~/.soba/config.json` on every
mutation. But the only way to actually call them is to edit the JSON file
manually, which is awkward and error-prone (typos in adapter ids, model
shapes, default-model mismatches all break the registry at load time).

We need a one-shot CLI sub-route that:

- validates input up front (no half-written state on disk),
- persists atomically through the registry,
- renders the result in en/ru/zh,
- is unit-testable without spawning a child process.

## Design

### Sub-route shape

`soba provider <sub> [...flags]`

| Sub        | Description                                       |
|------------|---------------------------------------------------|
| `list`     | Print built-in + custom providers, active marked  |
| `add <id>` | Register a custom provider (flags or `--from-file`) |
| `remove <id>` | Remove a custom provider                       |
| `show <id>` | Print the provider definition as JSON           |
| `use <id>` | Switch the active selection to a provider's default model |
| `help`     | Show detailed help                                |

The sub-route is matched in `args.ts` before the rest of the CLI runs and
the raw argv after `provider` is preserved verbatim in
`cliArgs.providerSubArgs`. This way, subcommand-specific flags (like
`--from-file` or `--set-active`) don't have to be enumerated in the
top-level parser.

### File layout

`src/cli/provider-cli.ts` — pure-function layer:

- `parseProviderCliArgs(argv) -> ProviderCliOptions` — split positional vs flags,
  accumulate repeated `--model` flags into a string[].
- `runProviderCli(sub, options, registry, i18n) -> ProviderCliResult` — dispatch,
  catch `ProviderCliError`, render to `stdout` / `stderr`, choose exit code.
- `ProviderCliError` — typed error with a stable `code` enum
  (`unknown-subcommand`, `missing-args`, `validation`, `duplicate`,
  `builtin-immutable`, `unknown-id`, `io`, `json-parse`, `internal`).

`src/cli.ts` — orchestration: load the persisted registry (without
configuring the agent loop / tool registry / session), call
`runProviderCli`, write outputs, set exit code, return.

### Validation rules

The CLI enforces the same invariants as `addProvider` does in-process, but
at the input boundary so the user gets a translation-keyed error message
instead of a stack trace. The order matters: the duplicate-id check runs
**before** model parsing and file reads, so a typo on the id never costs
the user a JSON parse error.

- `id` is required and must not collide with a built-in or existing custom.
- `--base-url` is required.
- `--adapter` ∈ {`openai`, `anthropic`}.
- At least one `--model` (or `--from-file`) is required.
- `--default-model` must appear in the model list.
- `--from-file` JSON must satisfy `{id, name, baseUrl, models[], defaultModel}`.
- `--remove` of a built-in is rejected (`builtin-immutable`).
- `--api-key-env ""` is treated as a keyless provider (`apiKeyEnv = null`).

### Repeatable flags

`--model id,name,contextWindow,maxOutput[,stream[,think]]` can be passed
multiple times. The parser stores them as a string[] under
`flags["model"]`; the handler reads every entry. The shorthand splits on
commas and accepts up to 6 fields; trailing numeric/boolean fields are
optional and default to `8192 / 4096 / true / false`.

### Persist semantics

`add` and `remove` and `use` call `registry.persistConfig()` after
mutating the in-memory state. If persistence fails:

- `add` rolls back the in-memory addition so the user can retry cleanly.
- `remove` re-adds the provider to keep the registry consistent.
- `use` leaves the in-memory state alone (the switch is benign without
  persistence — the next run will simply revert).

`persistConfig` writes to `~/.soba/config.json` by default. The CLI does
not introduce a separate config file — custom providers live in the same
file as the rest of the registry state.

### Exit codes

- `0` — success
- `1` — validation / unknown id / built-in removal / JSON parse error
- `2` — IO error (file read, persist failure)

### i18n

All human-readable strings flow through `i18n.t(...)`. The 30+ new keys
are added to `en.json`, `ru.json`, `zh.json` under the `cli.provider.*`
namespace and to `src/core/i18n/types.ts` for compile-time safety.

## TUI integration

The model selector in `src/widgets/tui/ui/model-selector.tsx` now shows
a `[custom]` badge next to providers with `custom === true`. The badge
key is `tui.modelSelector.customBadge`. The selector is still driven by
`ProviderStore.filteredGroups()` and so picks up new providers on the
next read.

## Tests

- `tests/cli/provider-cli.test.ts` — 37 cases covering argv parsing, list,
  add (flags, --from-file, validation errors, keyless), remove
  (custom OK, built-in rejected, unknown id, persist rollback), use,
  show, help/unknown, i18n in ru/zh, and `ProviderCliError` shape.
- `tests/widgets/tui/provider-store.test.ts` — 4 new cases for custom
  providers: visibility in `filteredGroups`, select + activeLabel,
  removal, search by name.

Total: **37 + 4 = 41** new tests on top of the existing 988.

## Future work (B2a)

- TUI form to add a custom provider interactively.
- Per-provider secret editor (`/config api-key`).
- Test-connection action (`soba provider test <id>`).
