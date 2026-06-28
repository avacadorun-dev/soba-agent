import type { FlightRecordData } from "../../../kernel/transcript/types";

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 4_000;
const MAX_DEPTH = 8;

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|cookie|credential|password|secret|token)/i;

export function redactFlightRecordData(data: FlightRecordData): FlightRecordData {
  return {
    ...data,
    payload: redactFlightValue(data.payload, 0),
  };
}

function redactFlightValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[Max depth reached]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "function") return "[Function]";
  if (Array.isArray(value)) return value.map((item) => redactFlightValue(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const record: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    record[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactFlightValue(field, depth + 1);
  }
  return record;
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}\n[Flight record string truncated]`;
}
