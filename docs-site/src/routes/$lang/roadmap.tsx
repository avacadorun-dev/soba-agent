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
import { APP_VERSION_LABEL } from "@/lib/version";

type Localized = Record<string, string>;

const copy = {
  badge: {
    en: `Roadmap · ${APP_VERSION_LABEL} stabilization`,
    ru: `Дорожная карта · стабилизация ${APP_VERSION_LABEL}`,
    zh: `路线图 · ${APP_VERSION_LABEL} 稳定化`,
  },
  title: {
    en: "From terminal helper to evidence-first engineering agent",
    ru: "От терминального помощника к инженерному агенту с доказательствами",
    zh: "从终端助手到证据优先的工程代理",
  },
  lead: {
    en: "The current 0.6.x line is about stabilization: proofs, memory provenance, permissions, skills, and docs must become dependable before 0.7.0 adds larger delegation features.",
    ru: "Текущая линия 0.6.x — про стабилизацию: proof receipts, память с источниками, разрешения, skills и документация должны стать надёжными до того, как 0.7.0 добавит более крупную delegation-модель.",
    zh: "当前 0.6.x 线聚焦稳定化：proof、记忆来源、权限、技能和文档先变可靠，0.7.0 再加入更大的委托能力。",
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
    en: "Each step raises evidence quality before adding more autonomy.",
    ru: "Каждый шаг сначала делает подтверждения надёжнее, и только потом добавляет автономность.",
    zh: "每一步先提高证据质量，再增加自主性。",
  },
  footerTitle: {
    en: "The north star",
    ru: "Главный ориентир",
    zh: "北极星",
  },
  footerText: {
    en: "SOBA should become the local-first engineering agent that remembers, verifies, and leaves receipts.",
    ru: "SOBA должна стать local-first инженерным агентом, который помнит проект, проверяет результат и оставляет receipts.",
    zh: "SOBA 应成为 local-first 工程代理：记住项目、验证结果并留下 receipts。",
  },
};

const stages = [
  {
    icon: ShieldCheck,
    release: APP_VERSION_LABEL,
    state: { en: "Release focus", ru: "Фокус релиза", zh: "发布重点" },
    title: {
      en: "0.6.x stabilization",
      ru: "Стабилизация 0.6.x",
      zh: "0.6.x 稳定化",
    },
    intent: {
      en: "Proof receipts, memory provenance, permission receipts, skill bench/trace, and the Bun wrapper fix ship together as a dependable 0.6.x baseline.",
      ru: "Proof receipts, memory provenance, permission receipts, skill bench/trace и Bun wrapper fix выходят вместе как надёжная 0.6.x база.",
      zh: "Proof receipts、记忆来源、权限回执、skill bench/trace 和 Bun wrapper 修复一起作为可靠的 0.6.x 基线发布。",
    },
    outcomes: {
      en: [
        "Bun and npm global installs work",
        "Proof commands explain claims",
        "Memory doctor detects stale facts",
        "Skill bench and trace expose eval quality",
      ],
      ru: [
        "Глобальная установка через Bun и npm работает",
        "Proof commands объясняют claims",
        "Memory doctor находит stale facts",
        "Skill bench и trace показывают качество eval",
      ],
      zh: ["Bun 和 npm 全局安装可用", "Proof 命令解释 claims", "Memory doctor 发现过期事实", "Skill bench 和 trace 展示 eval 质量"],
    },
  },
  {
    icon: Workflow,
    release: "v0.6.x",
    state: { en: "Harden", ru: "Доводим", zh: "加固" },
    title: {
      en: "Evidence contracts",
      ru: "Evidence contracts",
      zh: "证据契约",
    },
    intent: {
      en: "Finish behavior should be enforced by runtime gates and explicit verification contracts, not only prompt discipline.",
      ru: "Финиш должен держаться runtime gates и явными verification contracts, а не только дисциплиной prompt.",
      zh: "完成行为应由 runtime gates 和明确 verification contracts 约束，而不只靠 prompt 纪律。",
    },
    outcomes: {
      en: ["Verification contracts", "Proof-gated finish", "Release smoke scenarios"],
      ru: ["Verification contracts", "Proof-gated finish", "Release smoke scenarios"],
      zh: ["Verification contracts", "Proof-gated finish", "发布 smoke 场景"],
    },
  },
  {
    icon: BrainCircuit,
    release: "v0.6.x",
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
    release: "v0.7.0",
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
                <strong>{APP_VERSION_LABEL}</strong>
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
