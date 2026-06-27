# Phase 6 Smoke Diagnostics

This phase adds repeatable diagnostics, not a public benchmark claim.

## Local Seed Eval Smoke

Run the deterministic seed evals and the one-shot CLI path:

```bash
bun run smoke:diagnostics
```

The local profile runs:

- `bun test tests/evals/agent-loop`
- `bun test tests/evals/skills`
- `soba --help` through `dist/cli.js` when built, or `src/cli.ts` as a Bun fallback

Use JSON output for CI artifacts:

```bash
bun run smoke:diagnostics -- --json
```

## Terminal-Bench 2.0 Smoke Profile

Terminal-Bench 2.0 runs through Harbor. The official smoke path installs Harbor, verifies `harbor --help`, then runs an
oracle smoke over the Terminal-Bench 2.0 dataset. SOBA keeps this as a diagnostic profile until results are stable enough
to publish.

Prerequisites:

```bash
uv tool install harbor
harbor --help
docker info
```

Dry-run the SOBA plan:

```bash
bun run smoke:terminal-bench -- --dry-run
```

Run the lightweight external smoke:

```bash
bun run smoke:terminal-bench -- --run-external
```

Fail the run if Harbor is missing or the external workload is skipped:

```bash
bun run smoke:terminal-bench -- --run-external --require-external
```

The profile resolves SOBA in this order:

1. `dist/bin/soba-linux-x64-v*` for Linux x64 Harbor containers.
2. `bun dist/cli.js` when a build artifact exists.
3. `bun src/cli.ts` as a source fallback.

The external smoke command is intentionally limited to one oracle task:

```bash
harbor run -d terminal-bench/terminal-bench-2 -a oracle -l 1
```

For broader manual checks, use the official five-task oracle smoke first, then move to fixed subsets before publishing
any benchmark result.

## Stability Rule

Do not publish SOBA benchmark numbers from this phase. A public claim needs:

- fixed Terminal-Bench version and task subset;
- hardware profile;
- model/provider settings;
- repeated runs with artifacts;
- clear separation between oracle harness health checks and actual SOBA agent runs.

References:

- [Terminal-Bench 2.0 Harbor docs](https://www.tbench.ai/docs)
- [Terminal-Bench 2.0 leaderboard run syntax](https://www.tbench.ai/leaderboard/terminal-bench/2.0)
