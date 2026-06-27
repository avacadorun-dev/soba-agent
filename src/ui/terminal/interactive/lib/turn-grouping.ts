import type { TuiMessage } from "../model/types";

/**
 * Compute turn start indices for a sequence of messages.
 * A turn starts at each user message.
 *
 * For an empty or non-user-only sequence, returns empty array.
 */
export function computeTurnStarts(messages: readonly TuiMessage[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "user") {
      starts.push(i);
    }
  }
  return starts;
}

/**
 * For each message index, return the turn index it belongs to.
 * Messages before the first user message get -1.
 *
 * Returns an array of length totalMessages.
 */
export function computeTurnMap(starts: readonly number[], totalMessages: number): number[] {
  const map = new Array<number>(totalMessages).fill(-1);
  for (let ti = 0; ti < starts.length; ti++) {
    const start = starts[ti];
    const end = ti + 1 < starts.length ? starts[ti + 1] : totalMessages;
    for (let i = start; i < end; i++) {
      map[i] = ti;
    }
  }
  return map;
}

/**
 * Check if a message at the given index starts a turn.
 */
export function isTurnStart(index: number, starts: readonly number[]): boolean {
  return starts.includes(index);
}
