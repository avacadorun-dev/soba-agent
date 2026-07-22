/** Synthetic model defaults used when provider discovery has not supplied limits yet. */
export const DEFAULT_SYNTHETIC_CONTEXT_WINDOW = 128_000;
export const DEFAULT_SYNTHETIC_MAX_OUTPUT = 32_768;

/** Reserve used by compaction when the user leaves the request cap to the provider. */
export function resolveOutputReserveTokens(
  maxOutputCapability: number,
  explicitCompletionLimit: number,
): number {
  if (explicitCompletionLimit > 0) return explicitCompletionLimit;
  return Math.min(maxOutputCapability, DEFAULT_SYNTHETIC_MAX_OUTPUT);
}
