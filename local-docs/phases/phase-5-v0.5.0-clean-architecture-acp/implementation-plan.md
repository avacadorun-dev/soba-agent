# v0.5.0 Implementation Plan

## Release boundary

v0.5.0 is a refactor-and-adapter release:

1. Clean Architecture boundary around the existing SOBA runtime.
2. Decomposition of the current `AgentLoop` responsibilities into testable controllers.
3. Full current ACP v1 agent support for Zed.

The release must not weaken v0.4.x behavior.

ACP work is blocked until the clean architecture pre-gate passes. ACP is a protocol adapter over the cleaned runtime,
not a parallel path through the old `AgentLoop`.

## Task sequence

### 00. Release framing

- Confirm branch: `v0.5.0`.
- Confirm package version: `0.5.0`.
- Confirm local phase docs exist under `local-docs/phases/phase-5-v0.5.0-clean-architecture-acp/`.
- Keep `local-docs/` ignored.

### 01. Characterization baseline

Add tests around current behavior before extraction:

- plain text response;
- streaming response;
- successful tool call;
- tool error;
- dangerous confirmation allow/deny;
- cancellation;
- mutation + verification;
- finish rejection/acceptance;
- checkpoint event.

Exit: tests describe current behavior without architectural movement.

### 02. Runtime factory

Create:

- `src/application/runtime-factory.ts`;
- `src/application/types.ts`.

Move setup from `src/cli.ts`:

- provider registry and client proxy;
- built-in tool registration;
- MCP config/manager/tool sync;
- project memory;
- trust manager;
- context manager and scheduler;
- skill discovery/catalog/manager;
- sound notifier wiring remains app-level unless represented as runtime listener.

Exit:

- CLI/TUI use the factory.
- `src/cli.ts` stops importing individual tool implementations.

### 03. Session lifecycle service

Create:

- `src/application/session-lifecycle.ts`.

Move:

- create/open/continue/resume selection;
- session list helpers;
- ACP session ID mapping;
- load/replay snapshots;
- close/delete behavior;
- active-turn cancellation before destructive session operations.

Exit:

- app surfaces request sessions through a service.
- ACP lifecycle methods can be implemented without reaching into CLI/TUI code.

### 04. Runtime contract

Add:

- `SobaRuntime`;
- `UserTurnInput`;
- `RuntimeContentBlock`;
- `RuntimeEvent`.
- session config and session mode types;
- session load/resume/delete methods;
- protocol-neutral command metadata.

Keep:

- adapter from current `AgentEvent` to `RuntimeEvent`;
- text wrapper for current `runTurn(string)`.

Exit:

- print/TUI can still use legacy path;
- new ACP code can target `SobaRuntime`.

### 05. Model turn runner extraction

Create:

- `src/core/model-turn/model-turn-runner.ts`.

Move:

- streaming request normalization;
- non-streaming response extraction;
- provider final response handling.

Exit:

- workflow receives normalized model output.

### 06. Tool execution extraction

Create:

- `src/core/tool-execution/tool-call-executor.ts`.

Move:

- tool lookup;
- argument preparation;
- execution;
- abort wiring;
- result normalization;
- tool evidence creation hooks.

Exit:

- built-in and MCP tools remain on one path.

### 07. Permission broker extraction

Create:

- `src/core/permissions/permission-broker.ts`.
- app adapters for print and TUI confirmation.

Move:

- dangerous confirmation promise flow out of `AgentLoop`.

Exit:

- ACP can implement permission requests without touching workflow policy.

### 08. Completion and verification controllers

Create:

- `src/core/completion/completion-controller.ts`;
- `src/core/verification/verification-controller.ts`.

Move:

- finish parse/evaluate/reject loop;
- auto-verifier trigger;
- Fix-Until-Green decision wiring.

Exit:

- tests can validate completion and verification without a full `AgentLoop`.

### 09. Context controller

Create:

- `src/core/context/context-controller.ts`.

Move:

- pre-inference check;
- overflow recovery;
- provider usage recording;
- checkpoint-triggered scheduling.

Exit:

- checkpoint/capsule behavior is isolated from the main turn loop.

### 10. Command service boundary

Create:

- `src/application/command-service.ts`.

Split:

- command domain handlers from `src/cli/commands.ts`.

Exit:

- TUI slash commands and ACP command advertisement share command metadata.

### 11. Clean architecture pre-gate

Add:

- import-boundary tests for layer direction;
- dependency checks that fail if `src/core/**` imports app, widgets, TUI, protocol adapter or ACP code;
- runtime contract tests proving print/TUI entrypoints can construct the same `SobaRuntime`;
- controller-level tests for workflow, model turn, tool execution, permission, completion, verification and context;
- compatibility tests proving legacy `AgentLoop.runTurn(string)` is only a facade or transition wrapper.

Exit:

- ACP implementation is allowed to start only after this gate is green;
- architecture violations are test failures, not review comments;
- `AgentLoop` no longer owns provider, tool, permission, completion, verification and context policy directly.

### 12. ACP protocol adapter foundation

Create:

- `src/apps/acp-server/`;
- `src/protocol-adapters/acp/`.

Implement:

- JSON-RPC stdio framing;
- request/response/notification dispatcher;
- cancellation-safe request registry;
- protocol schema validation;
- stdout-only JSON-RPC guard;
- stderr diagnostics logger;
- capability negotiation based on implemented features.

Exit:

- `soba acp` initializes and handles malformed JSON-RPC safely with mocked runtime in tests.

### 13. ACP lifecycle and prompt coverage

Implement:

- `authenticate`;
- `initialize`;
- `logout`;
- `session/new`;
- `session/list`;
- `session/load`;
- `session/resume`;
- `session/prompt`;
- `session/cancel`;
- `session/close`;
- `session/delete`;
- `session/set_config_option`;
- `session/set_mode`;
- `session/update` mapping.

Exit:

- each ACP agent method has unit tests against mocked runtime;
- load replay produces deterministic `session/update` notifications;
- delete cancels active work before removing runtime session state.

### 14. ACP content, tools and permissions

Implement:

- text/resource/resource link content mapping;
- image content support if provider/runtime path can preserve it;
- command input mapping;
- tool call create/update events with kind, status, raw input, raw output, content and locations;
- usage/cost updates;
- `session/request_permission` client request mapping;
- SOBA deny/once/session/repo/full mapping to ACP permission options.

Exit:

- editor users can follow assistant text, tool work, file locations, permissions and context usage from Zed.

### 15. ACP client capability delegation

Implement where the client advertises support:

- `fs/read_text_file`;
- `fs/write_text_file`;
- `terminal/create`;
- `terminal/output`;
- `terminal/wait_for_exit`;
- `terminal/kill`;
- `terminal/release`.

Exit:

- SOBA can prefer editor-backed fs/terminal operations for ACP sessions when configured;
- default behavior still uses existing local SOBA tools when client capabilities are absent.

### 16. Post-ACP architecture gate

Add:

- ACP-specific forbidden-import tests;
- tests proving ACP adapter talks only to `SobaRuntime`, runtime events and ports;
- tests proving ACP permission/config/mode decisions are delegated to application/core services;
- regression smoke for print CLI and TUI construction after ACP is added.

Exit:

- ACP can be removed without touching workflow policy;
- ACP cannot bypass verification, completion, trust, memory or recovery controllers;
- all protocol-specific behavior is contained in `src/apps/acp-server/` and `src/protocol-adapters/acp/`.

### 17. Zed smoke path

Add docs/examples:

- local Zed agent server config;
- required env;
- troubleshooting no-output/stdout corruption;
- permission behavior.

Exit:

- manual run can start SOBA from Zed and complete a text prompt.

### 18. ACP conformance matrix

Add:

- method-by-method golden tests;
- capability advertisement tests;
- invalid request/error code tests;
- stdout corruption tests;
- cancellation race tests;
- session load/resume/delete tests;
- permission denial/allow-once/allow-session/repo/full tests;
- Zed manual smoke checklist.

Exit:

- every advertised ACP capability is backed by test coverage.

## Checkpoint cadence

- after 02: runtime factory baseline;
- after 04: shared runtime contract baseline;
- after 07: model/tool/permission extraction baseline;
- after 09: completion/verification/context extraction baseline;
- after 11: clean architecture pre-gate;
- after 12: ACP transport baseline;
- after 14: ACP lifecycle/prompt/permission baseline;
- after 15: ACP client capability delegation baseline;
- after 16: post-ACP architecture gate;
- after 18: v0.5.0 release candidate.

## Mandatory gates

For code tasks:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```

For ACP protocol changes:

```bash
bun test tests/core tests/cli tests/evals
bun test tests/acp
```

The `tests/acp` path is created during ACP implementation.
