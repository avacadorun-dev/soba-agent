# Task 06 — MCP JSON-RPC core

Date: 2026-06-19

Implemented transport-independent JSON-RPC 2.0 core in `src/core/mcp/json-rpc.ts`.

## Contract

- `JsonRpcEndpoint` owns request ids, pending request correlation, per-request timeout and abort cleanup.
- Incoming responses resolve/reject only matching pending requests; unknown ids are protocol errors and do not mutate pending state.
- Incoming requests are dispatched through an optional request handler and answered with success or JSON-RPC error responses.
- Incoming notifications are dispatched without a response.
- Malformed JSON/messages are normalized as JSON-RPC protocol errors.
- JSON-RPC error objects are normalized before they reach callers.
- `close()` rejects all pending requests and clears the pending map.

## Stdio framing note

The planned stdio transport should use newline-delimited JSON-RPC messages:

- outbound: `JSON.stringify(message) + "\n"`;
- inbound: buffer chunks until `\n`, trim a trailing `\r`, ignore empty lines;
- EOF with a non-empty buffered tail can be flushed as one final message.

`JsonRpcLineFramer` implements this contract and stays transport-only: it does not parse MCP lifecycle semantics.

## Verification

- `bun test tests/core/mcp/json-rpc.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`
