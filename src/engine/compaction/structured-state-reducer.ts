import type { ItemParam } from "../../kernel/transcript/types";
import type { PortableContextState } from "../../kernel/transcript/types-v2";
import {
  type StructuredStateLexiconExtension,
  structuredStatePatterns,
} from "./structured-state-lexicon";

interface ClarificationCall {
  question: string;
  options: Array<{ id: string; label: string }>;
}

interface ClarificationFact extends ClarificationCall {
  answer: string;
}

/**
 * Apply authoritative structured tool outcomes after model or deterministic
 * summarization. An answered ask_user call supersedes stale "waiting for the
 * user" state carried by an older capsule and becomes an explicit decision.
 */
export function reconcileStructuredState(
  state: PortableContextState,
  sourceItems: ItemParam[],
  lexiconExtension: StructuredStateLexiconExtension = {},
): PortableContextState {
  const clarifications = extractAnsweredClarifications(sourceItems);
  if (clarifications.length === 0) return state;

  const decisions = [...state.decisions];
  for (const clarification of clarifications) {
    const decision = `Clarification answered: ${clarification.question} → ${clarification.answer}`;
    if (!decisions.some((entry) => entry.decision === decision)) {
      decisions.push({ decision, rationale: "Structured ask_user response" });
    }
  }

  const keep = (value: string) =>
    !isSupersededClarificationWait(value, clarifications, lexiconExtension);
  return {
    ...state,
    inProgress: state.inProgress.filter(keep),
    pending: state.pending.filter(keep),
    decisions,
    blockers: state.blockers.filter(keep),
    nextSteps: state.nextSteps.filter(keep),
  };
}

function extractAnsweredClarifications(items: ItemParam[]): ClarificationFact[] {
  const calls = new Map<string, ClarificationCall>();
  const facts: ClarificationFact[] = [];

  for (const item of items) {
    if (item.type === "function_call" && item.name === "ask_user") {
      const call = parseClarificationCall(item.arguments);
      if (call) calls.set(item.call_id, call);
      continue;
    }
    if (item.type !== "function_call_output") continue;
    const call = calls.get(item.call_id);
    if (!call || typeof item.output !== "string") continue;
    const match = /^User selected:\s*(.+?)(?:\nOther details:\s*([\s\S]+))?$/i.exec(item.output.trim());
    if (!match?.[1]) continue;
    facts.push({
      ...call,
      answer: `${match[1].trim()}${match[2] ? `; ${match[2].trim()}` : ""}`,
    });
  }

  return facts;
}

function parseClarificationCall(argumentsJson: string): ClarificationCall | null {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    if (typeof parsed.question !== "string" || !Array.isArray(parsed.options)) return null;
    const options = parsed.options.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const option = value as Record<string, unknown>;
      return typeof option.id === "string" && typeof option.label === "string"
        ? [{ id: option.id, label: option.label }]
        : [];
    });
    return { question: parsed.question.trim(), options };
  } catch {
    return null;
  }
}

function isSupersededClarificationWait(
  value: string,
  facts: ClarificationFact[],
  lexiconExtension: StructuredStateLexiconExtension,
): boolean {
  const normalized = value.toLocaleLowerCase();
  const explicitlyWaitsForUser = structuredStatePatterns("explicitUserWait", lexiconExtension)
    .some((pattern) => pattern.test(normalized));
  if (explicitlyWaitsForUser) return true;

  // For terse state such as "Specify the subdirectory", require both a
  // clarification verb and topic overlap with the answered request.
  if (!structuredStatePatterns("clarificationVerb", lexiconExtension).some((pattern) => pattern.test(normalized))) {
    return false;
  }
  const valueTokens = tokens(normalized);
  return facts.some((fact) => {
    const factTokens = tokens([
      fact.question,
      fact.answer,
      ...fact.options.flatMap((option) => [option.id.replaceAll("_", " "), option.label]),
    ].join(" "));
    return valueTokens.some((left) => factTokens.some((right) => tokenMatches(left, right)));
  });
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function tokenMatches(left: string, right: string): boolean {
  if (left.length < 5 || right.length < 5) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}
