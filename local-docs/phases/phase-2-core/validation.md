# Phase 2 — Validation Report

**Дата:** 2026-06-15
**Версия:** SOBA 0.3.0
**Результат:** core и основная CLI-интеграция работоспособны; полный Phase 2 release gate ещё не закрыт

## Прогоны

| Проверка | Результат |
|---|---|
| `bun run lint` | Pass |
| `bun run build` | Pass |
| `bun run build:binary:mac-arm64` | Pass |
| `./bin/soba.js --version`, `--help` | Pass |
| `./dist/bin/soba-darwin-arm64 --version`, `--help` | Pass |
| Source, JS bundle и standalone one-shot через local mock provider | Pass: каждый вернул `mock-ok` |
| Interactive TUI smoke | Pass: `/help`, `/skill list`, `/project-trust status`, `/session`, `/auto-compact`, `/capsule`, `/exit` |
| Endurance benchmark, 300 steps | Pass: 14 compactions, 0 overflow, 0 invariant failures, 57.03% savings |
| `bun test` в sandbox с реальным `HOME` | 22 fail из-за запрета записи в `~/.soba` |
| `bun test` с изолированным writable `HOME` и mock credentials | 805 pass, 0 fail |

## Найдено и исправлено

- `--no-auto-compact` парсился, но не применялся в runtime.
- Частичный `compaction` config из файла не загружался и не дополнялся defaults.
- `/auto-compact on|off` менял только внешний override, но не TriggerPolicy.
- `/skill:<name> [prompt]` активировал skill, но TUI не запускал преобразованный user prompt.
- Skill activation сохранялась в Session v2 в неверной форме и ломала последующее чтение active skills.
- `/skill promote ... --scope=project` не имел настроенного project target path.
- `/skill ...` создавал `SkillEvaluator` без обязательного `evalRunsPath`.
- `/skill rm` мог удалить bundled skill.
- `soba --help` не показывал команды и настройки Phase 2.
- `/session`, `/auto-compact` и `/project-trust status` частично выводили нелокализованные значения.
- Пользовательский quick start ошибочно утверждал, что Phase 2 не подключена к CLI.

## Незакрытые пункты

- `WorkflowObserver` покрыт unit-тестами, но не подключён к production runtime/TUI.
- Внутренний `checkpoint` зарегистрирован, но milestone/plan-pivot orchestration после tool batch не завершён.
- [manual-test-run.md](./manual-test-run.md) не заполнен результатами ручного прогона.
- Skill evaluator использует deterministic dry-run simulation вместо полноценного изолированного model execution.
- Реальные provider/model combinations и шестичасовой dogfooding run не проверены.

## Вывод

Основные пользовательские сценарии Context Intelligence и Adaptive Skills доступны из CLI после исправлений,
но Phase 2 нельзя считать полностью закрытой по собственному release gate, пока не завершены незакрытые пункты выше
и не заполнен manual test run.
