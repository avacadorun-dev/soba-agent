# Research Notes

Этот документ фиксирует применимые идеи из публичных работ и engineering notes. Цель не в академической полноте, а в
том, чтобы связать улучшения SOBA с проверенными agent patterns.

## Core Findings

### ReAct

Источник: [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

ReAct показывает ценность чередования reasoning и actions: модель строит/корректирует план, а tools дают внешние
наблюдения. Для SOBA это означает: Agent Loop должен заставлять модель возвращаться к observation после каждого важного
tool result, а не позволять завершать задачу на внутренней уверенности.

Применение:

- explicit inspect/act/observe/verify loop;
- tool result summaries as state transitions;
- loop guard для repeated failed actions.

### Reflexion

Источник: [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)

Reflexion использует verbal feedback и episodic memory для улучшения следующих попыток. Для SOBA полезна не скрытая
"думай лучше" рефлексия, а структурированная запись lessons после failures и successful recovery.

Применение:

- after-error reflection: symptom, hypothesis, action, result;
- after-green memory capsule: failing command, root cause, fix pattern;
- dedupe и secret guard перед записью в memory.

### CRITIC

Источник: [CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing](https://arxiv.org/abs/2305.11738)

CRITIC подчёркивает, что самокоррекция улучшается, когда critique основан на external feedback. Для code agent это
означает: critique должен опираться на test/lint/typecheck/build, а не на текстовую уверенность модели.

Применение:

- verification commands as critique tools;
- diagnostics parser вместо raw log dumping;
- completion gate требует external evidence.

### Self-Refine

Источник: [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)

Self-Refine применяет цикл feedback -> refine без дополнительного обучения. Для SOBA это соответствует bounded
Fix-Until-Green loop: сгенерировать fix, проверить, получить diagnostics, уточнить patch.

Применение:

- max retry budget;
- structured feedback per iteration;
- stop conditions when same failure repeats.

### Process Supervision

Источник: [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050) и
[OpenAI: Improving Mathematical Reasoning with Process Supervision](https://openai.com/index/improving-mathematical-reasoning-with-process-supervision/)

Process supervision лучше outcome-only supervision там, где важен путь решения. Для SOBA это означает: оценивать не
только финальный ответ, но и соблюдение инженерного процесса.

Применение:

- eval scoring по intermediate states;
- fail test if agent mutated code without verification;
- score plan quality, evidence quality, recovery behavior.

### SWE-agent

Источник: [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)

SWE-agent показывает, что качество agent-computer interface влияет на результат не меньше модели. Для SOBA слабые модели
нуждаются в специализированных tools: search, inspect, run checks, structured patch, diagnostics.

Применение:

- заменить часть free-form bash на purpose-built tools;
- helpful machine-readable tool errors;
- trace navigation/edit/test actions.

### Agentless

Источник: [Agentless: Demystifying LLM-based Software Engineering Agents](https://arxiv.org/abs/2407.01489)

Agentless показывает, что deterministic localization -> repair -> validation может быть конкурентоспособнее сложной
автономности. Для слабых моделей это важный профиль: меньше свободы, больше rails.

Применение:

- model profiles;
- weak-model workflow: locate files, propose patch, validate;
- no open-ended exploration without budget.

### Anthropic Engineering Notes

Источники:

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Writing tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

Применимые идеи:

- строить простые composable patterns вместо монолитной магии;
- держать context high-signal и just-in-time;
- писать tool descriptions как API для агента;
- измерять runtime, tool calls, errors, token usage;
- делать tool errors полезными для следующего действия;
- использовать evaluator loops там, где есть объективная проверка.

### OpenAI Prompting Guidance

Источник: [GPT-4.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)

Применимые идеи:

- agent prompts должны явно закреплять persistence;
- tool calling должен иметь инструкции "когда" и "как";
- планирование полезно, но его нужно проверять evals;
- качество prompt changes без evals быстро деградирует.

## Research-Informed SOBA Direction

1. Не просить модель "рефлексировать" абстрактно; сохранять structured reflection только после external feedback.
2. Не полагаться на hidden reasoning; хранить observable state в Evidence Ledger.
3. Не делать prompt длиннее бесконечно; делать loop строже.
4. Для слабых моделей использовать deterministic rails и purpose-built tools.
5. Все изменения в prompt/skills/tool schemas прогонять через eval suite.
