# Регресс-кейсы: Compaction и Context Capsules

## Результаты

**PASS** Кейс 01-15: Compaction и capsules работают
- Unit-тесты: 116 pass (tests/core/compaction/) — TriggerPolicy, validateCompactionConfig, CLI --no-auto-compact
- ContextCapsuleEntry: append, list, get, portable continuation
- Serialization: serializePortableState покрывает все секции

**FAIL** Кейс (связанный с 02-cli-flags): --context-window 32000 вызывает fatal error
- Баг: Invalid compaction config: keepRecentTokens must be < hardLimit
- Приоритет: Высокий

---

## FAIL — описание и баги

### Баг: --context-window 32000 вызывает fatal error

**Статус:** Не исправлено
**Приоритет:** Высокий
**Задача:** Валидация compaction config при изменении context window через CLI-флаг
