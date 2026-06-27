# Bug: Model outputs only thinking (empty visible text) after tool use

**Статус:** исправлено в Phase 1 / SOBA 0.2.0.

## Symptom

After a successful tool call (e.g., `bash`), the model returns responses that contain **only reasoning_content** — the visible `output_text` is empty. In the TUI this appears as:

```
~ Thinking
Assistant
~ Thinking
Assistant
~ Thinking
Assistant
```

The loop silently accepts these empty responses as a final answer and stops.

## Root Cause

Direct calls to the configured Qwen/Runpod endpoint showed that these responses
were not thinking-only. The provider returned:

- `reasoning_content`: absent
- `content`: `"\n\n"`
- `finish_reason`: `"tool_calls"`
- a valid streamed tool call with index `0`

The OpenAI adapter used one `sentOutputItemAdded: Set<number>` for both message
items and function-call items. The whitespace message marked index `0` as
already added. When the tool call with index `0` arrived, the adapter omitted
its `response.output_item.added` event. `AgentLoop` consequently saw only an
empty assistant message and lost the valid tool call.

Pi-agent handles text blocks and tool-call blocks independently, so it does not
have this index collision.

## What changed

### Fix 1: Track message and tool-call indexes separately

The stream accumulator now has independent sets for message items and
function-call items. A whitespace message and a tool call may safely share
provider index `0`.

### Fix 2: Suppress whitespace-only assistant messages

Leading whitespace is buffered. It is emitted only if substantive text follows.
If the response contains only whitespace plus tool calls, no empty Assistant
block is rendered.

### Fix 3: Correctly materialize reasoning-only streams

At `[DONE]`, the OpenAI adapter now creates a completed assistant message for
every index that has text or reasoning. A reasoning-only message keeps:

```text
content: []
reasoning_content: "..."
```

Reasoning is not promoted to visible `output_text`.

### Fix 4: Do not replay unfinished reasoning

The agent loop still detects the empty visible response and sends a recovery
instruction, but it no longer stores the reasoning-only assistant message in
the request history. The next model invocation receives the recovery
instruction without being anchored to its unfinished internal monologue.

## Status

**FIXED locally** — implementation and regression tests pass. Verification:

- `bun test`: 401 passed
- `bun run lint`: clean
- `bun run build`: successful

Live verification against the configured Qwen endpoint:

- tool calls executed: 1
- substantive assistant messages: 1
- blank assistant messages: 0
- active errors: 0

## How to verify manually

1. Run the agent with the affected reasoning model on a task that triggers tool use.
2. When the provider returns reasoning-only output, the loop sends a recovery
   instruction without replaying the unfinished reasoning message.
3. The model should produce visible output or call a tool on the next attempt.
4. If it still returns reasoning-only output after all attempts, the explicit
   `No visible response` loop-guard remains as the final safety net.

## If it still happens

Possible additional causes:

1. Inspect the raw provider stream and confirm it ends with `finish_reason:
   "stop"` rather than `"length"`.
2. Check whether the provider requires a model-specific option to disable
   thinking for the recovery request.
3. Confirm the next request does not contain the previous reasoning-only
   assistant message.
