export interface StructuredStateLexiconExtension {
  explicitUserWait?: readonly RegExp[];
  clarificationVerb?: readonly RegExp[];
}

/**
 * Multilingual markers used only to reconcile state after an authoritative
 * ask_user result. Integrations may extend either group without changing the
 * reducer or branching on a locale.
 */
export const DEFAULT_STRUCTURED_STATE_LEXICON = {
  explicitUserWait: [
    /\bawait(?:ing)?\b.*\buser\b/u,
    /\bwait(?:ing)?\b.*\buser\b/u,
    /\buser\b.*\b(must|need|select|specif|choos|confirm|provide|name|answer)/u,
    /\b(ask|prompt)\b.*\buser\b/u,
    /\bconfirmation\b.*\b(user|needed|required)/u,
    /\b(has not|hasn't|not yet)\b.*\b(provided|selected|specified|confirmed|named)/u,
    /\bonce\b.*\b(named|selected|specified|confirmed|answered)/u,
    /\bafter\b.*\b(selection|specification|confirmation|answer)/u,
    /ожида.*пользоват/u,
    /пользоват.*(долж|нуж|выб|указ|назв|ответ|подтверж)/u,
    /(спрос|уточн|подтверж).*пользоват/u,
    /(после|когда).*\b(выбор|ответ|уточнен|подтвержден)/u,
  ],
  clarificationVerb: [/(specif|select|choos|confirm|clarif)/u, /(указ|выб|подтверж|уточн)/u],
} as const satisfies Record<keyof StructuredStateLexiconExtension, readonly RegExp[]>;

export function structuredStatePatterns(
  kind: keyof typeof DEFAULT_STRUCTURED_STATE_LEXICON,
  extension: StructuredStateLexiconExtension = {},
): readonly RegExp[] {
  return [...DEFAULT_STRUCTURED_STATE_LEXICON[kind], ...(extension[kind] ?? [])];
}
