# v0.4.0 — checkpoint policy

Цель чекпоинтов — освобождать контекст между задачами и оставлять короткую, проверяемую историю решений.

## Когда делать checkpoint

### Обязательные milestones

1. **После task 03:** memory stores готовы отдельно друг от друга.
2. **После task 07:** MCP JSON-RPC core + stdio transport работают без client lifecycle.
3. **После task 12:** ProjectMemory aggregator/injector и MCP lifecycle покрыты интеграционными тестами.
4. **После task 17:** built-in и MCP tools идут через единый registry/execution path с trust boundary.
5. **После task 21:** release DoD/WOW baseline готов.

### Дополнительные checkpoints

Делать внеплановый checkpoint, если:

- задача заняла больше ожидаемого и контекст разросся;
- пришлось менять архитектурное решение;
- найден блокер или риск для AgentLoop/ToolRegistry;
- тесты выявили flaky поведение subprocess/timeout/cancellation;
- нужно отложить P1/P2 задачу.

## Формат checkpoint note

```md
## Checkpoint YYYY-MM-DD — <короткое имя>

### Completed
- ...

### Verified
- `bun test ...` → pass/fail
- `bun run lint` → pass/fail
- `bunx tsc --noEmit` → pass/fail

### Decisions
- ...

### Risks / follow-ups
- ...

### Next task context
- Следующая задача: `tasks/NN-...md`
- Не тащить в следующий контекст: ...
```

## Где хранить

- Короткие runtime checkpoints можно писать в ответ пользователю.
- Persistent notes — в `docs/phases/phase-4-v0.4.0-project-memory-mcp/checkpoints/` отдельными файлами `YYYY-MM-DD-<slug>.md`.
