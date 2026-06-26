import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Clock3,
  Compass,
  GitBranch,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { baseOptions } from "@/lib/layout.shared";

type Localized = Record<string, string>;

const copy = {
  badge: {
    en: "Roadmap · v0.4.4 focus",
    ru: "Дорожная карта · что делаем дальше",
    zh: "路线图 · v0.4.4 重点",
  },
  title: {
    en: "From terminal helper to verifiable delegation",
    ru: "Куда движется SOBA",
    zh: "从终端助手到可验证的委托运行时",
  },
  lead: {
    en: "This roadmap shows product intentions, not internal task cards. The direction is simple: SOBA should remember the project, use the right tools, verify its work, and know when to ask.",
    ru: "Без внутренней кухни и списков задач. Здесь только то, что важно снаружи: SOBA должна помнить проект, аккуратно работать с инструментами, проверять себя и спрашивать, когда риск выше обычного.",
    zh: "这份路线图展示产品意图，而不是内部任务卡。方向很简单：SOBA 应该记住项目、使用合适工具、验证工作，并知道何时询问。",
  },
  primaryCta: { en: "Start with the docs", ru: "Открыть документацию", zh: "从文档开始" },
  backCta: { en: "Back to home", ru: "На главную", zh: "返回首页" },
  nowLabel: { en: "Now", ru: "Сейчас", zh: "现在" },
  principlesTitle: {
    en: "What stays constant",
    ru: "Что не трогаем",
    zh: "保持不变的原则",
  },
  principlesLead: {
    en: "The order may change as the project learns, but these product promises should not.",
    ru: "Планы могут двигаться, но эти правила должны держаться в любой версии.",
    zh: "顺序可能随着项目学习而调整，但这些产品承诺不应改变。",
  },
  horizonTitle: {
    en: "The path to 1.0",
    ru: "Дорога к 1.0",
    zh: "通往 1.0 的路径",
  },
  horizonLead: {
    en: "Each step raises the level of trust before adding more autonomy.",
    ru: "Сначала делаем работу понятнее и надёжнее. Больше самостоятельности — только после этого.",
    zh: "每一步都先提高信任度，再增加自主性。",
  },
  footerTitle: {
    en: "The north star",
    ru: "Главный ориентир",
    zh: "北极星",
  },
  footerText: {
    en: "SOBA should become the local-first engineering agent that knows the project, works in bounded loops, verifies outcomes, and leaves a clear trail.",
    ru: "SOBA должна быть локальным помощником по проекту: понимать контекст, работать короткими понятными циклами, проверять результат и оставлять после себя нормальную историю.",
    zh: "SOBA 应成为 local-first 工程代理：理解项目、在有界循环中工作、验证结果，并留下清晰轨迹。",
  },
};

const stages = [
  {
    icon: ShieldCheck,
    release: "v0.4.4",
    state: { en: "Current focus", ru: "Сейчас в работе", zh: "当前重点" },
    title: {
      en: "Trust foundation",
      ru: "Основа, которой можно доверять",
      zh: "信任基础",
    },
    intent: {
      en: "Project Memory, MCP tools, and a verified agent loop become one release stream.",
      ru: "Собираем в один рабочий слой память проекта, MCP-инструменты и цикл агента, где видно, что он делает и чем подтверждает результат.",
      zh: "项目记忆、MCP 工具和可验证代理循环进入同一个发布流。",
    },
    outcomes: {
      en: [
        "Remembers project context",
        "Connects external tools",
        "Shows a clear work trail",
        "Does not finish code work without evidence",
      ],
      ru: [
        "Помнит важные детали проекта",
        "Подключает нужные внешние инструменты",
        "Показывает ход работы без тумана",
        "Не говорит «готово» без проверки",
      ],
      zh: ["记住项目上下文", "连接外部工具", "展示清晰工作轨迹", "没有证据不结束代码任务"],
    },
  },
  {
    icon: Workflow,
    release: "v0.5",
    state: { en: "Next", ru: "Следом", zh: "下一步" },
    title: {
      en: "Visible proof",
      ru: "Понятные подтверждения",
      zh: "可见证据",
    },
    intent: {
      en: "The user should see what changed, what ran, what passed, and what still carries risk.",
      ru: "После задачи должно быть видно: что поменялось, какие команды запускались, что прошло, а где лучше не делать вид, что всё идеально.",
      zh: "用户应看到改了什么、运行了什么、通过了什么，以及风险在哪里。",
    },
    outcomes: {
      en: ["Evidence bundle", "Diff review", "First-run polish"],
      ru: ["Сводка проверок", "Разбор diff перед сдачей", "Более гладкий первый запуск"],
      zh: ["证据包", "差异审查", "首次体验打磨"],
    },
  },
  {
    icon: BrainCircuit,
    release: "v0.6",
    state: { en: "Then", ru: "Затем", zh: "然后" },
    title: {
      en: "Living project knowledge",
      ru: "Память, за которой следят",
      zh: "活的项目知识",
    },
    intent: {
      en: "Memory becomes maintained knowledge, not a pile of notes.",
      ru: "Память проекта должна быть не складом заметок, а живым знанием: что-то обновляется, что-то устаревает, у важных вещей понятен источник.",
      zh: "记忆成为被维护的知识，而不是一堆笔记。",
    },
    outcomes: {
      en: ["Memory updates", "Staleness checks", "Provenance"],
      ru: ["Аккуратное обновление памяти", "Проверка устаревших заметок", "Понимание, откуда взялся факт"],
      zh: ["记忆更新", "过期检查", "来源记录"],
    },
  },
  {
    icon: GitBranch,
    release: "v0.7",
    state: { en: "After trust", ru: "Когда база окрепнет", zh: "信任之后" },
    title: {
      en: "Background delegation",
      ru: "Долгие задачи без привязки к окну",
      zh: "后台委托",
    },
    intent: {
      en: "Tasks can live longer than one open terminal and stay isolated in their own workspaces.",
      ru: "Задача не должна разваливаться, если она длится дольше одной открытой консоли. Нужны отдельные рабочие деревья, возврат и понятное продолжение.",
      zh: "任务可以比一个终端会话更长，并在独立工作区中运行。",
    },
    outcomes: {
      en: ["Task model", "Git worktrees", "Attach and resume"],
      ru: ["Модель долгих задач", "Работа через git worktree", "Подключиться и продолжить"],
      zh: ["任务模型", "Git 工作树", "附加与恢复"],
    },
  },
  {
    icon: Compass,
    release: "v0.8 → 1.0",
    state: { en: "Stabilize", ru: "К 1.0", zh: "稳定化" },
    title: {
      en: "Delegation with judgment",
      ru: "Больше самостоятельности, но без самодеятельности",
      zh: "有判断力的委托",
    },
    intent: {
      en: "SOBA should turn outcomes into contracts, escalate when risk is high, and ship with a stable user promise.",
      ru: "Перед работой SOBA должна понимать, какой результат нужен, вовремя поднимать руку при риске и держать обещания, которые можно проверить.",
      zh: "SOBA 应把结果转成契约，在高风险时升级，并以稳定承诺发布。",
    },
    outcomes: {
      en: ["Verification contracts", "Smart escalation", "1.0 release hardening"],
      ru: ["Договорённость о результате", "Умная остановка при риске", "Вычищенный релиз 1.0"],
      zh: ["验证契约", "智能升级", "1.0 发布加固"],
    },
  },
];

const principles = [
  {
    icon: CheckCircle2,
    title: {
      en: "Verify before confidence",
      ru: "Сначала проверка, потом уверенность",
      zh: "先验证，再确信",
    },
    text: {
      en: "A green answer should be backed by visible work, commands, evidence, or a clear unverified status.",
      ru: "Если SOBA пишет «готово», за этим должны стоять команды, изменения, проверка или честная пометка, что результат ещё не подтверждён.",
      zh: "成功回答应由可见工作过程、命令、证据或明确的未验证状态支撑。",
    },
  },
  {
    icon: Network,
    title: {
      en: "Extensible, not chaotic",
      ru: "Расширяемость без бардака",
      zh: "可扩展，但不混乱",
    },
    text: {
      en: "MCP and skills expand the toolset while the runtime keeps permissions and results understandable.",
      ru: "MCP и skills добавляют возможности, но права, действия и результаты должны оставаться понятными человеку.",
      zh: "MCP 和技能扩展工具集，运行时保持权限和结果清晰。",
    },
  },
  {
    icon: Clock3,
    title: {
      en: "Long work without context rot",
      ru: "Длинная работа без потери нити",
      zh: "长任务不腐烂上下文",
    },
    text: {
      en: "Sessions, capsules, checkpoints, and memory should preserve the task state across long work.",
      ru: "Сессии, капсулы, чекпоинты и память должны помогать вернуться к задаче даже после длинной паузы.",
      zh: "会话、胶囊、检查点和记忆应在长任务中保持状态。",
    },
  },
];

export const Route = createFileRoute("/$lang/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const { lang } = Route.useParams();
  const t = (value: Localized) => value[lang] ?? value.en;

  return (
    <HomeLayout {...baseOptions(lang)}>
      <main className="roadmap-shell">
        <section className="roadmap-hero">
          <div className="roadmap-hero-grid mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[0.98fr_1.02fr] lg:px-8 lg:py-16">
            <div>
              <Link to="/$lang" params={{ lang }} className="roadmap-back-link">
                <ArrowLeft className="size-4" />
                {t(copy.backCta)}
              </Link>
              <div className="roadmap-badge">
                <Sparkles className="size-4" />
                <span>{t(copy.badge)}</span>
              </div>
              <h1>{t(copy.title)}</h1>
              <p>{t(copy.lead)}</p>
              <div className="roadmap-actions">
                <Link to="/$lang/docs/$" params={{ lang, _splat: "" }} className="hero-cta hero-cta-primary">
                  {t(copy.primaryCta)}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>

            <div className="roadmap-now-panel">
              <div className="roadmap-now-header">
                <span>{t(copy.nowLabel)}</span>
                <strong>v0.4.4</strong>
              </div>
              <div className="roadmap-now-body">
                <ShieldCheck className="size-8" />
                <h2>{t(stages[0].title)}</h2>
                <p>{t(stages[0].intent)}</p>
              </div>
              <div className="roadmap-now-list">
                {stages[0].outcomes[lang as keyof (typeof stages)[number]["outcomes"]]?.map((outcome) => (
                  <span key={outcome}>{outcome}</span>
                )) ?? stages[0].outcomes.en.map((outcome) => <span key={outcome}>{outcome}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="roadmap-section">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="roadmap-section-heading">
              <p className="eyebrow">{t(copy.horizonTitle)}</p>
              <h2>{t(copy.horizonLead)}</h2>
            </div>
            <div className="roadmap-timeline">
              {stages.map((stage) => {
                const Icon = stage.icon;
                const outcomes = stage.outcomes[lang as keyof typeof stage.outcomes] ?? stage.outcomes.en;

                return (
                  <article key={stage.release} className="roadmap-stage">
                    <div className="roadmap-stage-marker">
                      <CircleDot className="size-5" />
                    </div>
                    <div className="roadmap-stage-content">
                      <div className="roadmap-stage-meta">
                        <span>{stage.release}</span>
                        <strong>{t(stage.state)}</strong>
                      </div>
                      <div className="roadmap-stage-main">
                        <div className="roadmap-stage-icon">
                          <Icon className="size-5" />
                        </div>
                        <div>
                          <h3>{t(stage.title)}</h3>
                          <p>{t(stage.intent)}</p>
                        </div>
                      </div>
                      <div className="roadmap-stage-outcomes">
                        {outcomes.map((outcome) => (
                          <span key={outcome}>{outcome}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="roadmap-section roadmap-principles-section">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
            <div className="roadmap-section-heading">
              <p className="eyebrow">{t(copy.principlesTitle)}</p>
              <h2>{t(copy.principlesLead)}</h2>
            </div>
            <div className="roadmap-principles">
              {principles.map((principle) => {
                const Icon = principle.icon;

                return (
                  <article key={principle.title.en} className="roadmap-principle">
                    <Icon className="size-5" />
                    <div>
                      <h3>{t(principle.title)}</h3>
                      <p>{t(principle.text)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="roadmap-footer-band">
          <div className="mx-auto max-w-5xl px-6 text-center lg:px-8">
            <p className="eyebrow">{t(copy.footerTitle)}</p>
            <h2>{t(copy.footerText)}</h2>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
