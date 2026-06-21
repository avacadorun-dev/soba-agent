# SOBA Agent

SOBA Agent is a Bun-first CLI coding agent with an interactive terminal UI, proactive context management, project memory, skills, and MCP support.

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
chmod +x ./soba-linux-x64-v0.4.1
./soba-linux-x64-v0.4.1 --version
```

## Development

```bash
bun run lint
bunx tsc --noEmit
bun test
bun run build
```

SOBA uses Biome for linting/formatting and Bun for scripts, tests, and builds.

## Documentation

The public documentation site is in `docs-site/`.

## License

MIT © 2026 avacado.run <avacado.run@gmail.com>
