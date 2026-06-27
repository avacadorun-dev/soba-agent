# v0.4.0 release notes draft

Date: 2026-06-19

## Headline

SOBA v0.4.0 adds Project Memory, MCP client foundation and a hardened verified Agent Loop. The agent can persist project
knowledge across sessions, call external MCP tools through the same ToolRegistry/AgentLoop path as built-in tools, and
turn short prompts into inspect/act/verify workflows with evidence-backed completion.

## Included

- Project Memory:
  - `.soba/memory/knowledge/*.md` templates for architecture, conventions, known errors and dependencies;
  - persistent memory capsules with relevance lookup and pruning;
  - optional persisted entity graph;
  - bounded, sanitized memory injection into the system prompt;
  - `read_project_memory` and `write_project_memory` tools with secret/path rejection.
- MCP client:
  - project-local `.soba/mcp.json`;
  - stdio transport foundation;
  - Streamable HTTP remote transport after tasks 22–36;
  - static bearer/API-key auth and OAuth browser login after tasks 28–31;
  - modern `server/discover` path with legacy `initialize` fallback;
  - `tools/list` pagination, `tools/call`, timeout/cancellation/crash handling;
  - MCP tools registered as OpenAI-compatible `mcp_<server>_<tool>` function names;
  - local-config-only `trustMode` boundary; annotations are ignored for security decisions;
  - `/mcp status`, `/mcp start`, `/mcp stop`, `/mcp restart`;
  - `/mcp auth status <server>`, `/mcp auth login <server>`, `/mcp auth logout <server>` for remote auth UX.
- Verified Agent Loop:
  - Working Narration markers for visible progress without hidden chain-of-thought;
  - Evidence Ledger and finish gate that reject confident completion after unverified code mutations;
  - project-command discovery for verification, with SOBA-specific Bun/Biome/TypeScript gates kept as repository policy rather than global agent behavior;
  - Fix-Until-Green recovery for failed verification;
  - checkpoint events and reflection memory policy for long tasks;
  - bounded search/inspect tools and mutating-batch guard for weak model rails;
  - bundled skills 2.0 protocol with fixture regression coverage.
- Ops/docs:
  - Bun-only CI/pre-commit gates;
  - user-facing MCP setup docs, verified local stdio examples and remote Streamable HTTP templates;
  - release WOW tests for Project Memory, stdio MCP, remote no-auth MCP, OAuth login UX, refresh and auth-required recovery.

## Out of scope

- SOBA as an MCP server/exporter.
- Deprecated HTTP+SSE as a first-class transport.
- Marketplace discovery or signed MCP servers.
- Trust decisions based on MCP server annotations or metadata.

## Release verification

- `bun test` → 1662 pass / 0 fail.
- `bun run lint` → pass.
- `bunx tsc --noEmit` → pass.
- `bun run build` → pass.
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` → `💀 dead: 0`.
- `cd docs-site && bun run check` → pass.

## Known risks / follow-ups

- External MCP examples that require npm packages or tokens are templates and are disabled by default.
- OAuth discovery, PKCE login, token storage, refresh and auth-required UX are verified; direct automatic OAuth bearer injection into every Streamable HTTP request remains a hardening follow-up.
- Agent Loop release WOW cases are deterministic fixture traces; live external model evals remain a follow-up.
- Project command discovery is intentionally extensible. Non-JavaScript ecosystems need additional detector fixtures before first-class support claims.
- Server-side export remains a future phase.
- Doc Scout's local SOURCE_FACTS does not yet include `/mcp`; Task 19 manually verified `/mcp` against `src/cli/commands.ts`.
