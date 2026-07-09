<h1 align="center">
  <img src="https://raw.githubusercontent.com/avacadorun-dev/soba-agent/main/docs-site/public/brand/soba-bowl-icon-github.png" width="54" alt="SOBA Agent logo" />
  SOBA Agent
</h1>

<p align="center">
  <strong>Local-first engineering agent for code changes with a verifiable trail.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/soba-agent"><img alt="npm" src="https://img.shields.io/npm/v/soba-agent?color=244C66"></a>
  <a href="https://github.com/avacadorun-dev/soba-agent/releases"><img alt="release" src="https://img.shields.io/github/v/release/avacadorun-dev/soba-agent?color=3F7052"></a>
  <a href="https://github.com/avacadorun-dev/soba-agent/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/avacadorun-dev/soba-agent/ci.yml?branch=main&label=ci"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/github/license/avacadorun-dev/soba-agent?color=6B4E71"></a>
</p>

<p align="center">
  <a href="#install">Install</a>
  · <a href="#first-workflow">First workflow</a>
  · <a href="https://soba-agent.dev/en/docs/quick-start">Docs</a>
  · <a href="https://soba-agent.dev/en/docs/changelog">Changelog</a>
</p>

SOBA runs in your terminal, keeps project context close to the repository, works through bounded tool loops, and writes
receipts for the work it claims to have done. It is built for everyday engineering tasks where the important question is
not only "did the agent edit the code?", but also "what changed, what was checked, what permissions were used, and what
evidence supports the handoff?"

<p align="center">
  <img src="https://raw.githubusercontent.com/avacadorun-dev/soba-agent/main/docs-site/public/tui_screen.png" alt="SOBA Agent terminal UI showing the session sidebar, collapsed reasoning blocks, tool activity, and context budget" />
</p>

SOBA is built for engineers who want an agent to stay close to the repo: inspect before editing, ask for permission
before risky operations, run the project's own checks, and leave behind receipts that can be reviewed after the session.

## What SOBA is for

SOBA is a coding agent with a local workflow:

- **Interactive TUI** for agent sessions, shell commands, slash commands, permissions, context, and model state.
- **Proof receipts** in `.soba/evidence/*.soba-proof.json` so completed work has a local audit trail.
- **Proof claim mapping** through `soba verify` and `soba explain-claim`, making unsupported claims visible instead of
  hiding them in prose.
- **Project Memory** in `.soba/memory/` with source receipts, stale checks, doctor output, and explanations.
- **Bounded permissions** for dangerous operations, with permission receipts recorded in proof output.
- **MCP support** for local `stdio` servers and remote `streamableHttp` endpoints.
- **Skills** for reusable project workflows, plus eval, bench, and trace commands for improving them over time.
- **Portable capsules** for compacting, resuming, and handing off long sessions.

The current `0.6.x` line is focused on stabilization before larger `0.7.0` delegation features: installs, TUI behavior,
proofs, memory provenance, permission handling, skills, and documentation should be dependable first.

## Install

With npm:

```bash
npm install -g soba-agent
```

The npm package includes a pinned Bun runtime dependency, so users do not need to install Bun separately before running
`soba`.

With Bun:

```bash
bun add -g soba-agent
```

Use the Bun install path when Bun is already part of your toolchain and you want Bun to manage the global package.

Check the CLI:

```bash
soba --version
soba --help
soba init --check
```

Start the interactive terminal UI:

```bash
soba -i
```

## First workflow

1. Check providers:

   ```bash
   soba provider list
   ```

2. Run a minimal one-shot provider check:

   ```bash
   soba --no-session --max-agent-iterations 1 "Answer with one word: ok"
   ```

3. Open the TUI:

   ```bash
   soba -i --lang en --theme graphite
   ```

4. In the TUI, start with a bounded task:

   ```text
   Inspect this project.
   Read package.json and the test layout first.
   Then propose a short plan.
   If edits are needed, keep them inside the plan and run a targeted test.
   Do not create a git commit.
   ```

5. Run local checks from the TUI when you want direct control:

   ```text
   !git status --short
   !git diff --stat
   !bun test
   ```

6. Inspect the proof trail after non-trivial work:

   ```bash
   soba prove --last
   soba verify --last
   soba explain-claim "No test regressions detected"
   ```

If a claim is not backed by evidence, SOBA should keep that visible. The receipt is the handoff artifact, not just a
transcript summary.

## Project Memory

Project Memory stores durable project facts under `.soba/memory/` so future sessions can reuse context without relying
only on a long chat transcript.

Ask SOBA to save facts with source receipts:

```text
Update Project Memory:
- architecture: core modules and data flow;
- conventions: Bun only, strict TypeScript, tests with bun test;
- known-errors: recurring failures and verification commands;
- dependencies: important runtime and dev dependencies.

Use project memory tools. Include source.file, source.lines, source.lastVerified, source.confidence, and staleIfFilesChange when a source can be verified.
Do not store secrets.
```

Then inspect memory health:

```bash
soba memory doctor
soba memory stale
soba memory verify
soba memory explain "provider registry"
```

## Skills

Skills are reusable workflows that live with the project or the user environment. In the TUI:

```text
/skill list
/skill:commit-message Suggest a conventional commit message for staged changes.
```

Project skills require trust:

```text
/project-trust status
/project-trust approve
```

For skills that should stay reliable, use the eval loop:

```text
/skill eval <name>
/skill bench <name>
/skill trace <name>
```

## MCP tools

MCP servers are configured in `.soba/mcp.json`. From the TUI:

```text
/mcp status
/mcp start <server>
/mcp reload
/mcp status
```

SOBA supports local `stdio` servers and remote `streamableHttp` endpoints. Remote credentials should come from
environment-backed auth such as `bearerEnv` or `apiKeyEnv`.

## Session controls

Common ways to continue work:

```bash
soba -i
soba -c -i
soba -r
soba -s <SESSION_ID> "Continue the task"
```

Useful TUI commands:

```text
/session
/sessions list
/budget
/permissions ask
/permissions repo
/auto-compact on
/compact Preserve the goal, decisions, changed files, checks, risks, and next step.
/capsule
/rewind
```

## From source

```bash
git clone git@github.com:avacadorun-dev/soba-agent.git
cd soba-agent
bun install
bun run build
bun run src/cli.ts --help
```

Development gates:

```bash
bun run lint
bun run typecheck
bun test
bun run build
```

SOBA uses Biome for linting/formatting and Bun for scripts, tests, and builds.

## Standalone binaries

Tagged GitHub releases build standalone binaries for macOS and Linux. Download the matching `soba-*` asset from the
release, make it executable, and run it directly:

```bash
VERSION="$(node -p "require('./package.json').version")"
chmod +x "./soba-linux-x64-v${VERSION}"
"./soba-linux-x64-v${VERSION}" --version
```

For normal use, prefer the npm or Bun global install path. Use a standalone binary when you do not want a global package
manager install.

## Documentation

- [Quick Start](https://soba-agent.dev/en/docs/quick-start)
- [Project walkthrough](https://soba-agent.dev/en/docs/walkthrough-building-a-project)
- [Proof receipts](https://soba-agent.dev/en/docs/proof)
- [Project Memory](https://soba-agent.dev/en/docs/project-memory)
- [Skills](https://soba-agent.dev/en/docs/skills)
- [CLI reference](https://soba-agent.dev/en/docs/cli-reference)
- [Changelog](https://soba-agent.dev/en/docs/changelog)

The documentation site source lives in `docs-site/`.

## License

MIT © 2026 avacado.run <avacado.run@gmail.com>
