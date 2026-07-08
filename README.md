# SOBA Agent

SOBA Agent is a local-first engineering agent that remembers the project, verifies work, and leaves proof receipts. It
ships with an interactive terminal UI, Project Memory provenance, MCP support, bounded permissions, and evolvable skills.

## Install

With npm:

```bash
npm install -g soba-agent
```

With Bun:

```bash
bun add -g soba-agent
```

Check the CLI:

```bash
soba --version
soba --help
```

Start the interactive TUI:

```bash
soba -i
```

Inspect proof receipts after a task:

```bash
soba prove --last
soba verify --last
soba explain-claim "No test regressions detected"
```

## From Source

```bash
bun install
bun run build
bun run src/cli.ts --help
```

## Standalone Binaries

Tagged GitHub releases build standalone binaries for macOS and Linux. Download the matching `soba-*` asset from the
release, make it executable, and run it directly:

```bash
VERSION="$(node -p "require('./package.json').version")"
chmod +x "./soba-linux-x64-v${VERSION}"
"./soba-linux-x64-v${VERSION}" --version
```

## Development

```bash
bun run lint
bun run typecheck
bun test
bun run build
```

SOBA uses Biome for linting/formatting and Bun for scripts, tests, and builds.

## Documentation

The public documentation site is in `docs-site/`.

## License

MIT © 2026 avacado.run <avacado.run@gmail.com>
