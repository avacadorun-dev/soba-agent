# Полный регресс-план тестирования SOBA Agent v0.4.0

> **Для кого:** разработчик / тестировщик  
> **Цель:** убедиться, что после изменений ни один компонент системы не сломан  
> **Формат:** таблицы с ID теста, шагами, ожидаемым результатом, критерием прохождения  
> **Окружение:** macOS, Bun, реальный OpenAI-compatible endpoint (или мок)

---

## Содержание

1. [Установка и сборка](#1-установка-и-сборка)
2. [CLI-флаги и аргументы](#2-cli-флаги-и-аргументы)
3. [Конфигурация (config.json, env, priority)](#3-конфигурация)
4. [One-shot режим](#4-one-shot-режим)
5. [Интерактивный TUI — базовая функциональность](#5-интерактивный-tui--базовая-функциональность)
6. [TUI — горячие клавиши и навигация](#6-tui--горячие-клавиши-и-навигация)
7. [TUI — shell-команды (! и !!)](#7-tui--shell-команды--и-)
8. [TUI — очередь сообщений](#8-tui--очередь-сообщений)
9. [TUI — смена модели, языка, темы](#9-tui--смена-модели-языка-темы)
10. [TUI — slash-команды](#10-tui--slash-команды)
11. [Инструменты агента (tools)](#11-инструменты-агента-tools)
12. [Agent loop](#12-agent-loop)
13. [Сессии (session, format, resume)](#13-сессии)
14. [Дерево сессии и ветвление](#14-дерево-сессии-и-ветвление)
15. [Checkpoints](#15-checkpoints)
16. [Rewind](#16-rewind)
17. [Compaction и Context Capsules](#17-compaction-и-context-capsules)
18. [Context Manager и Context Meter](#18-context-manager-и-context-meter)
19. [Background Scheduler](#19-background-scheduler)
20. [Skills — bundled](#20-skills--bundled)
21. [Skills — user и project](#21-skills--user-и-project)
22. [Skills — draft, eval, promote, revision](#22-skills--draft-eval-promote-revision)
23. [Skills — discovery, trust, catalog](#23-skills--discovery-trust-catalog)
24. [Skills — workflow observer](#24-skills--workflow-observer)
25. [Trust Manager и разрешения](#25-trust-manager-и-разрешения)
26. [Project Trust](#26-project-trust)
27. [OpenResponses-клиент](#27-openresponses-клиент)
28. [OpenAI-compatible adapter (middleware)](#28-openai-compatible-adapter-middleware)
29. [i18n (мультиязычность)](#29-i18n-мультиязычность)
30. [Темы TUI](#30-темы-tui)
31. [Budget Tracker](#31-budget-tracker)
32. [System Prompt](#32-system-prompt)
33. [Completion Gate](#33-completion-gate)
34. [Loop Guard](#34-loop-guard)
35. [Endurance benchmark](#35-endurance-benchmark)
36. [Edge cases и стресс-тесты](#36-edge-cases-и-стресс-тесты)
37. [Project Memory](#37-project-memory)
38. [MCP Client](#38-mcp-client)

---

## 1. Установка и сборка

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| INST-01 | `bun install` | Установка без ошибок, `bun.lock` создан/обновлён | exit 0 |
| INST-02 | `bun run build` | Сборка в `dist/cli.js`, файл существует и > 100KB | exit 0, файл существует |
| INST-03 | `bun run build:binary:mac-arm64` | Бинарник `dist/bin/soba-darwin-arm64` создан | exit 0 |
| INST-04 | `.soba version` | Вывод версии `0.3.2` | Строка содержит версию |
| INST-05 | `.soba --help` | Вывод справки со всеми флагами | exit 0, не пусто |
| INST-06 | `bun test` | Все тесты проходят | 0 fail |
| INST-07 | `bun run lint` | 0 ошибок линтинга | exit 0 |

---

## 2. CLI-флаги и аргументы

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CLI-01 | `.soba --version` | Вывод: `soba v0.3.2` | Точное совпадение |
| CLI-02 | `.soba --help` | Список всех флагов | Содержит `--interactive`, `--continue`, `--session`, `--debug`, `--budget` и т.д. |
| CLI-03 | `.soba --model gpt-4o "Привет"` | Ответ от gpt-4o | Ответ не пустой |
| CLI-04 | `.soba --base-url https://example.com/v1 --api-key test --model test "Привет"` | Ошибка соединения или ответ | Обработка ошибки без падения |
| CLI-05 | `.soba --lang ru "Привет"` | Ответ на русском (если модель поддерживает) | Ответ на русском |
| CLI-06 | `.soba --lang zh "Hello"` | TUI/ответ на китайском | Ответ на китайском |
| CLI-07 | `.soba --no-color "Привет"` | Вывод без ANSI-цветов | Нет escape-кодов |
| CLI-08 | `.soba --stream "Привет"` | Streaming-ответ | Вывод по частям |
| CLI-09 | `.soba --no-stream "Привет"` | Полный ответ без streaming | Весь ответ сразу |
| CLI-10 | `.soba --max-tokens 50 "Напиши большое сочинение"` | Ответ не длиннее ~50 токенов | Длина ответа ограничена |
| CLI-11 | `.soba --max-completion-tokens 100 "Реши задачу"` | Reasoning/thinking не более 100 токенов | Ограничение работает |
| CLI-12 | `.soba --context-window 32000 "Привет"` | Используется context window 32000 | Ошибки нет |
| CLI-13 | `.soba --budget 5000 "Напиши историю"` | Превышение бюджета → остановка | Остановка при достижении лимита |
| CLI-14 | `.soba --max-agent-iterations 2 "Создай 10 файлов"` | Не более 2 итераций агента | Агент остановлен после 2 итераций |
| CLI-15 | `.soba --max-agent-iterations 0 "Создай файл"` | Без лимита итераций | Задача завершена |
| CLI-16 | `.soba --max-stalled-iterations 2 "Придумай решение"` | Stall recovery срабатывает после 2 stalled-итераций | Stall detected |
| CLI-17 | `.soba --max-run-minutes 1 "Напиши большую программу"` | Остановка через 1 минуту | Процесс прерван |
| CLI-18 | `.soba --max-run-minutes 0 "Привет"` | Без лимита времени | Задача завершена |
| CLI-19 | `.soba --no-session "Привет"` | Ответ без сохранения сессии | Файл сессии не создан |
| CLI-20 | `.soba --debug "Привет"` | Debug-информация в выводе/сессии | Debug-записи присутствуют |
| CLI-21 | `.soba --no-auto-compact -i` | TUI без proactive compaction | `/auto-compact` показывает off |
| CLI-22 | `.soba -i --theme ember` | TUI с темой ember | Тема ember применена |
| CLI-23 | `.soba --theme nonexistent -i` | Ошибка: тема не найдена | Сообщение об ошибке |
| CLI-24 | `.soba nonexistent-flag` | Ошибка парсинга | exit != 0 |
| CLI-25 | `.soba -c` без предыдущей сессии | Информационное сообщение | Не падает |

---

## 3. Конфигурация

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CFG-01 | Удалить `~/.soba/config.json`, запустить `.soba "Привет"` | First-time wizard с запросом URL, ключа, модели | Интерактивный ввод |
| CFG-02 | Заполнить wizard корректными данными | Config создан, SOBA продолжает работу | Файл существует, ответ получен |
| CFG-03 | Нажать `n` в wizard | SOBA завершается с сообщением | exit != 0 |
| CFG-04 | Создать `~/.soba/config.json` с корректными полями | SOBA читает config | Работает |
| CFG-05 | Указать `SOBA_API_KEY` в окружении | Ключ из окружения, не из config | Работает |
| CFG-06 | Указать `--api-key` CLI-флаг | Ключ из CLI (приоритет выше env) | Работает |
| CFG-07 | `SOBA_MODEL`, `SOBA_BASE_URL`, `SOBA_LANG`, `SOBA_THEME` в окружении | Все параметры применены | Работает |
| CFG-08 | `SOBA_AUTO_COMPACT=false .soba -i` | Compaction отключён | `/auto-compact` → off |
| CFG-09 | `NO_COLOR=1 .soba` | Цвета отключены | Нет ANSI |
| CFG-10 | config.json с невалидным JSON | Ошибка с пояснением | Сообщение об ошибке |
| CFG-11 | config.json с неизвестными полями | Поля игнорируются | Работает |
| CFG-12 | config.json с `compaction` без полей | Дополняется значениями по умолчанию | Работает |
| CFG-13 | config.json с несовместимыми лимитами | Ошибка валидации до запуска | Отклонено |
| CFG-14 | `SOBA_MAX_TOKENS=999999999 .soba "Привет"` | Значение capped/clamped | Работает без краша |

### Приоритет настроек

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CFG-P01 | config.json: `model: "model-a"`, SOBA_MODEL: `"model-b"`, `--model model-c` | Используется `model-c` | CLI > env > config |
| CFG-P02 | config.json: `model: "model-a"`, SOBA_MODEL: `"model-b"` | Используется `model-b` | env > config |
| CFG-P03 | config.json: `model: "model-a"`, без env, без CLI | Используется `model-a` | config > default |
| CFG-P04 | config.json: `maxTokens: 0`, env: пусто, CLI: нет | Используется default 16384 | default > 0? |

---

## 4. One-shot режим

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| ONE-01 | `.soba "Ответь одним словом: привет"` | Ответ одним словом | Ответ не пустой |
| ONE-02 | `.soba "Прочитай содержимое package.json и опиши"` | Агент читает файл и описывает | Tool call `read` выполнен |
| ONE-03 | `.soba "Создай файл test.txt с текстом Hello"` | Файл создан | Файл существует |
| ONE-04 | `.soba "Создай test.txt, затем прочитай его"` | Два tool call: write + read | Оба выполнены |
| ONE-05 | `.soba "Выполни ls и скажи, что видишь"` | Tool call `ls` выполнен | Ответ содержит список файлов |
| ONE-06 | `.soba --no-session "Привет"` | Нет сохранения в `~/.soba/sessions/` | Файл не создан |
| ONE-07 | `.soba "Создай 5 файлов"` | 5 tool call write | Все 5 выполнены |
| ONE-08 | `.soba "Отредактируй package.json: измени version на 2.0.0"` | Tool call `edit` | version изменена |
| ONE-09 | `.soba "Проверь git status"` | Tool call `bash` с git status | Выполнен |
| ONE-10 | `.soba "Поставь checkpoint"` | Tool call `checkpoint` | Выполнен |

---

## 5. Интерактивный TUI — базовая функциональность

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| TUI-01 | `.soba -i` | TUI запущен, строка ввода активна | Виден prompt |
| TUI-02 | Ввести сообщение, Enter | Сообщение отправлено, агент отвечает | Ответ получен в transcript |
| TUI-03 | Во время ответа нажать `Ctrl+C` | Операция остановлена | TUI остаётся активным |
| TUI-04 | После остановки отправить новое сообщение | Новый turn | Ответ получен |
| TUI-05 | `/clear` | Transcript очищен | Экран пуст |
| TUI-06 | `/exit` | TUI закрыт, процесс завершён | exit 0 |
| TUI-07 | `/help` | Список всех команд | Содержит `/compact`, `/rewind`, `/session`, `/capsule` и т.д. |
| TUI-08 | `.soba -i --lang ru` | TUI на русском | Все надписи на русском |
| TUI-09 | `.soba -i --lang en` | TUI на английском | Все надписи на английском |
| TUI-10 | `.soba -i --lang zh` | TUI на китайском | Все надписи на китайском |
| TUI-11 | Status bar показывает модель, язык, тему | Корректные значения | Совпадают с запуском |
| TUI-12 | Git panel показывает изменения | diff отображается (или пусто) | Не падает |

---

## 6. TUI — горячие клавиши и навигация

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| KEY-01 | Отправить 3 сообщения, нажать `↑` 3 раза | Показывается самое старое сообщение | История работает |
| KEY-02 | Нажать `↓` | Возврат к более новому сообщению | Навигация вниз |
| KEY-03 | Нажать `↑` на пустой истории | Ничего не происходит | Не падает |
| KEY-04 | `Cmd+C` / `Ctrl+Shift+C` | Transcript скопирован в буфер обмена | Содержимое в буфере |
| KEY-05 | `Ctrl+Y` | Последний ответ скопирован | Содержимое в буфере |
| KEY-06 | При вводе `/` показать список команд | Выпадающий список | Команды видны |
| KEY-07 | `Tab` при вводе `/comp` | Автодополнение до `/compact` | Дополнено |
| KEY-08 | При вводе `@` показать файлы проекта | Список файлов в текущей директории | Файлы видны |
| KEY-09 | Выбрать файл из списка `@` | Путь подставлен в строку ввода | Подстановка работает |

---

## 7. TUI — shell-команды (! и !!)

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SHL-01 | `!echo hello` | Выполнено, вывод `hello` в transcript | Вывод виден |
| SHL-02 | `!!echo silent` | Выполнено, вывод скрыт | Вывод не показан |
| SHL-03 | `!bun test` | Тесты запущены, результат в transcript | Вывод виден |
| SHL-04 | `!nonexistent-command` | Ошибка выполнения | Сообщение об ошибке |
| SHL-05 | `!sleep 1 && echo done` | Команда выполнена | `done` в выводе |
| SHL-06 | `!` (пустая команда) | Ничего не происходит | Не падает |
| SHL-07 | `!rm -rf /tmp/test-dir` (создать сначала) | Файл удалён, вывод показан | Выполнено |
| SHL-08 | Отправить `!pwd` во время активного turn | Выполнено сразу без очереди | Результат сразу |
| SHL-09 | `!!git status --short` | Выполнено без вывода | Статус скрыт |

---

## 8. TUI — очередь сообщений

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| QUE-01 | Отправить длинный запрос агенту, во время выполнения отправить второй | Второй попал в очередь | Показан в `/queue` |
| QUE-02 | `/queue` | Показан список очереди | Не пусто |
| QUE-03 | `/queue cancel 1` | Первый элемент удалён | Список обновлён |
| QUE-04 | `/queue cancel all` | Очередь пуста | `/queue` → пусто |
| QUE-05 | `/queue edit 1 Новый текст` | Первый элемент изменён | Текст обновлён |
| QUE-06 | Отправить `!ls` во время активного turn | `!ls` выполняется сразу (не в очередь) | Результат сразу |
| QUE-07 | Отправить `!!echo` в очередь через `!` | Обработка | Не падает |
| QUE-08 | Очистить очередь во время выполнения | Текущий turn завершается | Следующее сообщение не обработано |

---

## 9. TUI — смена модели, языка, темы

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SWT-01 | `/model gpt-4o` | Модель сменена | Следующий turn использует новую модель |
| SWT-02 | `/model` (без аргумента) | Текущая модель показана | Вывод |
| SWT-03 | `/model nonexistent-model` | Ошибка? | Обработка ошибки |
| SWT-04 | `/lang en` | Язык интерфейса — английский | Все надписи на английском |
| SWT-05 | `/lang ru` | Язык — русский | Надписи на русском |
| SWT-06 | `/lang zh` | Язык — китайский | Надписи на китайском |
| SWT-07 | `/lang fr` | Ошибка: неподдерживаемый язык | Сообщение |
| SWT-08 | `/theme ember` | Тема Ember | Цвета изменились |
| SWT-09 | `/theme aurora` | Тема Aurora | Цвета изменились |
| SWT-10 | `/theme paper` | Тема Paper | Цвета изменились |
| SWT-11 | `/theme forest` | Тема Forest | Цвета изменились |
| SWT-12 | `/theme synthwave` | Тема Synthwave | Цвета изменились |
| SWT-13 | `/theme graphite` | Тема Graphite (по умолчанию) | Цвета изменились |
| SWT-14 | `/theme nonexistent` | Ошибка | Сообщение |
| SWT-15 | Сменить тему во время активного turn | Тема меняется, операция продолжается | Turn завершён |

---

## 10. TUI — slash-команды

| ID | Команда | Ожидаемый результат | Критерий |
|---|---|---|---|
| SLS-01 | `/session` | Статистика: формат, active branch, effective/historical tokens, hard limit, context window, capsules | Все поля присутствуют |
| SLS-02 | `/budget` | Использование токенов | Число > 0 |
| SLS-03 | `/auto-compact` | Статус on/off | Вывод |
| SLS-04 | `/auto-compact off` | Proactive compaction отключён | `/auto-compact` → off |
| SLS-05 | `/auto-compact on` | Proactive compaction включён | `/auto-compact` → on |
| SLS-06 | `/compact` | Ручная compaction (возможно no-op) | Сообщение о результате |
| SLS-07 | `/compact Сохрани цель и файлы` | Compact с инструкциями | Capsule создана |
| SLS-08 | `/capsule` | Список capsules | Не пусто (если были) |
| SLS-09 | `/capsule <id>` | Детали capsule | Содержит все поля |
| SLS-10 | `/rewind` | Список checkpoints | Не пусто |
| SLS-11 | `/rewind <id>` | Rewind к checkpoint | Active leaf изменён |
| SLS-12 | `/permissions` | Текущий режим | ask/repo |
| SLS-13 | `/permissions repo` | Режим repo | `/permissions` → repo |
| SLS-14 | `/permissions ask` | Режим ask | `/permissions` → ask |
| SLS-15 | `/permissions clear` | Разрешения сброшены | Подтверждение |
| SLS-16 | `/queue` | Пустая очередь (если нет) | Пусто |
| SLS-17 | `/skill list` | Catalog skills | Содержит bundled skills |
| SLS-18 | `/project-trust status` | Статус доверия | trusted/not trusted |
| SLS-19 | `/project-trust approve` | Trust granted | Подтверждение |
| SLS-20 | `/project-trust revoke` | Trust revoked | Подтверждение |
| SLS-21 | `/lang` (без аргумента) | Текущий язык | Вывод |
| SLS-22 | `/theme` (без аргумента) | Текущая тема | Вывод |
| SLS-23 | `/model` (без аргумента) | Текущая модель | Вывод |
| SLS-24 | `/exit` | Выход | Процесс завершён |
| SLS-25 | `/nonexistent` | Сообщение об ошибке | Unknown command |

---

## 11. Инструменты агента (tools)

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| TOL-01 | Агент вызывает `ls` | Вывод списка файлов | Корректный |
| TOL-02 | `ls` несуществующей директории | Ошибка с описанием | Не падает |
| TOL-03 | Агент вызывает `read` | Содержимое файла | Текст |
| TOL-04 | `read` несуществующего файла | Ошибка | Не падает |
| TOL-05 | `read` бинарного файла | Ошибка или сообщение | Не падает |
| TOL-06 | `read` большого файла (>50KB) | Частичное чтение с усечением | Не падает |
| TOL-07 | Агент вызывает `write` | Файл создан | Содержимое совпадает |
| TOL-08 | `write` в несуществующую директорию | Директория создана, файл записан | Файл существует |
| TOL-09 | `write` существующего файла | Перезаписан | Новое содержимое |
| TOL-10 | Агент вызывает `edit` с oldText/newText | Замена выполнена | Содержимое изменено |
| TOL-11 | `edit` с несуществующим oldText | Ошибка | Не падает |
| TOL-12 | `edit` с несколькими непересекающимися заменами | Все замены выполнены | Все совпадают |
| TOL-13 | Агент вызывает `bash` | Команда выполнена | Вывод |
| TOL-14 | `bash` с ошибкой | Ошибка в ответе | Не падает |
| TOL-15 | `bash` с dangerous командой (`rm`, `sudo`) | Trust Manager проверяет | Confirmation запрошен |
| TOL-16 | Агент вызывает `checkpoint` | Checkpoint создан | Присутствует в сессии |
| TOL-17 | Агент вызывает `activate_skill` | Skill активирован | Skill injected |
| TOL-18 | `activate_skill` несуществующего skill | Ошибка | Не падает |
| TOL-19 | Tool registry содержит все 7 инструментов | ls, read, write, edit, bash, checkpoint, activate_skill | Все зарегистрированы |

---

## 12. Agent loop

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| LOP-01 | One-shot: агент вызывает tool, получает результат, завершает | Цикл завершён | Ответ получен |
| LOP-02 | `--max-agent-iterations 3 "Сделай 10 вещей"` | Не более 3 итераций | Iteration count ≤ 3 |
| LOP-03 | `--max-stalled-iterations 2` (агент в цикле) | Stall recovery после 2 stalled | Сообщение о stall |
| LOP-04 | `--max-run-minutes 0.1` (6 секунд) | Таймаут, остановка через ~6 сек | Прервано |
| LOP-05 | Множественные tool call в одном turn | Все выполнены | Логика соблюдена |
| LOP-06 | Completion gate проверяет ответ | Ответ завершён или incomplete | Gate сработал |
| LOP-07 | Loop guard срабатывает при зацикливании | Guard прерывает | Сообщение |

---

## 13. Сессии

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SES-01 | One-shot `.soba "Привет"` | Сессия сохранена | Файл `.jsonl` существует |
| SES-02 | `.soba -c` | Последняя сессия продолжена | Ответ основан на контексте |
| SES-03 | `.soba -r` | Список сессий для выбора | Интерактивный выбор |
| SES-04 | `.soba -s <session-id>` | Сессия по ID | Контекст восстановлен |
| SES-05 | `.soba -s abc` (уникальный префикс) | Сессия найдена по префиксу | Контекст восстановлен |
| SES-06 | `.soba --no-session "Привет"` | Файл сессии не создан | Нет новых файлов |
| SES-07 | `cat ~/.soba/sessions/*/*.jsonl` | JSONL с корректным JSON на каждой строке | Валидный JSON |
| SES-08 | Сессия содержит `message`, `function_call`, `function_call_output` | Все типы присутствуют | Проверка |
| SES-09 | `/session` после нескольких turns | Статистика обновляется | Effective tokens > 0 |
| SES-10 | `/budget` | Число токенов | > 0 |

---

## 14. Дерево сессии и ветвление

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| TRE-01 | Выполнить несколько turns, проверить parentId в JSONL | Древовидная структура (id/parentId) | Каждый item имеет parentId |
| TRE-02 | `/rewind <id>`, затем отправить сообщение | Новая ветка создана | parentId ведёт к checkpoint |
| TRE-03 | После rewind старая ветка не удалена | Все item'ы сохранены | Проверка JSONL |
| TRE-04 | `.soba -c` после rewind | Активная ветка восстановлена | Изменения на правильной ветке |
| TRE-05 | Множественные rewind | Дерево с несколькими ветками | Все ветки доступны |

---

## 15. Checkpoints

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CHK-01 | Turn с `checkpoint` tool call | Checkpoint создан | В сессии есть `type:checkpoint` |
| CHK-02 | Checkpoint содержит корректные id и parentId | Валидный checkpoint | Проверка JSONL |
| CHK-03 | `/rewind` показывает checkpoint'ы | Список не пуст | Включает description |
| CHK-04 | `/rewind <checkpoint-id>` | Rewind выполнен | Leaf переключён |
| CHK-05 | Checkpoint с метаданными (description) | Метаданные сохранены | Проверка JSONL |

---

## 16. Rewind

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| RWD-01 | `/rewind` без аргументов | Список checkpoints | Не пусто |
| RWD-02 | `/rewind <id>` | Leaf переключён, новое сообщение создаёт ветку | parentId = checkpoint id |
| RWD-03 | Rewind, затем отправка сообщения | Новая ветка создана | Проверка JSONL |
| RWD-04 | Rewind к checkpoint, затем ещё один rewind | Можно переключаться между ветками | Обе ветки доступны |
| RWD-05 | Rewind + продолжение, перезапуск с `-c` | Новая ветка сохранена | Leaf восстановлен |
| RWD-06 | Rewind несуществующего ID | Ошибка | Не падает |
| RWD-07 | Rewind без checkpoints | Сообщение | Не падает |

---

## 17. Compaction и Context Capsules

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CMP-01 | `/compact` при маленьком контексте | No-op | Сообщение |
| CMP-02 | `/compact Сохрани цель и файлы` | Capsule создана | Проверка сессии |
| CMP-03 | `/capsule` | Список capsules | Не пусто |
| CMP-04 | `/capsule <id>` | Детали: trigger, strategy, quality, savings, state | Все поля |
| CMP-05 | Capsule содержит portable state | Цель, решения, файлы, проверки, блокеры, следующие шаги | Все поля |
| CMP-06 | После compaction effective tokens уменьшились | Сравнить до/после | Effective < до |
| CMP-07 | После compaction historical tokens не изменились | Historical остались | Не изменились |
| CMP-08 | `/auto-compact off` | Proactive отключён | Подтверждение |
| CMP-09 | `/auto-compact on` | Proactive включён | Подтверждение |
| CMP-10 | Hard-limit protection (context > hard limit) | Blocking compaction | Turn завершён без ошибки |
| CMP-11 | Context overflow от модели | Восстановление через compaction | Turn завершён |
| CMP-12 | `--no-auto-compact` при запуске | Proactive отключён | `/auto-compact` → off |
| CMP-13 | Compact с несколькими инструкциями | Capsule отражает инструкции | Проверка содержимого |
| CMP-14 | После compact `/session` показывает capsules count | Количество увеличено | Проверка |
| CMP-15 | Portable continuation при смене provider | Capsule используется | Turn завершён |

---

## 18. Context Manager и Context Meter

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CTX-01 | Context Meter считает effective tokens | Число > 0 | Проверка |
| CTX-02 | Context Meter считает historical tokens | Historical >= effective | Проверка |
| CTX-03 | Context Manager проверяет hard limit | Hard limit < context window | Проверка |
| CTX-04 | Context Manager решает, нужен ли compact | ROI проверен | Логи |
| CTX-05 | Context Manager сохраняет capsules в сессию | Capsule как item | Валидный |

---

## 19. Background Scheduler

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| BKS-01 | После успешного turn (с большим контекстом) | Background compaction запущен | Логи/результат |
| BKS-02 | ROI не проходит — compaction не запущен | No-op | Без ошибок |
| BKS-03 | Background compaction с timeout (backgroundTimeoutMs) | Тайм-аут не прерывает turn | Turn продолжается |
| BKS-04 | Множественные background compaction | Не более одного активного | Очередь |

---

## 20. Skills — bundled

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SKB-01 | `/skill list` | 4 bundled skills: commit-message, git-summary, lint-fix, pr-description | Все присутствуют |
| SKB-02 | `/skill:git-summary Суммируй изменения` | Skill активирован, ответ | Ответ содержит анализ git |
| SKB-03 | `/skill:commit-message Предложи commit` | Skill активирован | Предложение commit message |
| SKB-04 | `/skill:lint-fix Исправь ошибки` | Skill активирован, исправления | Линтинг проходит |
| SKB-05 | `/skill:pr-description Опиши PR` | Skill активирован | Описание PR |
| SKB-06 | Агент сам активирует skill через `activate_skill` | Skill инъецирован | Проверка |
| SKB-07 | `/skill rm commit-message --confirm` | Ошибка: bundled нельзя удалить | Сообщение об ошибке |

---

## 21. Skills — user и project

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SKU-01 | Создать `~/.soba/skills/test-skill/SKILL.md` с валидным frontmatter | Skill доступен | `/skill list` содержит |
| SKU-02 | `/skill:test-skill Выполни` | Skill активирован | Ответ |
| SKU-03 | `rm -rf ~/.soba/skills/test-skill` | Skill удалён | `/skill list` не содержит |
| SKU-04 | Создать `.agents/skills/proj-skill/SKILL.md` без trust | Не загружен | `/skill list` не содержит |
| SKU-05 | `/project-trust approve` | Project skill обнаружен | `/skill list` содержит |
| SKU-06 | `/skill:proj-skill Выполни` | Skill активирован | Ответ |
| SKU-07 | `/project-trust revoke` | Skill удалён из catalog | `/skill list` не содержит |
| SKU-08 | SKILL.md без frontmatter | Ошибка валидации | Сообщение |
| SKU-09 | SKILL.md без name/description | Ошибка валидации | Сообщение |
| SKU-10 | `.soba/skills/` — альтернативный путь для project skills | Работает | Аналогично .agents |

---

## 22. Skills — draft, eval, promote, revision

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SKD-01 | `/skill new test-desc "Описание теста"` | Draft создан | Файл в `~/.soba/skill-drafts/` |
| SKD-02 | `/skill edit test-skill` | Draft существующего skill | Файл в drafts |
| SKD-03 | `/skill eval test-desc` | Eval запущен | Результат в `~/.soba/eval-runs/` |
| SKD-04 | Eval с ошибками | Отчёт с ошибками | Не падает |
| SKD-05 | `/skill promote test-desc --scope=user` (без eval) | Ошибка: требуется eval | Сообщение |
| SKD-06 | `/skill promote test-desc --scope=user` (с успешным eval) | Skill опубликован | Файл в `~/.soba/skills/` |
| SKD-07 | `/skill promote test-desc --scope=project` (с trust) | Skill опубликован в проект | Файл в `.soba/skills/` |
| SKD-08 | `/skill history test-desc` | История revision | Не пусто |
| SKD-09 | `/skill rollback test-desc <revision-id>` | Новый draft из snapshot | Файл в drafts |
| SKD-10 | `/skill history` для несуществующего skill | Ошибка | Не падает |
| SKD-11 | `/skill rm test-desc --confirm` | Skill удалён | Нет в catalog |

---

## 23. Skills — discovery, trust, catalog

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SKC-01 | SkillDiscovery находит все 4 bundled | Все найдены | Проверка |
| SKC-02 | SkillDiscovery находит user skills | Найдены | Проверка |
| SKC-03 | SkillDiscovery не находит project без trust | Пусто | Проверка |
| SKC-04 | SkillDiscovery находит project после trust | Найдены | Проверка |
| SKC-05 | SkillCatalog показывает только имена и описания | Без тела SKILL.md | Progressive disclosure |
| SKC-06 | SkillCatalog инъецирует полный SKILL.md при активации | Полный текст | Проверка |
| SKC-07 | ProjectTrustStore сохраняет состояние | Trust переживает рестарт | Проверка |

---

## 24. Skills — workflow observer

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SKO-01 | WorkflowObserver запущен как core-модуль | Не падает | Проверка |
| SKO-02 | Observer анализирует completion gate итерации | Данные собираются | Проверка |
| SKO-03 | Observer не предлагает создать skill (v0.3 limitation) | Без автоматических предложений | Не выводится в TUI |

---

## 25. Trust Manager и разрешения

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| TRU-01 | Safe операция (read, ls) | Автоматически разрешена | Без запроса |
| TRU-02 | Normal операция (write, edit) | Выполнена с уведомлением | Без запроса подтверждения |
| TRU-03 | Dangerous операция (`rm -rf`, `sudo`) | Запрос подтверждения | Prompt |
| TRU-04 | Ответ `y` | Разрешено один раз | Операция выполнена |
| TRU-05 | Ответ `s` | Разрешено для этого действия до конца процесса | Повторное действие без запроса |
| TRU-06 | Ответ `r` | Repo-scoped разрешение | Все dangerous в этом scope без запроса |
| TRU-07 | Ответ `n` | Отклонено | Операция не выполнена |
| TRU-08 | `/permissions repo` | Режим repo | Dangerous без запроса |
| TRU-09 | `/permissions ask` | Режим ask | Dangerous с запросом |
| TRU-10 | `/permissions clear` | Все repo-scoped сброшены | Снова запрос |
| TRU-11 | `git push` — всегда dangerous (даже в repo) | Всегда запрос | Проверка |
| TRU-12 | `curl` — всегда dangerous (даже в repo) | Всегда запрос | Проверка |
| TRU-13 | `sudo` — всегда dangerous (даже в repo) | Всегда запрос | Проверка |

---

## 26. Project Trust

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| PRT-01 | `/project-trust status` в проекте без skills | Not trusted | Сообщение |
| PRT-02 | `/project-trust approve` | Trust granted | Статус обновлён |
| PRT-03 | `/project-trust approve` повторно | Trust уже есть | Сообщение |
| PRT-04 | `/project-trust revoke` | Trust revoked | Статус обновлён |
| PRT-05 | `/project-trust revoke` без trust | Trust уже нет | Сообщение |
| PRT-06 | Trust переживает рестарт | Проверка | Статус сохранён |

---

## 27. OpenResponses-клиент

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| ORC-01 | Клиент создаёт корректный запрос к API | 200 OK | Ответ |
| ORC-02 | Клиент обрабатывает streaming | Чанки в правильном порядке | Все чанки получены |
| ORC-03 | Клиент обрабатывает ошибку API (401, 429, 500) | Корректная ошибка | Не падает |
| ORC-04 | Клиент передаёт max_tokens | Ограничение соблюдено | Проверка |
| ORC-05 | Клиент передаёт tools (function_call) | Tools в запросе | Проверка |
| ORC-06 | Клиент обрабатывает response с tool_calls | Tool calls извлечены | Проверка |
| ORC-07 | Клиент обрабатывает incomplete response | Incomplete detected | Проверка |

---

## 28. OpenAI-compatible adapter (middleware)

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| MID-01 | Адаптер конвертирует openresponses → provider format | Корректная конвертация | Проверка |
| MID-02 | Адаптер конвертирует provider → openresponses | Корректная конвертация | Проверка |
| MID-03 | Адаптер определяет identity провайдера | Имя провайдера | Проверка |
| MID-04 | Middleware с нестандартным endpoint | Работает (если совместим) | Проверка |
| MID-05 | Compliance test проходит | Все тесты зелёные | Проверка |

---

## 29. i18n (мультиязычность)

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| I18-01 | `--lang ru`: все строки TUI на русском | Русский | Проверка |
| I18-02 | `--lang en`: все строки TUI на английском | Английский | Проверка |
| I18-03 | `--lang zh`: все строки TUI на китайском | Китайский | Проверка |
| I18-04 | `/lang ru` → `/lang en` → `/lang zh` | Переключение без перезапуска | Язык меняется |
| I18-05 | `/lang fr` (неподдерживаемый) | Ошибка | Сообщение |
| I18-06 | `SOBA_LANG=ru` | Язык из окружения | Работает |
| I18-07 | Все ключи перевода существуют во всех 3 языках | Нет missing keys | Проверка |
| I18-08 | Fallback при отсутствующем ключе | Английский | Не падает |

---

## 30. Темы TUI

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| THM-01 | `--theme graphite` | Graphite | Все 10 цветов |
| THM-02 | `--theme ember` | Ember | Цвета ember |
| THM-03 | `--theme aurora` | Aurora | Цвета aurora |
| THM-04 | `--theme synthwave` | Synthwave | Цвета synthwave |
| THM-05 | `--theme paper` | Paper | Цвета paper |
| THM-06 | `--theme forest` | Forest | Цвета forest |
| THM-07 | `/theme <name>` в runtime | Тема меняется | Цвета обновлены |
| THM-08 | Создать `~/.soba/custom-themes.json` с кастомной темой | Тема доступна | `/theme ocean` |
| THM-09 | custom-themes.json с невалидной палитрой (не все цвета) | Ошибка | Сообщение |
| THM-10 | custom-themes.json с дубликатом имени встроенной темы | Ошибка | Сообщение |
| THM-11 | Markdown-стиль (синтаксическая подсветка) | Работает для каждой темы | Цвета кода |
| THM-12 | `--theme` + `--no-color` | Темы не применяются | Нет цвета |

---

## 31. Budget Tracker

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| BGT-01 | `.soba --budget 1000 "Привет"` | Если превышен — остановка | Остановка |
| BGT-02 | `--budget 999999 "Длинный диалог"` | Бюджет не превышен | Диалог завершён |
| BGT-03 | `/budget` в TUI | Текущее потребление | Число |
| BGT-04 | Budget tracker учитывает все tool calls | Сумма корректна | Проверка |

---

## 32. System Prompt

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| SYS-01 | System prompt содержит описание всех инструментов | ls, read, write, edit, bash, checkpoint, activate_skill | Все 7 |
| SYS-02 | System prompt содержит catalog skills (имена) | Имена bundled skills | Проверка |
| SYS-03 | System prompt не содержит тела SKILL.md | Без полного текста | Progressive disclosure |
| SYS-04 | System prompt на русском (--lang ru) | Русский | Проверка |
| SYS-05 | System prompt на английском (--lang en) | Английский | Проверка |
| SYS-06 | System prompt содержит ограничения (max iterations, stalled, run minutes) | Лимиты в prompt | Проверка |

---

## 33. Completion Gate

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| CGT-01 | Gate проверяет завершённость ответа | Complete/Incomplete | Проверка |
| CGT-02 | Gate определяет max_iterations | Iterations limit check | Проверка |
| CGT-03 | Gate определяет все ли tool calls обработаны | Все output'ы получены | Проверка |
| CGT-04 | Gate обрабатывает пустой финальный ответ | Не падает | Проверка |

---

## 34. Loop Guard

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| LGD-01 | Guard детектирует зацикливание (те же действия повторяются) | Stall detected | Сообщение |
| LGD-02 | Guard позволяет нормальные итерации | Без вмешательства | Проверка |
| LGD-03 | Guard с max-stalled-iterations=0 | Отключён | Нет детекции |
| LGD-04 | Guard после stall recovery | Стратегия смены подхода | Проверка |

---

## 35. Endurance benchmark

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| END-01 | `bun test tests/endurance/benchmark.test.ts` | Все тесты проходят | 0 fail |
| END-02 | Benchmark-workload завершается без ошибок | Все шаги выполнены | Проверка |
| END-03 | Capsule-invariant-checker проверяет capsules | Инварианты не нарушены | Проверка |
| END-04 | Длительная сессия (6 часов simulated) | Нет деградации | Проверка |

---

## 36. Edge cases и стресс-тесты

| ID | Сценарий | Ожидаемый результат | Критерий |
|---|---|---|---|
| EDG-01 | Пустой ответ модели | Обработка без падения | Turn завершён |
| EDG-02 | Ошибка сети (обрыв соединения) | Переподключение/ошибка | Не падает |
| EDG-03 | Огромный промпт (>100K токенов) | Compact или ошибка | Не падает |
| EDG-04 | `.soba -i` без API key (wizard) `Ctrl+C` | Выход без сохранения | exit 0 |
| EDG-05 | Одновременный запуск нескольких SOBA | Независимые сессии | Каждая работает |
| EDG-06 | Работа в директории без git | TUI без git panel | Не падает |
| EDG-07 | Символы Unicode в сообщениях (эмодзи, CJK) | Корректная обработка | Не падает |
| EDG-08 | Очень длинное имя файла/путь | Обработка без ошибки | Не падает |
| EDG-09 | Специальные символы в shell (!, $, `, \, ", ') | Корректный экранинг | Не падает |
| EDG-10 | Сессия с 10,000+ items | Загрузка без тайм-аута | Работает |
| EDG-11 | Многократный rewind (>10 раз) | Дерево с 10+ ветками | Все ветки доступны |
| EDG-12 | `/compact` 10 раз подряд | Все no-op (контекст мал) | Не падает |
| EDG-13 | Удаление `~/.soba/config.json` во время работы | Обработка | Не падает |
| EDG-14 | Запуск из read-only директории | Ошибка записи сессии | Обработка |
| EDG-15 | Very rapid typing (много сообщений быстро) | Очередь обрабатывает все | Не потеряны |
| EDG-16 | `/model` смена на модель с другим context window | Portable continuation | Работает |
| EDG-17 | `/skill` с именем с пробелами | Ошибка или экранинг | Не падает |
| EDG-18 | Символ `@` в обычном тексте (не ссылка на файл) | Не интерпретируется как файл | Проверка |
| EDG-19 | Exit code модели не 0 (ошибка API) | Обработка | Не падает |
| EDG-20 | Рекурсивный вызов tool call | Loop guard прерывает | Проверка |

---

## 37. Project Memory

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| MEM-01 | `bun test tests/memory/knowledge-store.test.ts` | Knowledge Store сохраняет и ищет записи | exit 0 |
| MEM-02 | `bun test tests/memory/entity-graph.test.ts` | Entity Graph сохраняет связи проекта | exit 0 |
| MEM-03 | `bun test tests/memory/capsule-store.test.ts` | Capsule-derived state импортируется в memory | exit 0 |
| MEM-04 | `bun test tests/memory/memory-injector.test.ts` | Prompt section ограничена token budget и релевантна запросу | exit 0 |
| MEM-05 | `bun test tests/memory/memory-tools.test.ts` | Memory tools зарегистрированы и валидируют input | exit 0 |
| MEM-06 | `bun test tests/release/v0.4.0-dod.test.ts` | Новый session использует знание из предыдущего session | WOW-кейс Project Memory PASS |
| MEM-07 | `bun test tests/commands.test.ts` | One-shot/CLI flow не ломается при optional Project Memory | exit 0 |

---

## 38. MCP Client

| ID | Шаги | Ожидаемый результат | Критерий |
|---|---|---|---|
| MCP-01 | `bun test tests/core/mcp/config.test.ts` | MCP config валидируется | exit 0 |
| MCP-02 | `bun test tests/core/mcp/stdio-transport.test.ts` | stdio transport стартует server process и закрывается | exit 0 |
| MCP-03 | `bun test tests/core/mcp/json-rpc.test.ts` | JSON-RPC request/response/error обрабатываются | exit 0 |
| MCP-04 | `bun test tests/core/mcp/client.test.ts` | Client выполняет initialize/listTools/callTool | exit 0 |
| MCP-05 | `bun test tests/core/mcp/client-manager.test.ts` | Manager управляет несколькими servers | exit 0 |
| MCP-06 | `bun test tests/core/mcp/tool-proxy.test.ts` | Tool proxy нормализует schema/result | exit 0 |
| MCP-07 | `bun test tests/core/mcp/security.test.ts` | Security policy блокирует unsafe config/tools | exit 0 |
| MCP-08 | `bun test tests/core/tools/tool-registry-mcp-integration.test.ts` | MCP tools доступны через общий ToolRegistry | exit 0 |
| MCP-09 | `bun test tests/core/mcp/mcp-integration.test.ts` | Mock MCP server работает end-to-end | exit 0 |
| MCP-10 | `bun test tests/release/v0.4.0-dod.test.ts` | Два stdio MCP servers публикуют tools через AgentLoop | WOW-кейс MCP PASS |
| MCP-11 | `bun test tests/commands.test.ts` | CLI command registry не регрессирует после MCP | exit 0 |

---

## Формат результатов

Для ручного прогона используйте таблицу:

```markdown
| ID | Статус | Примечания |
|---|---|---|
| INST-01 | ✅ PASS | `bun install` выполнен за 2.3с |
| CLI-01 | ❌ FAIL | Выведено "soba v0.3.1", ожидалось "v0.3.2" |
| ... | ... | ... |
```

Итог: **X / Y PASS**, **Z FAIL** (Z = 0 для релиза).

---

## Приоритеты

| Приоритет | Категории | Должен быть PASS |
|---|---|---|
| P0 (Critical) | 1, 2, 4, 5, 11, 12, 13, 25, 27, 28, 37, 38 | 100% |
| P1 (High) | 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 29, 30, 31, 32, 33, 34 | > 95% |
| P2 (Medium) | 3, 24, 35 | > 90% |
| P3 (Edge) | 36 | > 80% |

---

## Автоматизация

Перед каждым релизом запускать:

```bash
bun test                     # 834 теста, 0 fail
bun run lint                 # 0 ошибок
bun run build                # сборка
bun test tests/endurance/benchmark.test.ts  # endurance
bun test tests/release/v0.4.0-dod.test.ts  # Project Memory + MCP WOW-кейсы
```

Ручной прогон регресс-плана — **полный (P0+P1) перед каждым релизом**,  
**сокращённый (P0) после каждого коммита** в ветке разработки.
