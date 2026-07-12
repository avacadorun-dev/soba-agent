export interface AssistantTextLexiconExtension {
  continuation?: readonly string[];
  final?: readonly string[];
}

export const DEFAULT_ASSISTANT_TEXT_LEXICON = {
  continuation: [
    "i will",
    "i'll",
    "let me",
    "next i",
    "now i",
    "going to",
    "need to",
    "should now",
    "will check",
    "will run",
    "will try",
    "continue with",
    "checking",
    "running",
    "trying",
    "looking at",
    "investigating",
    "проверю",
    "проверим",
    "сейчас проверю",
    "теперь проверю",
    "запущу",
    "попробую",
    "посмотрю",
    "разберу",
    "продолжу",
    "дальше",
    "нужно",
    "надо",
    "我会",
    "接下来",
    "现在检查",
    "正在检查",
    "正在运行",
    "继续处理",
  ],
  final: [
    "done",
    "completed",
    "fixed",
    "implemented",
    "verified",
    "works",
    "working",
    "checks pass",
    "check passes",
    "tests pass",
    "test passes",
    "all set",
    "готово",
    "готов",
    "работает",
    "выполнено",
    "сделано",
    "исправлено",
    "добавлено",
    "реализовано",
    "проверено",
    "проверка завершена",
    "тесты проходят",
    "проверки прошли",
    "已完成",
    "已修复",
    "已实现",
    "已验证",
    "测试通过",
    "检查通过",
  ],
} as const;

export function assistantTextMarkers(
  kind: keyof typeof DEFAULT_ASSISTANT_TEXT_LEXICON,
  extension: AssistantTextLexiconExtension = {},
): readonly string[] {
  return [...DEFAULT_ASSISTANT_TEXT_LEXICON[kind], ...(extension[kind] ?? [])];
}

export function containsAssistantTextMarker(text: string, marker: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedMarker = marker.toLowerCase();
  if (normalizedMarker.includes(" ") || /[\p{Script=Han}]/u.test(normalizedMarker)) {
    return normalizedText.includes(normalizedMarker);
  }
  return normalizedText.split(/[^\p{L}\p{N}_'-]+/u).includes(normalizedMarker);
}
