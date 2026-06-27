# Phase 2 — Readiness Review

**Версия:** SOBA 0.3.0
**Дата проверки:** 2026-06-14
**Решение:** готово к реализации в заявленном scope Phase 2

## Проверено

- Design, use cases, technical specification, implementation plan и manual tests используют одинаковые runtime
  contracts.
- Все UC-A1–UC-A8 и UC-B1–UC-B7 связаны с задачами реализации и manual test cases.
- План учитывает текущую архитектуру Phase 1: Session v1, legacy compaction, `OpenResponsesClient`, provider
  middleware, completion flow, config и slash commands.
- Локальные markdown links валидны, diff не содержит whitespace errors.

## Закрытые блокеры

| Область | Зафиксированный контракт |
|---|---|
| Provider integration | Explicit identity/capabilities/error classification, generic streaming/native transport, developer-message fallback |
| Session migration | Append-only v1→v2 migration, legacy compaction continuation, persistent branch cursor, full typed items |
| Context safety | Usage watermark/fingerprint, config invariants, blocking post-compaction fit, classified overflow retry |
| Capsules | Native + portable state, deterministic fallback, quality semantics, persisted strategy и exact skill refs |
| Rewind | Exact continuation compatibility key, portable provider switch, restart-safe active leaf |
| Skills trust | Отдельный revocable ProjectTrustStore, no project skill read before trust, no tool pre-approval |
| Skills lifecycle | Progressive disclosure, ephemeral raw content, immutable revisions, eval/promotion/rollback |
| Eval safety | Non-overridable semantic/safety regressions, metric-only override, explicit evaluator re-baseline |
| Acceptance | Воспроизводимый endurance benchmark с restart/provider switch и total-token release floor |

## Остаточные риски

Эти пункты не блокируют начало реализации Phase 2, но не должны считаться закрытыми:

- Endurance benchmark является release proxy. KPI шестичасовой сессии подтверждается только dogfooding runs.
- Настоящий OS/container sandbox остаётся вне Phase 2; текущий TrustManager и draft-rooted facade не выполняют
  бизнес-требование NFR-6 буквально.
- `BUSINESS_REQUIREMENTS.md` всё ещё указывает Node.js ≥ 18, тогда как нормативный runtime проекта — Bun. Перед
  внешним release бизнес-требование нужно актуализировать.
- Business FR-1.1 перечисляет четыре core tools, а Phase 1 уже содержит `ls` и внутренний `finish`; Phase 2 добавляет
  внутренний `checkpoint`. Control-tools не являются расширяемыми capabilities, но терминологию требования нужно
  уточнить отдельно.
- Provider-specific capabilities и error classification требуют проверки на реальных provider/model combinations,
  а не только на fixtures.

## Условие завершения Phase 2

Phase 2 считается завершённой только после прохождения release gate из [plan.md](./plan.md), заполнения
[manual-test-run.md](./manual-test-run.md) и публикации результатов endurance benchmark.
