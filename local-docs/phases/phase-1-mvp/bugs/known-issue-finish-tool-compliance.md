# Known Issue: Model-Dependent `finish` Tool Compliance — RESOLVED

## Status: FIXED ✅

## Summary

Qwen/Qwen3.6-27B-FP8 frequently returns plain-text commentary after `edit`/`write` operations instead of invoking the required `finish` control tool or a verification tool. Previously, the agent-loop policy treated such text-only responses as intermediate and issued autonomous follow-ups. After exhausting `maxAutonomousFollowUps`, the loop stopped with a `loop-guard` error.

## Observed Behavior (Before Fix)

- DeepSeek-style models reliably call `finish` after file mutations.
- Qwen/Qwen3.6-27B-FP8 emits messages like "Готово" or "Проверим результат" without tool calls.
- The loop nudged the model up to `maxAutonomousFollowUps` times, then failed with:
  `No tool calls or finish after N attempts. The model kept outputting commentary instead of taking action.`

## Root Cause

The agent loop always treated `hasMutatedFiles === true` + exhausted follow-ups as a hard error, regardless of whether there were active unresolved tool errors. This made the loop model-dependent.

## Applied Fix

Changed the loop exit condition in `src/core/loop/agent-loop.ts` (lines ~1031-1070):

**Before:** When follow-ups exhausted and `hasMutatedFiles` was true, always emit a loop-guard error.

**After:** When follow-ups exhausted:
1. Check for active unresolved errors first — if any exist, emit loop-guard error (hard stop).
2. If no active errors, accept the text-only response as a final answer regardless of `hasMutatedFiles`.

This makes the completion gate model-agnostic: successful work without errors is accepted whether or not the model calls `finish`.

## Test Changes

- Updated `tests/agent-loop.test.ts`:
  - Renamed `"ограничивает повторяющиеся commentary без tool call"` → `"accepts repeated commentary after edit as final when no active errors (Qwen-style no-finish model)"`. Now expects 0 errors and no `turn_error` events.
  - Added `"stops with loop-guard when commentary follows edit AND there are active errors"`. Verifies that active errors still trigger a hard stop.

## Validation

- `bun test` — 394 pass, 0 fail
- `bun run lint` — 0 errors
- `bun run build` — successful (340KB bundle)

## Remaining Considerations

1. **Verification evidence is skipped.** When a model doesn't call `finish`, the loop also skips the verification-evidence requirement. If stricter verification is needed, consider option 3 from the original document: auto-run `biome check` / `bun test` before accepting the turn as completed.
2. **No provider-specific adapter needed.** The fix works universally because it uses the signal that already exists (active errors) rather than model detection.
