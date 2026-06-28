type RedactionCategory =
  | "private_key"
  | "credential_url"
  | "bearer_token"
  | "api_key"
  | "session_identifier"
  | "provider_identifier"
  | "absolute_home_path";

interface RedactionRule {
  category: RedactionCategory;
  pattern: RegExp;
  replace(match: string, marker: string): string;
}

interface RedactionState {
  markers: Map<string, string>;
  counts: Map<RedactionCategory, number>;
  nextByCategory: Map<RedactionCategory, number>;
}

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const CREDENTIAL_URL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const API_KEY_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{12,})["']?/gi;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const SESSION_ID_PATTERN = /\b(?:sess|session|thread|conversation)[_-](?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}\b/gi;
const PROVIDER_IDENTIFIER_PATTERN = /\b(?:openai|anthropic|google|xai)::[^\s"'`),\]}]+/gi;

const REDACTION_RULES: RedactionRule[] = [
  {
    category: "private_key",
    pattern: PRIVATE_KEY_PATTERN,
    replace: (_match, marker) => marker,
  },
  {
    category: "credential_url",
    pattern: CREDENTIAL_URL_PATTERN,
    replace: (match, marker) => {
      const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)/i.exec(match);
      return `${schemeMatch?.[1] ?? ""}${marker}@`;
    },
  },
  {
    category: "bearer_token",
    pattern: BEARER_TOKEN_PATTERN,
    replace: (_match, marker) => `Bearer ${marker}`,
  },
  {
    category: "api_key",
    pattern: API_KEY_ASSIGNMENT_PATTERN,
    replace: (match, marker) => {
      const keyMatch = /^([^:=]+)\s*[:=]/.exec(match);
      return `${keyMatch?.[1].trim() ?? "secret"}=${marker}`;
    },
  },
  {
    category: "api_key",
    pattern: OPENAI_KEY_PATTERN,
    replace: (_match, marker) => marker,
  },
  {
    category: "session_identifier",
    pattern: SESSION_ID_PATTERN,
    replace: (_match, marker) => marker,
  },
  {
    category: "provider_identifier",
    pattern: PROVIDER_IDENTIFIER_PATTERN,
    replace: (_match, marker) => marker,
  },
];

export function sanitizePortableText(text: string): string {
  const state: RedactionState = {
    markers: new Map(),
    counts: new Map(),
    nextByCategory: new Map(),
  };
  return sanitizeString(text, state, getHomeDirectory());
}

export function detectPotentialSecret(text: string): boolean {
  const normalized = text.replace(/\[REDACTED:[a-z_]+:\d+\]/g, "[REDACTED]");
  if (PRIVATE_KEY_PATTERN.test(normalized)) return true;
  PRIVATE_KEY_PATTERN.lastIndex = 0;
  if (BEARER_TOKEN_PATTERN.test(normalized)) return true;
  BEARER_TOKEN_PATTERN.lastIndex = 0;
  if (OPENAI_KEY_PATTERN.test(normalized)) return true;
  OPENAI_KEY_PATTERN.lastIndex = 0;
  if (CREDENTIAL_URL_PATTERN.test(normalized)) return true;
  CREDENTIAL_URL_PATTERN.lastIndex = 0;
  if (API_KEY_ASSIGNMENT_PATTERN.test(normalized)) return true;
  API_KEY_ASSIGNMENT_PATTERN.lastIndex = 0;
  return false;
}

function sanitizeString(value: string, state: RedactionState, homeDirectory: string | null): string {
  let result = value;
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, (match) => rule.replace(match, markerFor(rule.category, match, state)));
  }

  if (homeDirectory && result.includes(homeDirectory)) {
    const escapedHome = escapeRegExp(homeDirectory);
    const homePathPattern = new RegExp(`${escapedHome}[^\\s"'\\]\`),}]*`, "g");
    result = result.replace(homePathPattern, (match) => markerFor("absolute_home_path", match, state));
  }

  return result;
}

function markerFor(category: RedactionCategory, rawValue: string, state: RedactionState): string {
  const key = `${category}:${rawValue}`;
  const existing = state.markers.get(key);
  if (existing) {
    incrementCount(category, state);
    return existing;
  }

  const next = (state.nextByCategory.get(category) ?? 0) + 1;
  state.nextByCategory.set(category, next);
  const marker = `[REDACTED:${category}:${next}]`;
  state.markers.set(key, marker);
  incrementCount(category, state);
  return marker;
}

function incrementCount(category: RedactionCategory, state: RedactionState): void {
  state.counts.set(category, (state.counts.get(category) ?? 0) + 1);
}

function getHomeDirectory(): string | null {
  const home = process.env.HOME;
  if (!home || home === "/") return null;
  return home;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
