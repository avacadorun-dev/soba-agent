# Фаза 2 — Context Intelligence + Adaptive Skills: Use Cases

## Акторы

| Актор | Описание |
|---|---|
| Senior Engineer | Ведёт длинные сессии в крупной кодовой базе |
| Maintainer | Настраивает project skills и проверяет generated skills |
| Agent SOBA | Управляет контекстом, активирует skills и предлагает улучшения |
| Provider | OpenResponses-compatible API с native compaction или без него |

## Track A: Context Intelligence

### UC-A1: Защита от context overflow

**Приоритет:** P0

1. Effective context приближается к `hardLimit`.
2. Перед следующим inference ContextManager запускает blocking compaction.
3. Создаётся и валидируется Context Capsule.
4. ContextManager повторно измеряет полный request.
5. Request выполняется только если он помещается в `hardLimit`.

**Ожидаемый результат:** сессия продолжается без context overflow и без потери pending work.

**Граничные случаи:**

- native compact API недоступен: используется portable-only strategy;
- portable generation неуспешна: используется deterministic fallback;
- provider всё равно возвращает overflow: один emergency compact + retry, затем явная ошибка;
- недостаточно истории для compaction: request не отправляется с заведомо переполненным контекстом, пользователь
  получает диагностическое сообщение;
- `maxOutputTokens + safetyReserveTokens >= contextWindow`: config отклоняется до запуска inference;
- provider error не классифицирован как overflow: emergency compaction не запускается.

### UC-A2: Background compaction после завершённой задачи

**Приоритет:** P0

1. Пользовательская задача завершается через существующий completion flow.
2. Context ROI превышает настроенные минимумы.
3. SOBA запускает background compaction.
4. Пользователь видит итоговый ответ без ожидания compaction.
5. Следующий turn использует capsule, если background operation успела завершиться.

**Ожидаемый результат:** воспринимаемая задержка завершения задачи не увеличивается.

**Граничные случаи:**

- новый ввод приходит до завершения: background operation отменяется;
- экономия мала: compaction пропускается;
- background compaction падает: текущий контекст остаётся активным.

### UC-A3: Checkpoint внутренней подзадачи и plan pivot

**Приоритет:** P1

1. Во время длинного turn агент завершает значимую подзадачу или меняет план.
2. Агент вызывает `checkpoint` с `kind`, completed, pending и reason.
3. ContextManager фиксирует milestone.
4. Если политика ROI разрешает, выполняется compaction между tool batches.
5. Агент продолжает тот же пользовательский turn.

**Ожидаемый результат:** длинный автономный turn освобождает контекст без ложного завершения задачи.

### UC-A4: Ручной compaction

**Приоритет:** P0

1. Пользователь вводит `/compact [instructions]`.
2. SOBA оценивает reclaimable context.
3. При наличии экономии создаётся capsule.
4. При отсутствии экономии возвращается deterministic no-op без изменения сессии.

**Ожидаемый результат:** команда всегда обрабатывается предсказуемо и не создаёт бессмысленные checkpoints.

### UC-A5: Прозрачность контекста

**Приоритет:** P1

1. Пользователь вводит `/session`.
2. SOBA показывает effective/historical tokens, usage watermark/fingerprint status, источник метрики, hard limit,
   сохранённую strategy, checkpoints и качество последней capsule.
3. Пользователь вводит `/capsule <checkpoint-id>`.
4. SOBA показывает portable state без opaque native continuation.

**Ожидаемый результат:** пользователь понимает, почему и что было сжато.

### UC-A6: Portable rewind и смена provider

**Приоритет:** P1

1. Пользователь выбирает checkpoint через `/rewind`.
2. SessionManager сохраняет выбранный leaf в persistent cursor.
3. При точном совпадении provider continuation compatibility key используется native continuation.
4. После смены provider используется portable state.
5. После restart выбранный leaf остаётся активным.
6. Пользователь продолжает работу, обе ветки остаются в истории.

**Ожидаемый результат:** rewind работает без привязки к исходному provider.

### UC-A7: Отключение proactive compaction

**Приоритет:** P1

1. Пользователь запускает `soba -i --no-auto-compact` или задаёт `compaction.auto: false`.
2. Background и milestone compaction отключены.
3. Hard-limit и overflow recovery остаются включёнными как защита работоспособности.
4. `/compact` продолжает работать.

**Ожидаемый результат:** пользователь управляет proactive поведением, не отключая аварийную защиту.

### UC-A8: Endurance длинной сессии

**Приоритет:** P0

1. Воспроизводимый сценарий выполняет серию задач, создающую не менее десяти compactions.
2. В середине сценария SOBA перезапускается и продолжает ту же ветку.
3. Сценарий переключается на provider без native compact API.
4. После каждого checkpoint проверяются goal, pending work, blockers и modified files.
5. Total token cost и peak effective context сравниваются с baseline без proactive compaction.

**Ожидаемый результат:** сессия завершается без ручного restart/overflow, сохраняет рабочее состояние и показывает
total-token `savingsRatio >= 0.20` с учётом compaction cost против baseline без proactive compaction.

## Track B: Adaptive Skills

### UC-B1: Discovery и progressive disclosure

**Приоритет:** P0

1. SOBA запускается в доверенном проекте.
2. SkillManager сканирует project, user и bundled locations.
3. В system prompt добавляется только catalog.
4. Модель вызывает `activate_skill` для релевантного skill.
5. В session tree сохраняется activation reference; полный `SKILL.md` эфемерно добавляется в следующий request.
6. Необходимые references/scripts читаются существующими tools.

**Ожидаемый результат:** skill помогает задаче без постоянной загрузки полного содержимого.

**Граничные случаи:**

- одинаковое имя в разных scopes: используется precedence и показывается diagnostic;
- skill невалиден: он не активируется и отображается в `/skill list --invalid`;
- skill уже активирован: повторная активация не дублирует контекст;
- skill revision исчезла или потеряла trust: raw content не используется, показывается diagnostic.

### UC-B2: Project trust

**Приоритет:** P0

1. В проекте обнаружены `.soba/skills/` или `.agents/skills/`.
2. Проект ещё не доверен.
3. Project skill metadata/body не читается и не добавляется в catalog.
4. Пользователь выполняет `/project-trust approve`.
5. Catalog обновляется без перезапуска сессии.
6. После изменения project skills пользователь видит fingerprint diagnostic, а tool permissions не меняются.
7. Повторный `/project-trust approve` подтверждает и сохраняет новый fingerprint.
8. После `/project-trust revoke` project skills немедленно исчезают из catalog.
9. Ранее активированные project skills перестают инъецироваться со следующего inference.

**Ожидаемый результат:** project skill не может незаметно внедрить дополнительные инструкции или scripts через skill
catalog; существующая загрузка `AGENTS.md` остаётся отдельным механизмом.

### UC-B3: Явная активация skill

**Приоритет:** P0

1. Пользователь вводит `/skill:<name> [args]`.
2. SOBA валидирует имя и trust.
3. Activation reference сохраняется отдельно, аргументы становятся обычным user message следующего turn, а полный
   skill content инъецируется эфемерно.
4. Агент выполняет workflow через обычные tools.

**Ожидаемый результат:** пользователь может детерминированно выбрать skill независимо от решения модели.

### UC-B4: Создание generated skill

**Приоритет:** P0

1. Пользователь вводит `/skill new "описание workflow"`.
2. SOBA создаёт draft directory.
3. Агент генерирует `SKILL.md`, resources и минимум один eval case.
4. SkillValidator проверяет формат, ссылки и запрещённые небезопасные обещания.
5. SkillEvaluator запускает безопасные evals.
6. Пользователь видит diff и результаты.
7. После подтверждения skill сохраняется как immutable revision, публикуется в выбранный scope и появляется в catalog
   без перезапуска. Promotion в project scope требует trusted project и не доверяет project автоматически.

**Ожидаемый результат:** новый skill измеримо пригоден до активации.

### UC-B5: Изменение, удаление и rollback skill

**Приоритет:** P1

1. `/skill edit <name> [instructions]` создаёт draft revision; при наличии instructions отдельная generation
   operation изменяет только draft directory.
2. После изменения повторно запускаются validation и evals.
3. Новый failure, исчезнувший expected или появившийся forbidden intent блокируют promotion без override. Явный
   `--override-metrics` допустим только для регрессии по tool/token metrics.
4. При изменении evaluator config пользователь выполняет `/skill eval <draft-id> --rebaseline`, который повторно
   оценивает latest promoted revision и draft под текущей конфигурацией.
5. `/skill history <name>` показывает revisions.
6. `/skill rollback <name> <revision>` создаёт новый draft из immutable snapshot, повторяет eval/promotion и
   публикует новую revision.
7. `/skill rm <name>` удаляет user/project skill после подтверждения; bundled skill только отключается.

**Ожидаемый результат:** самомодификация обратима и не ухудшает skill незаметно.

### UC-B6: Предложение skill из повторяемого workflow

**Приоритет:** P2

1. SOBA наблюдает повторяемую последовательность действий в нескольких успешно завершённых задачах.
2. Observation был явно включён; prompt, paths, args и tool output не сохраняются.
3. После завершения задачи SOBA использует transient summary текущего accepted turn и предлагает создать project
   skill, не восстанавливая содержимое прошлых turns.
4. Пользователь принимает или отклоняет предложение.
5. При принятии запускается обычный draft/eval/approval flow.
6. Пользователь отключает observation и очищает накопленные fingerprints.

**Ожидаемый результат:** опыт превращается в skill только с согласия пользователя.

### UC-B7: Cross-agent skill

**Приоритет:** P1

1. В `.agents/skills/` существует валидный Agent Skill.
2. После project trust SOBA обнаруживает его.
3. Skill активируется и выполняется без SOBA-specific manifest.
4. SOBA-specific extensions и отклонение `allowed-tools` отображаются как diagnostics, не выдавая pre-approval.

**Ожидаемый результат:** пользователь может переиспользовать переносимые skills.

## Матрица приоритетов

| Use Case | Приоритет | Основные зависимости |
|---|---|---|
| UC-A1 Hard-limit protection | P0 | ContextMeter, TriggerPolicy, CapsuleGenerator |
| UC-A2 Background compaction | P0 | Scheduler, completion flow |
| UC-A3 Milestone/pivot | P1 | `checkpoint` control-tool |
| UC-A4 Manual compaction | P0 | ContextManager |
| UC-A5 Transparency | P1 | CapsuleStore, commands |
| UC-A6 Portable rewind | P1 | Session v2, provider compatibility |
| UC-A7 Disable proactive | P1 | Config, TriggerPolicy |
| UC-A8 Endurance | P0 | ContextManager, Session v2, benchmark harness |
| UC-B1 Discovery/activation | P0 | SkillManager, system prompt |
| UC-B2 Project trust | P0 | ProjectTrustStore, catalog |
| UC-B3 Explicit activation | P0 | Slash-command routing |
| UC-B4 Generated skill | P0 | Drafts, validator, evaluator |
| UC-B5 Revision/rollback | P1 | SkillStore |
| UC-B6 Workflow proposal | P2 | Observation metrics |
| UC-B7 Cross-agent skill | P1 | Agent Skills compatibility |
