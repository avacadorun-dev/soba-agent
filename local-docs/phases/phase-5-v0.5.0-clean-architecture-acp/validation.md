# v0.5.0 Validation

## Architecture validation

Pre-ACP gate:

- Core has no imports from app/protocol/TUI layers.
- Runtime factory is the only broad composition point.
- `AgentLoop` is decomposed or reduced to a compatibility facade.
- Provider, tool, permission, completion, verification and context policy live in focused controllers/services.
- Print/TUI share the same runtime contract before ACP is introduced.
- ACP implementation has not started before these checks are green.

Post-ACP gate:

- ACP adapter uses `SobaRuntime`, not `AgentLoop` internals.
- Print/TUI/ACP share the same runtime contract.
- ACP code does not import or mutate workflow policy internals.
- ACP code does not decide verification, completion, memory, trust or recovery policy.
- ACP can be removed without changing core workflow controllers.
- Verification/completion/tool execution/permission/context components have focused tests.

## Behavioral validation

The following v0.4.x behaviors must still pass:

- prompt answers stream in TUI;
- one-shot print mode works;
- sessions persist;
- tools execute through registry;
- MCP tools execute through registry;
- dangerous operations require approval;
- mutation requires verification evidence for normal completion;
- auto-verifier can run project checks;
- checkpoint events feed context scheduling;
- recovery memory policy does not write unsafe lessons.

## ACP validation

Full ACP v1:

- `soba acp` starts and waits for JSON-RPC.
- stdout is JSON-RPC only.
- malformed requests return JSON-RPC errors without crashing.
- unsupported/unadvertised capabilities are not exposed in `initialize`.
- `authenticate` and `logout` have explicit behavior.
- `initialize` works.
- `session/list` works.
- `session/new` works.
- `session/load` replays history.
- `session/resume` restores without replay.
- `session/prompt` produces `session/update` notifications.
- `session/cancel` aborts active turn.
- `session/close` releases runtime references.
- `session/delete` cancels active work and removes persisted state.
- `session/set_config_option` updates runtime config.
- `session/set_mode` updates runtime mode.
- permission request round trip works.
- `session/update` covers assistant chunks, tool create/update, locations, raw output, usage/cost and config/mode updates.
- slash command metadata is advertised when command metadata is available.
- client `fs/*` and `terminal/*` methods are called only when the client advertises them.
- cancellation races do not leak pending request promises.

## Release gate

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```

Manual:

- run TUI smoke;
- run print one-shot smoke;
- run ACP stdio smoke;
- run Zed smoke when Zed is available.
