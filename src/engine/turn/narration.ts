export const WORKING_NARRATION_EVENT_TYPES = [
  "acknowledgement",
  "context_scan",
  "observation",
  "plan",
  "edit_intent",
  "verification",
  "recovery",
  "blocked",
  "completion",
] as const;

export type WorkingNarrationEventType = (typeof WORKING_NARRATION_EVENT_TYPES)[number];

export interface WorkingNarration {
  eventType: WorkingNarrationEventType;
  message: string;
  evidenceIds: string[];
}

export interface WorkingNarrationInput {
  eventType: WorkingNarrationEventType;
  message: string;
  evidenceIds?: string[];
}

export type WorkingNarrationEmitter = (
  eventType: WorkingNarrationEventType,
  message: string,
  evidenceIds?: string[],
) => void;

const MAX_NARRATION_MESSAGE_LENGTH = 280;

const UNSAFE_NARRATION_PATTERNS = [
  /chain[- ]of[- ]thought/i,
  /hidden reasoning/i,
  /private reasoning/i,
  /system prompt/i,
  /developer message/i,
  /api[_-]?key/i,
  /\bsk-[a-z0-9_-]{8,}/i,
  /fabricated tool result/i,
];

const REDACTED_NARRATION_MESSAGE = "Working update redacted because it contained private or unsafe content.";

export function createWorkingNarration(input: WorkingNarrationInput): WorkingNarration {
  return {
    eventType: input.eventType,
    message: sanitizeWorkingNarrationMessage(input.message),
    evidenceIds: sanitizeEvidenceIds(input.evidenceIds ?? []),
  };
}

export function sanitizeWorkingNarrationMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return REDACTED_NARRATION_MESSAGE;
  if (UNSAFE_NARRATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return REDACTED_NARRATION_MESSAGE;
  }
  if (normalized.length <= MAX_NARRATION_MESSAGE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_NARRATION_MESSAGE_LENGTH - 1).trimEnd()}...`;
}

export function isNonTrivialPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length === 0) return false;
  if (text.length > 80) return true;
  return (
    /\b(add|build|change|fix|implement|update|write|edit|test|lint|debug|review|refactor)\b/i.test(text) ||
    /(создай|добавь|измени|исправь|обнови|напиши|почини|проверь|сделай|ревью)/i.test(text)
  );
}

export function createWorkingNarrationGate(input: {
  enabled: boolean;
  emit: WorkingNarrationEmitter;
}): WorkingNarrationEmitter {
  const emittedTypes = new Set<WorkingNarrationEventType>();

  return (eventType, message, evidenceIds = []) => {
    if (!input.enabled || emittedTypes.has(eventType)) return;
    emittedTypes.add(eventType);
    input.emit(eventType, message, evidenceIds);
  };
}

function sanitizeEvidenceIds(evidenceIds: string[]): string[] {
  return [...new Set(evidenceIds.map((id) => id.trim()).filter((id) => /^[a-zA-Z0-9_.:-]+$/.test(id)))];
}
