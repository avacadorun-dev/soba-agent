# v0.5.0 Technical Spec — Clean Architecture + ACP

This document is the normative technical spec for Phase 5.

## Architecture rule

Core runtime must not import app or protocol code.

Allowed dependency direction:

```text
apps -> application -> core -> ports
infrastructure -> core ports
protocol-adapters -> core ports/events
```

Forbidden:

- `src/core/**` importing `src/widgets/**`;
- `src/core/**` importing `src/tui/**`;
- `src/core/**` importing `src/protocol-adapters/**`;
- `src/core/**` importing ACP JSON-RPC code;
- protocol adapters deciding verification, completion, memory or trust policy.

## Architecture gates

ACP implementation is blocked until the clean architecture pre-gate passes.

Pre-ACP gate:

- app entrypoints are thin composition/argument-parsing layers;
- `src/application/**` owns runtime composition and session lifecycle orchestration;
- `src/core/**` owns workflow policy through focused controllers and ports;
- `src/infrastructure/**` implements provider, MCP, filesystem, process and tool ports;
- `src/protocol-adapters/**` only translates protocol/app events to runtime contracts;
- import-boundary tests fail on any core import from app, widgets, TUI, protocol adapters or ACP code;
- `AgentLoop` is either decomposed or reduced to a compatibility facade over the new controllers.

Post-ACP gate:

- ACP code has no authority to decide verification, completion, memory, trust or recovery policy;
- ACP adapter depends on `SobaRuntime`, runtime events and permission/session ports only;
- adding/removing ACP does not require changes in workflow controllers except new protocol-neutral events;
- print CLI and TUI still use the same runtime contract and pass existing behavior tests;
- import-boundary tests include ACP-specific forbidden imports.

## Core runtime contract

```typescript
export interface SobaRuntime {
  createSession(input: CreateSessionInput): Promise<RuntimeSessionInfo>;
  openSession(input: OpenSessionInput): Promise<RuntimeSessionInfo>;
  loadSession(input: LoadSessionInput): Promise<RuntimeSessionSnapshot>;
  resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionInfo>;
  listSessions(input: ListSessionsInput): Promise<RuntimeSessionInfo[]>;
  closeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionConfig(input: SetSessionConfigInput): Promise<RuntimeSessionInfo>;
  setSessionMode(input: SetSessionModeInput): Promise<RuntimeSessionInfo>;
  runTurn(input: UserTurnInput): Promise<TurnResult>;
  cancelTurn(sessionId: string): void;
  onEvent(listener: RuntimeEventListener): Unsubscribe;
}
```

Compatibility rule:

- Existing `AgentLoop.runTurn(userText: string)` may remain as a wrapper during migration.
- New adapters must use `SobaRuntime.runTurn(UserTurnInput)`.

## Turn input

```typescript
export interface UserTurnInput {
  sessionId: string;
  content: RuntimeContentBlock[];
  source: "print" | "tui" | "acp";
  command?: RuntimeCommandInput;
}

export type RuntimeContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; uri: string; text: string; mimeType?: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string };
```

Text-only CLI/TUI input is represented as one `text` block.

ACP `resource` blocks are converted to explicit, untrusted embedded context. The model must not treat embedded
resource text as higher-priority instructions.

## Runtime events

Runtime emits protocol-neutral events:

```typescript
export type RuntimeEvent =
  | { type: "turn_started"; sessionId: string; turnIndex: number; userTextPreview: string }
  | { type: "assistant_delta"; sessionId: string; messageId: string; text: string }
  | { type: "assistant_done"; sessionId: string; messageId: string; text: string }
  | { type: "tool_started"; sessionId: string; toolCallId: string; title: string; kind: RuntimeToolKind; rawInput?: object }
  | { type: "tool_updated"; sessionId: string; toolCallId: string; status: RuntimeToolStatus; content?: RuntimeContentBlock[]; rawOutput?: object; locations?: RuntimeToolLocation[] }
  | { type: "permission_requested"; sessionId: string; requestId: string; toolCallId: string; options: PermissionOption[] }
  | { type: "usage_updated"; sessionId: string; usedTokens: number; contextWindow?: number; cost?: RuntimeCost }
  | { type: "session_config_updated"; sessionId: string; options: RuntimeSessionConfigOption[] }
  | { type: "session_mode_updated"; sessionId: string; modes: RuntimeSessionModeState }
  | { type: "narration"; sessionId: string; kind: string; message: string; evidenceIds: string[] }
  | { type: "turn_finished"; sessionId: string; stopReason: RuntimeStopReason };
```

Existing `AgentEvent` can be adapted into this contract during migration.

## Runtime controllers

### WorkflowEngine

Responsibility:

- task lifecycle;
- iteration limits;
- state transitions;
- orchestration of model/tool/verification/completion.

Does not:

- execute tools directly;
- parse ACP;
- render TUI;
- classify dangerous commands directly.

### ModelTurnRunner

Responsibility:

- build provider request;
- normalize streaming and non-streaming responses;
- normalize provider errors.

### ToolCallExecutor

Responsibility:

- validate tool args;
- execute built-in and MCP tools through one path;
- normalize results;
- return tool evidence.

### PermissionBroker

Responsibility:

- request approval from the active adapter;
- return `ApprovalDecision`;
- preserve once/session/repo/full/deny semantics.

### CompletionController

Responsibility:

- parse finish tool;
- accept/reject completion;
- produce rejection guidance.

### VerificationController

Responsibility:

- task-kind verification policy;
- auto-verifier execution;
- Fix-Until-Green decisions;
- evidence updates.

### ContextController

Responsibility:

- pre-inference context check;
- overflow recovery;
- checkpoint/milestone capsule scheduling;
- provider usage recording.

## ACP v1 server

ACP mode is started with:

```bash
soba acp
```

Transport:

- stdio;
- newline-delimited JSON-RPC;
- stdout contains only ACP JSON-RPC messages;
- logs go to stderr.

Implementation rule:

- SOBA must implement every current ACP v1 method that belongs to the Agent server role.
- SOBA may call client-side ACP methods only when the client advertised the required capability.
- SOBA must not advertise capabilities until protocol tests verify them.

Agent methods:

| ACP method | Runtime mapping |
|---|---|
| `authenticate` | optional auth provider flow, no-op/error when auth is not configured |
| `initialize` | protocol/capability negotiation |
| `logout` | clear configured ACP auth credentials when supported |
| `session/list` | `SobaRuntime.listSessions` |
| `session/new` | `SobaRuntime.createSession` |
| `session/load` | `SobaRuntime.loadSession` and replay as `session/update` |
| `session/resume` | `SobaRuntime.resumeSession` without replay |
| `session/prompt` | `SobaRuntime.runTurn` |
| `session/cancel` | `SobaRuntime.cancelTurn` |
| `session/close` | `SobaRuntime.closeSession` |
| `session/delete` | `SobaRuntime.deleteSession` after active turn cancellation |
| `session/set_config_option` | `SobaRuntime.setSessionConfig` |
| `session/set_mode` | `SobaRuntime.setSessionMode` |

Client methods used by SOBA when advertised:

| ACP method | SOBA use |
|---|---|
| `session/request_permission` | adapter implementation of `PermissionBroker` |
| `fs/read_text_file` | optional editor-backed read when runtime requests editor state |
| `fs/write_text_file` | optional editor-backed write when runtime chooses ACP fs delegation |
| `terminal/create` | optional client terminal creation for command tools |
| `terminal/output` | optional streamed command output collection |
| `terminal/wait_for_exit` | optional command completion wait |
| `terminal/kill` | cancellation of client terminal command |
| `terminal/release` | release terminal handle after command completion |

Required notifications:

| Runtime event | ACP notification |
|---|---|
| assistant delta/done | `session/update` `agent_message_chunk` |
| tool started | `session/update` `tool_call` |
| tool updated | `session/update` `tool_call_update` |
| usage updated | `session/update` `usage_update` |
| session config/mode updated | `session/update` config/mode update |

Permission:

- runtime `permission_requested` maps to ACP `session/request_permission`;
- ACP selected option maps back to `ApprovalDecision`;
- cancelled permission maps to deny/cancel according to turn state.

Capabilities for v0.5.0:

```json
{
  "loadSession": true,
  "promptCapabilities": {
    "embeddedContext": true,
    "image": true,
    "audio": false
  },
  "sessionConfig": true,
  "sessionModes": true
}
```

The exact JSON shape must be taken from the ACP v1 schema at implementation time and covered by golden tests.

## SOLID acceptance

- Single Responsibility: each controller has one reason to change.
- Open/Closed: ACP is added by an adapter, not by editing workflow policy.
- Liskov: print/TUI/ACP permission brokers return the same decision union.
- Interface Segregation: model, session, tool catalog, tool execution and permission ports are separate.
- Dependency Inversion: workflow depends on ports, not concrete MCP/TUI/ACP/provider code.

## Test requirements

P0 tests:

- runtime factory smoke test;
- existing print CLI still works;
- existing TUI construction path still works or remains covered by current tests;
- `AgentLoop` characterization tests for finish, verification, permission and cancellation;
- ACP stdio framing test;
- ACP initialize/session-new/session-prompt smoke test with mocked runtime;
- architecture import-boundary test.
