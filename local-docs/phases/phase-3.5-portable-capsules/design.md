# Phase 3.5 — Portable Capsules: Design

## Цель

Расширить существующие context capsules так, чтобы SOBA поддерживал два разных контракта:

1. `ContextCapsuleEntry` — внутренний checkpoint compaction, связанный с веткой JSONL-сессии.
2. `PortableCapsule` — автономный, человекочитаемый и безопасный dispatch package для передачи знаний другому
   агенту, сессии или проекту.

Существующий session format v2 остаётся обратно совместимым. Portable capsules не участвуют в session tree и не
содержат native provider continuation, session entry IDs или token metrics.

## Архитектурные решения

### 1. Разделение доменных моделей

`ContextCapsuleEntry` продолжает обслуживать proactive compaction и rewind. `PortableCapsule` хранится отдельным
Markdown-файлом с YAML frontmatter и версионированным телом. Между моделями существует явный mapper; прямой экспорт
JSONL entry запрещён.

### 2. Receiver-oriented schema

Portable capsule описывает отправителя, предполагаемого получателя, цель переноса и поведение после доставки:

- tier: `quick | standard | deep`;
- category: `full_system | knowledge_pillar | conversation_thread | living_reference`;
- archetype: `perishable | handoff | seed | steroid | delta | trainer | dormant`;
- dispatch summary и core content;
- patterns, assumptions и signals;
- integration plan для Standard/Deep;
- verbatim payloads для структурированных данных.

### 3. Безопасность границы переноса

Экспорт всегда проходит sanitization. Sanitizer маскирует credentials, bearer tokens, private keys, URL с
credentials, абсолютные home paths и session/provider identifiers. Capsule содержит sanitation report без исходных
значений. Импортируемый файл считается untrusted content: schema и checksum проверяются до показа integration plan.

### 4. Narrative и verbatim content

Narrative можно сжимать и редактировать. Verbatim payload содержит `content`, `mediaType` и SHA-256 checksum.
Loader отклоняет изменённый payload. Команды и конфиги не выполняются при load автоматически.

### 5. Двухфазная загрузка

`load` только читает, валидирует и возвращает briefing/integration preview. Исполнение integration plan является
отдельной будущей операцией и требует подтверждения для side effects. В этой фазе loader инъецирует capsule как
явно маркированный untrusted user context, не как system instruction.

### 6. Исправление внутренних checkpoints

При compaction в `ContextCapsuleEntry` переносятся текущие active skill refs. Portable continuation включает
Artifact Ledger, чтобы принимающая модель видела изменённые файлы и фактический статус проверок.

## Компоненты

```text
SessionManager ── context checkpoint ──> ContextCapsuleEntry
      │                                      │
      │ current skills                       │ explicit mapping
      ▼                                      ▼
ContextManager                         PortableCapsuleService
                                             │
                         ┌───────────────────┼──────────────────┐
                         ▼                   ▼                  ▼
                    Sanitizer            Validator        Markdown Codec
                                                                  │
                                                                  ▼
                                                        *.capsule.md
```

## Нефункциональные требования

- Bun-only runtime, без новых runtime dependencies.
- Kebab-case filenames, strict TypeScript, erasable syntax only.
- Atomic file creation через exclusive create; существующий файл не перезаписывается без отдельного флага.
- Максимальный размер импортируемого файла и каждого verbatim payload ограничен.
- Parser не исполняет Markdown, shell и embedded instructions.
- Старые JSONL-сессии продолжают читаться без миграции.

