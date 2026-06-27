# Валидация регресс-кейсов: TUI — смена модели/провайдера/языка/темы

**Файл:** 09-tui-switching.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 2/2 VALID |
| Slash-команды | 2/2 VALID |
| Исходники | 1/1 VALID |

---

## Детали

- ModelSelector реализован в `src/widgets/tui/ui/model-selector.tsx` ✅
- Смена модели/провайдера: `src/widgets/tui/model/tui-store.ts` + `src/widgets/tui/model/provider-store.ts` ✅
- Slash-команды `/lang`, `/theme` зарегистрированы ✅
- Тесты: `tests/widgets/tui/provider-store.test.ts`, `tests/widgets/tui/tui-store.test.ts` ✅
- Discovery моделей через `/v1/models` — подтверждено (built-in провайдеры без хардкоднутых моделей) ✅
