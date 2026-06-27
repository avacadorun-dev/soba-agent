# SOBA — Стратегическое позиционирование (Phase 3+)

**Дата:** июнь 2026
**Контекст:** Рынок AI-coding-агентов насыщен: 20+ инструментов от enterprise (Copilot, Devin) до open-source (OpenCode 172K★, Cline 63K★, Aider 46K★, Goose 49K★). SOBA — минималистичное ядро (4 примитива) с уникальными фичами: proactive compaction и adaptive self-modifying skills.

---

## 1. Где стоит SOBA сегодня

### По форме: CLI-агент (терминальный)
Конкуренты: Claude Code, Codex CLI, Aider, OpenCode, Gemini CLI

### По содержанию: архитектурно-уникальный
- **Proactive context management** — авто-компакция с task boundaries и checkpoint-based rewind
- **Adaptive Skills** — генерация/эвалюация/промоушен скилов агентом (Skills as Markdown, не MCP)
- **OpenResponses Protocol** — собственная спецификация + compliance-тесты
- **Trust System** — domain-based гранулярное доверие (safe/normal/dangerous)
- **Bun-native** — один рантайм, без Node.js Legacy

### Чего пока нет
- Широкой пользовательской базы (новичок на рынке)
- Hybrid visual preview (отложено в Phase 4)
- Enterprise-фич (SSO, audit, team management)

---

## 2. Карта конкурентных преимуществ (KFS Matrix)

| Фича | SOBA | Claude Code | Codex CLI | OpenCode | Cline | Aider | Goose |
|------|------|------------|-----------|----------|-------|-------|-------|
| **Proactive compaction** | ✅ **Уникально** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Adaptive skills (self-modifying)** | ✅ **Уникально** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Терминальный TUI** | ✅ OpenTUI | ✅ Rich | ✅ Rich | ❌ Plain | ❌ Plain | ❌ Plain | ❌ Plain |
| **Checkpoint rewind** | ✅ **Редко** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **OpenResponses протокол** | ✅ **Уникально** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Trust system (domain-based)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **BYOK (любая модель)** | ✅ | ❌ (только Anthropic) | ✅ (OpenAI+10+) | ✅ (75+) | ✅ (любой) | ✅ (любой) | ✅ (15+) |
| **MCP support** | 🟡 Optional | ✅ Deep | ⚠️ Limited | ✅ | ✅ Deep | ❌ | ✅ Deep |
| **IDE integration** | ❌ | ✅ VS/JB/Desktop | ✅ VS/Web/Desktop | ✅ VS/Desktop | ✅ VS/JB | ❌ | ✅ Desktop |
| **Benchmark (Terminal-Bench)** | ❌ unknown | 78.9% | **83.4%** | ? | ? | ? | ? |
| **Open source** | ✅ | ❌ | ❌ | ✅ MIT | ✅ Apache-2 | ✅ Apache-2 | ✅ Apache-2 |
| **Enterprise support** | ❌ | ✅ | ✅ (ChatGPT) | ❌ | ❌ | ❌ | ✅ (Linux Foundation) |
| **Git-native workflow** | ✅ (with skills) | ✅ | ✅ | ✅ | ✅ | ✅ (auto-commit) | ✅ |

---

## 3. Ключевой инсайт

Рынок делится на два лагеря:
1. **«Чья модель сильнее»** — Claude Code / Codex CLI. Всё завязано на конкретном LLM.
2. **«Любая модель — твой выбор»** — OpenCode / Cline / Aider. BYOK, низкий порог входа.

**SOBA не вписывается ни в один лагерь** — и это её суперсила.

> SOBA — не «обёртка вокруг модели». SOBA — это **платформа агента**, которая решает проблемы, с которыми модели не справляются: управление контекстом, адаптация под проект, безопасность и прозрачность.

### Почему это важно
- Модели становятся сильнее каждые 3 месяца. GPT-5.5, Claude Opus 4.8, Gemini 3.1 Pro — benchmark-гонка бесконечна.
- Но ни одна модель не решает проблему **деградации сессии через 3 часа**, **переполнения контекстного окна**, **кастомизации под конкретный проект**.
- **Proactive compaction** — единственное известное решение для 6-часовых сессий без потери контекста.
- **Adaptive Skills** — единственный способ кастомизации без DevOps/MCP.

---

## 4. Стратегическое позиционирование

### Тезис (одним предложением)

> **Терминальный агент, который не забывает, адаптируется под твой проект и не диктует, какую модель использовать.**

### Ключевые сообщения

| Для кого | Месседж |
|----------|---------|
| **Senior разработчики с большими кодовыми базами** | «Работай 6+ часов без рестарта. Proactive compaction держит контекст свежим, а не перезагружает его.» |
| **Fullstack-разработчики** | «Одна сессия на весь день. Не теряй нить рассуждений после обеда.» |
| **Техлиды / настройщики процессов** | «Skills как Markdown — кастомизация за минуты. Никаких MCP-серверов.» |
| **Privacy-conscious команды** | «BYOK + open-source. Ты платишь только за токены, не за обёртку.» |
| **Open-source сообщество** | «OpenResponses — открытый протокол для агентов. Присоединяйся.» |

### Позиционирование в ландшафте

```text
                    «Сильнейшая модель»
                         ↑
              Claude Code     Codex CLI
                         
     «IDE-native» ← ── ── ── → «CLI-native»
       Cursor                    Aider
       Copilot                   OpenCode
       Windsurf                  SOBA *← здесь
                                 Gemini CLI
                         ↓
                    «Полный контроль»
                 (BYOK, open-source, self-hosted)
```

**SOBA** занимает нишу **CLI-native + полный контроль + архитектурная глубина**.

---


---

## 6. Стратегия на Phase 3

### Цель: агент помнит проект и чинит свой код

**Ключевая метрика:** Пользователь запускает вторую сессию — агент помнит архитектуру проекта.

### Что для этого нужно (уже в плане Phase 3)

| Компонент | Влияние | Приоритет |
|-----------|---------|-----------|
| Project Memory (Knowledge + Capsules) | Агент помнит проект между сессиями | 🔴 P0 |
| Fix-Until-Green | Код проверяется и чинится автоматически | 🔴 P0 |
| CI/CD | Качество кода, темп разработки | 🟡 P1 |

### Анти-стратегия: чего НЕ делать в Phase 3

- ❌ Не пытаться конкурировать с Claude Code / Codex CLI по benchmark
- ❌ Не добавлять MCP как core-зависимость (оставить optional)
- ❌ Не делать web-дашборд (распыление)
- ❌ Не оптимизировать под Windows до стабильного macOS/Linux
- ❌ Не писать enterprise-фичи (SSO, audit)

---

## 7. Долгосрочное видение (Phase 4+)

```
Phase 3 (сейчас)           Phase 4                     Phase 5
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│ Project Memory      │   │ Multi-Agent          │   │ Platform & Economy  │
│ Fix-Until-Green     │ → │ Background Tasks     │ → │ Visual Layer        │
│ CI/CD Pipeline      │   │ MCP-native arch      │   │ Skill Marketplace   │
│ Growth: trustworthy │   │ Growth: autonomous   │   │ Growth: scalable    │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

### Дорожная карта

```
Phase 2     Intelligence     (v0.3.x)    ✅ готово
Phase 2.5   TUI/UX Polish    (v0.3.5+x)  📋 следующая
Phase 3     Memory+Self-Heal (v0.4.x)    📋 после 2.5
Phase 4     Multi-Agent      (v0.5.x)    📋 после 3
Phase 5     Visual Layer     (v0.6.x)    📋 после 4
```

---

## 8. Конкретные шаги на Phase 3 (commitment)

В рамках Phase 3 мы **закладываем фундамент памяти и самоисправления**:

1. **Project Memory** → агент помнит проект между сессиями (Knowledge + Capsules + Graph)
2. **Fix-Until-Green** → код проверяется и чинится автоматически (CommandDetector + Runner + Loop)
3. **Auto-Extractor** → капсулы создаются автоматически из ошибок и фиксов
4. **CI/CD** → качество и темп разработки

Эти 4 вещи превратят SOBA из «агента, который пишет код» в **агента, который помнит проект и доводит код до зелёного**.

---

## 9. Резюме

| Вопрос | Ответ |
|--------|-------|
| **Кто конкуренты?** | OpenCode (BYOK, 172K★), Claude Code (модель), Codex CLI (benchmark) |
| **Чем SOBA уникальна?** | Project Memory (память между сессиями), Fix-Until-Green (авто-отладка), Proactive Compaction |
| **Где её ниша?** | Senior-разработчики, которым нужна память проекта и self-healing код |
| **Что в Phase 3?** | Project Memory + Fix-Until-Green + CI/CD |
| **Что будет после Phase 3?** | Multi-Agent (Phase 4) → Visual Layer (Phase 5) |

> **SOBA — это не очередной агент кодинга. Это инфраструктура доверия и делегирования, которая помнит твой проект и доводит код до зелёного.**
