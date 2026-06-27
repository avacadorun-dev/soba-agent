# ACP + Zed Plan

## Goal

Make SOBA fully usable from Zed through the current Agent Client Protocol v1 surface while preserving the same
runtime guarantees as TUI.

## Expected user workflow

1. User installs/runs SOBA.
2. User configures Zed to launch `soba acp`.
3. Zed creates a session with project `cwd`.
4. User sends prompts from Zed Agent Panel.
5. SOBA streams assistant text, tool calls, permission requests and completion status back to Zed.

## Minimal Zed-facing command

```bash
soba acp
```

The command must:

- stay alive;
- read JSON-RPC messages from stdin;
- write only JSON-RPC messages to stdout;
- log diagnostics to stderr;
- exit cleanly when stdin closes.

## ACP method mapping

| Method | v0.5.0 | Notes |
|---|---:|---|
| `authenticate` | yes | implemented when SOBA has an auth provider, otherwise explicit unsupported error/no-op |
| `initialize` | yes | protocol version 1 and exact advertised capabilities |
| `logout` | yes | clears ACP auth state when supported |
| `session/list` | yes | maps local SOBA sessions |
| `session/new` | yes | creates persistent SOBA session for `cwd` |
| `session/load` | yes | opens session and replays history through `session/update` |
| `session/resume` | yes | opens existing session without replay |
| `session/prompt` | yes | maps content blocks to `UserTurnInput` |
| `session/cancel` | yes | calls runtime cancellation |
| `session/close` | yes | cancels and releases runtime session references |
| `session/delete` | yes | cancels and deletes persisted session state |
| `session/set_config_option` | yes | maps ACP config option to SOBA runtime config |
| `session/set_mode` | yes | maps ACP mode to SOBA permission/workflow mode |
| `session/update` | yes | all advertised update variants emitted by adapter |

## Client capability usage

SOBA may call client methods only when Zed advertises support:

| Client method | SOBA use |
|---|---|
| `session/request_permission` | editor-native permission prompt |
| `fs/read_text_file` | read editor-backed file content |
| `fs/write_text_file` | write editor-backed file content |
| `terminal/create` | create editor terminal for command execution |
| `terminal/output` | stream command output back into runtime/tool events |
| `terminal/wait_for_exit` | wait for command completion |
| `terminal/kill` | cancel running command |
| `terminal/release` | release terminal handle |

## Content mapping

ACP text:

```json
{ "type": "text", "text": "Fix this test" }
```

Runtime:

```typescript
{ type: "text", text: "Fix this test" }
```

ACP embedded resource:

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///project/src/app.ts",
    "mimeType": "text/typescript",
    "text": "..."
  }
}
```

Runtime:

```typescript
{ type: "resource", uri: "file:///project/src/app.ts", mimeType: "text/typescript", text: "..." }
```

ACP resource link maps to runtime `resource_link`. Image content is supported only when the provider/runtime path can
preserve it end-to-end; otherwise SOBA must not advertise image prompt capability.

Security rule:

- embedded resource text is user/context data;
- it must not override system/developer/project instructions;
- dangerous operations still require permission.

## Event mapping

| Runtime event | ACP `session/update` |
|---|---|
| assistant delta | `agent_message_chunk` |
| tool started | `tool_call` |
| tool progress/result | `tool_call_update` with status, raw output, content and locations |
| usage update | `usage_update` |
| config/mode update | matching ACP session update variant |
| final turn result | `session/prompt` response with stop reason |

## Permission mapping

SOBA approval choices:

- deny;
- once;
- session;
- repo;
- full.

ACP options:

- reject once;
- allow once;
- allow always.

v0.5.0 mapping:

| ACP option | SOBA decision |
|---|---|
| reject once | deny |
| allow once | once |
| allow always/session | session |
| allow repo | repo |
| allow full | full |

If Zed only displays the three standard options, SOBA must preserve the richer decisions internally and expose repo/full
through supported option metadata only when the client can render them clearly.

## Testing

Protocol tests:

- malformed JSON line returns JSON-RPC error;
- stdout has no non-JSON bytes;
- initialize returns expected capabilities;
- session/new returns session id;
- session/list returns persisted sessions;
- session/load replays updates deterministically;
- session/resume restores without replay;
- prompt streams at least one update and final response;
- cancel aborts active turn;
- close releases runtime resources;
- delete removes session state after cancellation;
- set_config_option and set_mode update runtime state;
- permission request resolves into runtime decision.
- client fs/terminal calls are used only when advertised.

Manual Zed smoke:

- configure Zed agent server command;
- open repository;
- run read-only prompt;
- run tool-using prompt;
- deny a dangerous command;
- cancel a long command.
