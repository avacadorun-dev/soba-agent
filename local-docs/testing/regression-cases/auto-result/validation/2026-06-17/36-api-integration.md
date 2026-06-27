# Валидация регресс-кейсов: API и интеграция (исправлено)

**Файл:** 36-api-integration.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Исправления

| Кейс | Что изменено |
|------|-------------|
| Кейс 01 | `soba --provider deepseek --model` → `soba provider use deepseek && soba --model` |
| Кейс 02 | `soba --provider my-provider --model` → `soba provider use my-provider && soba --model` |
| Кейс 08 | `soba --provider deepseek --model ... --stream` → `soba provider use deepseek && soba --model ... --stream` |
| Кейс 09 | `soba --provider deepseek --model` → `soba provider use deepseek && soba --model` |
