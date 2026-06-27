# Phase 1 Validation

**Версия:** SOBA 0.2.0
**Дата обновления:** 2026-06-14

## Автоматическая проверка

Перед релизом обязательны:

```bash
bunx biome check --write .
bunx biome check .
bun test
bun run lint
bun run build
```

## Покрытие

| Область | Проверка |
|---|---|
| Config, CLI args, i18n | unit tests |
| Sessions, branching, compaction | unit/integration tests |
| OpenResponses client и OpenAI adapter | conversion, streaming и recovery tests |
| Agent loop | tools, finish gate, loop guard, reasoning-only recovery, cancellation |
| Tools | real filesystem/process integration tests |
| Trust | command classification, session approvals, conservative repo mode |
| OpenTUI store | streaming, clipboard transcript, queue, permissions, direct shell |
| Build | JS bundle и отдельный standalone binary workflow |

## Ручная проверка

- `manual-smoke-test.md` — полный MVP smoke test.
- `manual-test-run-process-stop-and-binary.md` — остановка процесса и binary.
- `manual-test-run-queue-and-permissions.md` — очередь и permission scopes.
- `manual-test-run-direct-shell.md` — `!`/`!!`.

## Остаточный риск

- Реальная модель может иметь provider-specific особенности reasoning/tool-call streaming.
- Repo permission mode является policy layer, а не OS sandbox.
- Standalone binary необходимо проверять на отдельном Apple Silicon устройстве.
