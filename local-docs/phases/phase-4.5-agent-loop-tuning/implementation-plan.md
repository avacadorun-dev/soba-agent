# Phase 4.5 — sequential implementation plan

## Release boundary

Phase 4.5 входит в v0.4.0 как Agent Loop hardening epic. Цель фазы: короткий prompt должен запускать проверяемый
инженерный workflow без ручного описания процесса пользователем.

В фазу входят:

1. Agent Loop eval baseline для слабых и нормальных моделей.
2. Prompt/runtime contract parity между `SYSTEM.md` и runtime prompt.
3. Working Narration: краткий user-visible рабочий след без hidden chain-of-thought.
4. Evidence Ledger и completion gate, который опирается на runtime facts.
5. Verification policy, Auto-Verifier и Fix-Until-Green MVP.
6. Checkpoint/context/memory интеграция для длинных задач.
7. Built-in Skills 2.0 с verification/recovery/memory policy.
8. Tool ACI hardening для слабых моделей.
9. End-to-end release regression.

Не входят: multi-agent delegation, marketplace skills, enterprise policy engine, новый provider protocol, SOBA-as-MCP-server.

## Global invariants

- Runtime: только Bun.
- Линтер/форматтер: только Biome.
- Новые файлы: kebab-case.
- TypeScript: erasable syntax only, без `enum`, type-only imports через `import type`.
- Project instructions имеют приоритет над generic skill examples.
- Не сохранять hidden chain-of-thought; сохранять только observable state, plans, narration, evidence и concise reflections.
- Code mutation не может завершиться как `completed` без verification evidence.
- Working Narration не является verification evidence.
- Каждая implementation task добавляет regression/eval coverage до расширения runtime path.

## Task sequence

| Task | ID | File | Result |
|------|----|------|--------|
| 00 | 0.4-AL-REL-00 | [`tasks/00-release-framing.md`](tasks/00-release-framing.md) | Lock Agent Loop release boundary and local decisions. |
| 01 | 0.4-AL-00 | [`tasks/01-agent-loop-eval-baseline.md`](tasks/01-agent-loop-eval-baseline.md) | Baseline eval harness and fixture tasks. |
| 02 | 0.4-AL-01 | [`tasks/02-prompt-runtime-contract-parity.md`](tasks/02-prompt-runtime-contract-parity.md) | `SYSTEM.md` and runtime prompt parity gate. |
| 03 | 0.4-AL-01A | [`tasks/03-working-narration-contract.md`](tasks/03-working-narration-contract.md) | Typed visible working narration events. |
| 04 | 0.4-AL-02 | [`tasks/04-evidence-ledger-core.md`](tasks/04-evidence-ledger-core.md) | Runtime ledger for reads, mutations, diagnostics, verification. |
| 05 | 0.4-AL-03 | [`tasks/05-strict-verification-policy.md`](tasks/05-strict-verification-policy.md) | Task-kind verification decisions and mutation gate. |
| 06 | 0.4-AL-04 | [`tasks/06-finish-schema-alignment.md`](tasks/06-finish-schema-alignment.md) | Finish schema matches completion rejection rules. |
| 07 | 0.4-AL-05 | [`tasks/07-project-command-detector.md`](tasks/07-project-command-detector.md) | Bun/Biome-first project command detection. |
| 08 | 0.4-AL-06 | [`tasks/08-auto-verifier-runner.md`](tasks/08-auto-verifier-runner.md) | Loop-triggered verification after mutations. |
| 09 | 0.4-AL-07 | [`tasks/09-fix-until-green-mvp.md`](tasks/09-fix-until-green-mvp.md) | Bounded diagnostics -> patch -> verify loop. |
| 10 | 0.4-AL-08 | [`tasks/10-checkpoint-event-wiring.md`](tasks/10-checkpoint-event-wiring.md) | Checkpoint tool output becomes loop/control evidence. |
| 11 | 0.4-AL-09 | [`tasks/11-reflection-memory-policy.md`](tasks/11-reflection-memory-policy.md) | Recovery lessons enter memory only through filters. |
| 12 | 0.4-AL-10 | [`tasks/12-skill-protocol-hardening.md`](tasks/12-skill-protocol-hardening.md) | Built-in skill protocol validation. |
| 13 | 0.4-AL-11A | [`tasks/13-rewrite-core-bundled-skills.md`](tasks/13-rewrite-core-bundled-skills.md) | Core engineering skills rewritten as executable playbooks. |
| 14 | 0.4-AL-12 | [`tasks/14-real-skill-eval-harness.md`](tasks/14-real-skill-eval-harness.md) | Fixture-based skill evals and regression reports. |
| 15 | 0.4-AL-13 | [`tasks/15-helpful-tool-errors.md`](tasks/15-helpful-tool-errors.md) | Machine-readable tool errors and next-action hints. |
| 16 | 0.4-AL-14 | [`tasks/16-purpose-built-search-inspect-tools.md`](tasks/16-purpose-built-search-inspect-tools.md) | Search/inspect rails for weak models. |
| 17 | 0.4-AL-15 | [`tasks/17-mutating-batch-guard.md`](tasks/17-mutating-batch-guard.md) | Guard dependent mutating batches before verification. |
| 18 | 0.4-AL-16 | [`tasks/18-agent-loop-release-regression.md`](tasks/18-agent-loop-release-regression.md) | Final end-to-end Agent Loop release gate. |

## Implementation order

### 00-03. Contract baseline

Зафиксировать границы, eval harness, prompt parity и Working Narration. После task 03 агент уже должен иметь тестируемый
контракт процесса, даже если enforcement ещё частичный.

### 04-06. Evidence and completion

Добавить Evidence Ledger, строгую verification policy и синхронизировать finish schema. После task 06 запрещён основной
failure mode: mutation -> confident completed без evidence.

### 07-09. Auto verification and recovery

Научить runtime находить проектные команды, запускать их после мутаций и входить в bounded Fix-Until-Green.

### 10-11. Long-task state and memory

Подключить checkpoint events и reflection memory policy. Это связывает Agent Loop с Project Memory из v0.4.0.

### 12-14. Built-in Skills 2.0

Сделать skills исполнимыми playbooks с validation и eval coverage. После task 14 плохой skill должен ломать eval до
попадания в bundled set.

### 15-17. Agent-computer interface

Улучшить tool feedback, search/inspect ergonomics и batch safety для слабых моделей.

### 18. Release regression

Полный прогон weak/normal profile evals, release gate и manual results.

## Checkpoint cadence

Создавать checkpoint note в `checkpoints/`:

- после 03 — Agent Loop contract baseline;
- после 06 — Evidence + completion gate baseline;
- после 09 — Auto-Verifier + Fix-Until-Green baseline;
- после 11 — checkpoint/memory integration baseline;
- после 14 — Built-in Skills 2.0 baseline;
- после 18 — v0.4.0 Agent Loop hardening release candidate baseline.

## Mandatory checks

For implementation tasks:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

For docs-only task changes:

```bash
find docs/phases/phase-4.5-agent-loop-tuning -maxdepth 2 -type f | sort
rg "0\\.4-AL|Working Narration|Evidence Ledger|Fix-Until-Green" docs/phases/phase-4.5-agent-loop-tuning
```

If docs-site changes:

```bash
cd docs-site && bun run check
cd docs-site && bun run build
```

## Manual test cadence

После каждых 2-3 implementation tasks обновлять [`manual-test-run.md`](manual-test-run.md). Минимальный набор ручных
сценариев: short bug fix, docs-only change, failed verification recovery, weak profile rails, unsafe action refusal.
