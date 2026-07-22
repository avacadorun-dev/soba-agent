/** Canonical, provider-neutral reasoning controls used by the model gateway. */

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ReasoningSelection =
  | { mode: "provider_default" }
  | { mode: "effort"; effort: ReasoningEffort }
  | { mode: "budget"; maxTokens: number }
  | { mode: "toggle"; enabled: boolean };

export interface ReasoningCapabilities {
  control: "none" | "effort" | "budget" | "toggle" | "fixed";
  supportedEfforts?: ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  defaultEnabled?: boolean;
  mandatory?: boolean;
  minBudgetTokens?: number;
  maxBudgetTokens?: number;
  /** Some APIs (notably OpenRouter/Qwen) support more than one control form. */
  supportsBudget?: boolean;
  supportsToggle?: boolean;
}

/** Explicit adapter mapping. It is never inferred from a model name. */
export type ReasoningTransport =
  | "openai_chat"
  | "openai_responses"
  | "openrouter"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "qwen"
  | "ollama"
  | "none";

export interface ResolvedReasoningSelection {
  requested: ReasoningSelection;
  effective: ReasoningSelection;
  fallbackReason?: string;
}

export const DEFAULT_REASONING_SELECTION: ReasoningSelection = {
  mode: "provider_default",
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

export function isReasoningTransport(value: unknown): value is ReasoningTransport {
  return (
    value === "openai_chat" ||
    value === "openai_responses" ||
    value === "openrouter" ||
    value === "deepseek" ||
    value === "kimi" ||
    value === "minimax" ||
    value === "qwen" ||
    value === "ollama" ||
    value === "none"
  );
}

export function parseReasoningCapabilities(value: unknown): ReasoningCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.control !== "none" &&
    record.control !== "effort" &&
    record.control !== "budget" &&
    record.control !== "toggle" &&
    record.control !== "fixed"
  ) {
    return undefined;
  }
  const supportedEfforts = Array.isArray(record.supportedEfforts)
    ? record.supportedEfforts.filter(isReasoningEffort)
    : undefined;
  return {
    control: record.control,
    ...(supportedEfforts && supportedEfforts.length > 0 ? { supportedEfforts } : {}),
    ...(isReasoningEffort(record.defaultEffort) ? { defaultEffort: record.defaultEffort } : {}),
    ...(typeof record.defaultEnabled === "boolean" ? { defaultEnabled: record.defaultEnabled } : {}),
    ...(typeof record.mandatory === "boolean" ? { mandatory: record.mandatory } : {}),
    ...(isPositiveInteger(record.minBudgetTokens) ? { minBudgetTokens: record.minBudgetTokens } : {}),
    ...(isPositiveInteger(record.maxBudgetTokens) ? { maxBudgetTokens: record.maxBudgetTokens } : {}),
    ...(typeof record.supportsBudget === "boolean" ? { supportsBudget: record.supportsBudget } : {}),
    ...(typeof record.supportsToggle === "boolean" ? { supportsToggle: record.supportsToggle } : {}),
  };
}

export function parseReasoningSelection(value: unknown): ReasoningSelection | undefined {
  if (value === "provider_default" || value === "default") {
    return { mode: "provider_default" };
  }
  if (isReasoningEffort(value)) return { mode: "effort", effort: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (record.mode === "provider_default") return { mode: "provider_default" };
  if (record.mode === "effort" && isReasoningEffort(record.effort)) {
    return { mode: "effort", effort: record.effort };
  }
  if (
    record.mode === "budget" &&
    typeof record.maxTokens === "number" &&
    Number.isInteger(record.maxTokens) &&
    record.maxTokens > 0
  ) {
    return { mode: "budget", maxTokens: record.maxTokens };
  }
  if (record.mode === "toggle" && typeof record.enabled === "boolean") {
    return { mode: "toggle", enabled: record.enabled };
  }
  return undefined;
}

export function formatReasoningSelection(selection: ReasoningSelection): string {
  switch (selection.mode) {
    case "provider_default":
      return "provider default";
    case "effort":
      return selection.effort;
    case "budget":
      return `${selection.maxTokens} tokens`;
    case "toggle":
      return selection.enabled ? "on" : "off";
  }
}

export function reasoningSelectionToConfigValue(selection: ReasoningSelection): string {
  switch (selection.mode) {
    case "provider_default":
      return "default";
    case "effort":
      return selection.effort;
    case "budget":
      return `budget:${selection.maxTokens}`;
    case "toggle":
      return selection.enabled ? "on" : "off";
  }
}

export function parseReasoningConfigValue(value: unknown): ReasoningSelection | undefined {
  if (typeof value !== "string") return parseReasoningSelection(value);
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "provider_default") {
    return { mode: "provider_default" };
  }
  if (isReasoningEffort(normalized)) return { mode: "effort", effort: normalized };
  if (normalized === "on" || normalized === "enabled") return { mode: "toggle", enabled: true };
  if (normalized === "off" || normalized === "disabled") return { mode: "toggle", enabled: false };
  if (normalized.startsWith("budget:")) {
    const maxTokens = Number.parseInt(normalized.slice("budget:".length), 10);
    if (Number.isInteger(maxTokens) && maxTokens > 0) return { mode: "budget", maxTokens };
  }
  return undefined;
}

/**
 * Validate a requested policy against the active model without coercing it to
 * a nearby effort. Unsupported selections fall back to the provider default.
 */
export function resolveReasoningSelection(
  requested: ReasoningSelection,
  capabilities?: ReasoningCapabilities,
): ResolvedReasoningSelection {
  if (requested.mode === "provider_default") {
    return { requested, effective: requested };
  }
  if (!capabilities || capabilities.control === "none") {
    return fallback(requested, "The active model does not declare reasoning controls.");
  }
  if (capabilities.control === "fixed") {
    return fallback(requested, "The active model uses a fixed reasoning policy.");
  }

  if (requested.mode === "effort") {
    if (capabilities.mandatory && requested.effort === "none") {
      return fallback(requested, "Reasoning is mandatory for the active model.");
    }
    if (
      capabilities.control === "effort" &&
      (capabilities.supportedEfforts?.includes(requested.effort) ?? false)
    ) {
      return { requested, effective: requested };
    }
    const available = capabilities.control === "toggle"
      ? " The active model supports only /reasoning on or /reasoning off."
      : capabilities.supportedEfforts?.length
        ? ` Supported efforts: ${capabilities.supportedEfforts.join(", ")}.`
        : "";
    return fallback(
      requested,
      `Reasoning effort "${requested.effort}" is not supported by the active model.${available}`,
    );
  }

  if (requested.mode === "budget") {
    const min = capabilities.minBudgetTokens ?? 1;
    const max = capabilities.maxBudgetTokens ?? Number.POSITIVE_INFINITY;
    if (
      (capabilities.control === "budget" || capabilities.supportsBudget === true) &&
      requested.maxTokens >= min &&
      requested.maxTokens <= max
    ) {
      return { requested, effective: requested };
    }
    return fallback(requested, `Reasoning budget ${requested.maxTokens} is not supported by the active model.`);
  }

  if (capabilities.mandatory && !requested.enabled) {
    return fallback(requested, "Reasoning is mandatory for the active model.");
  }
  if (capabilities.control === "toggle" || capabilities.supportsToggle === true) {
    return { requested, effective: requested };
  }
  return fallback(requested, "The active model does not expose an on/off reasoning control.");
}

function fallback(requested: ReasoningSelection, fallbackReason: string): ResolvedReasoningSelection {
  return {
    requested,
    effective: { mode: "provider_default" },
    fallbackReason,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
