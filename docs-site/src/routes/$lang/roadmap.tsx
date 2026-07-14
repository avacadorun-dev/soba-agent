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
    en: "The current line hardens completion evidence inside the local agent. A six-week adoption pilot and safe workspaces come before any standalone proof platform or larger delegation loop.",
    ru: "Текущая линия укрепляет completion evidence внутри local agent. Шестинедельный adoption pilot и безопасные workspaces идут раньше отдельной proof-платформы или большого delegation loop.",
    zh: "当前路线强化本地代理内的 completion evidence。先进行六周 adoption pilot 并建设安全 workspace，再考虑独立 proof 平台或更大的 delegation loop。",
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
    en: "SOBA should be a trustworthy local coding agent whose handoff makes observed work, declarations, and unknowns easy to distinguish.",
    ru: "SOBA должна быть надёжным local coding agent, в handoff которого легко отличить наблюдаемые факты, декларации и неизвестное.",
    zh: "SOBA 应成为可信的本地 coding agent，让 handoff 中的已观察事实、声明和未知项清晰可分。",
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
      en: "Proof Bundle v1 becomes tamper-evident, false completion gets an adversarial release corpus, and real-model comparisons establish a measurable baseline.",
      ru: "Proof Bundle v1 получает контроль integrity, false completion — adversarial release corpus, а real-model сравнения создают измеримый baseline.",
      zh: "Proof Bundle v1 获得 integrity 检查，false completion 有 adversarial release corpus，并用 real-model 对比建立可衡量 baseline。",
    },
    outcomes: {
      en: [
        "Versioned and sealed proof contract",
        "Zero false verified completions in the release corpus",
        "Stable reasons and policy exit codes",
        "Repeatable real-model comparative evals",
      ],
      ru: [
        "Versioned и sealed proof contract",
        "Ноль false verified completions в release corpus",
        "Stable reasons и policy exit codes",
        "Повторяемые real-model comparative evals",
      ],
      zh: ["Versioned 与 sealed proof contract", "Release corpus 中 false verified completion 为零", "Stable reasons 与 policy exit codes", "可重复的 real-model comparative evals"],
    },
  },
  {
    icon: Workflow,
    release: "v0.7.0",
    state: { en: "Next", ru: "Дальше", zh: "下一步" },
    title: { en: "Verified handoff pilot", ru: "Пилот verified handoff", zh: "Verified handoff 试点" },
    intent: {
      en: "SOBA separates observed checks, declared claims, unknowns, freshness, and integrity, then tests whether real teams use the report in review.",
      ru: "SOBA разделяет observed checks, declared claims, unknown, freshness и integrity, а затем проверяет, используют ли реальные команды отчёт в review.",
      zh: "SOBA 分离 observed checks、declared claims、unknown、freshness 与 integrity，并验证真实团队是否会在 review 中使用报告。",
    },
    outcomes: {
      en: ["Freshness-aware handoff", "PR-ready Markdown", "Optional GitHub attestation wrapper", "Six-week pilot across 10 repositories"],
      ru: ["Freshness-aware handoff", "Markdown для PR", "Опциональная GitHub attestation", "Шестинедельный пилот на 10 репозиториях"],
      zh: ["Freshness-aware handoff", "可用于 PR 的 Markdown", "可选 GitHub attestation 封装", "覆盖 10 个仓库的六周试点"],
    },
  },
  {
    icon: BrainCircuit,
    release: "v0.7.x",
    state: { en: "Before autonomy", ru: "До автономности", zh: "自主运行之前" },
    title: {
      en: "Safe workspace foundation",
      ru: "Безопасный workspace foundation",
      zh: "安全 workspace foundation",
    },
    intent: {
      en: "Isolated worktrees, fail-closed headless policy, budgets, and durable run states make unattended execution bounded and recoverable.",
      ru: "Изолированные worktrees, fail-closed headless policy, budgets и durable run states делают unattended execution ограниченным и восстанавливаемым.",
      zh: "通过隔离 worktrees、fail-closed headless policy、budgets 和 durable run states，让 unattended execution 有边界且可恢复。",
    },
    outcomes: {
      en: ["Workspace lifecycle", "Git worktrees", "Headless policy and budgets", "Crash-safe run state"],
      ru: ["Workspace lifecycle", "Git worktrees", "Headless policy и budgets", "Crash-safe run state"],
      zh: ["Workspace lifecycle", "Git worktrees", "Headless policy 与 budgets", "Crash-safe run state"],
    },
  },
  {
    icon: GitBranch,
    release: "v0.8.x",
    state: { en: "Conditional", ru: "После go/no-go", zh: "条件阶段" },
    title: {
      en: "Minimal verified loop",
      ru: "Minimal verified loop",
      zh: "最小 verified loop",
    },
    intent: {
      en: "Fresh-context iterations repeat one bounded task until controller-owned deterministic gates accept it, with resume and idempotency.",
      ru: "Fresh-context iterations повторяют одну bounded task до принятия controller-owned deterministic gates, с resume и idempotency.",
      zh: "Fresh-context iterations 重复一个 bounded task，直到 controller-owned deterministic gates 接受，并支持 resume 与 idempotency。",
    },
    outcomes: {
      en: ["Fresh sessions", "Controller-owned gates", "Failure feedback", "Resume without duplicate work"],
      ru: ["Fresh sessions", "Controller-owned gates", "Failure feedback", "Resume без дублирования работы"],
      zh: ["Fresh sessions", "Controller-owned gates", "Failure feedback", "Resume 且不重复工作"],
    },
  },
  {
    icon: Compass,
    release: "v0.9 → 1.0",
    state: { en: "Stabilize", ru: "К 1.0", zh: "稳定化" },
    title: { en: "Trustworthy local agent", ru: "Надёжный local agent", zh: "可信本地代理" },
    intent: {
      en: "Adoption evidence, agent quality, compatibility, selected integrations, and reproducible evals shape a focused 1.0 product.",
      ru: "Данные adoption, качество агента, compatibility, выбранные integrations и воспроизводимые evals формируют сфокусированный продукт 1.0.",
      zh: "以 adoption 数据、代理质量、compatibility、精选 integrations 和可重复 evals 塑造聚焦的 1.0 产品。",
    },
    outcomes: {
      en: ["Agent quality", "Retained handoff usage", "Selected integrations", "1.0 release hardening"],
      ru: ["Качество агента", "Retained usage handoff", "Выбранные integrations", "1.0 release hardening"],
      zh: ["代理质量", "Handoff 留存使用", "精选 integrations", "1.0 release hardening"],
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
