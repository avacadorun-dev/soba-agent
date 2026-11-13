import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileCode2,
  GitBranch,
  History,
  LockKeyhole,
  Network,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { SobaOrbitCanvas } from "@/components/soba-orbit-canvas";
import { baseOptions } from "@/lib/layout.shared";
import { alternateLanguageLinks, canonicalUrl, getLandingSeo, previewImageUrl } from "@/lib/seo";
import { APP_VERSION_LABEL } from "@/lib/version";

type Locale = "en" | "ru" | "zh";
type LocalizedText = Record<Locale, string>;

const text = (en: string, ru: string, zh: string): LocalizedText => ({ en, ru, zh });

const copy = {
  release: text(
    `${APP_VERSION_LABEL} is now available`,
    `${APP_VERSION_LABEL} уже доступна`,
    `${APP_VERSION_LABEL} 现已发布`,
  ),
  headlineFirst: text("Code finished.", "Код готов.", "代码完成。"),
  headlineSecond: text("Proof included.", "Доказательства — тоже.", "证据齐备。"),
  lead: text(
    "SOBA is an open-source, local-first coding agent that works in your terminal, verifies its changes, and shows exactly what happened.",
    "SOBA — open-source агент для разработки, который работает в вашем терминале, проверяет изменения и наглядно показывает, что именно было сделано.",
    "SOBA 是开源的 local-first 编码代理，在你的终端中工作，验证每次变更，并清楚展示整个过程。",
  ),
  primaryCta: text("Get started", "Начать работу", "快速开始"),
  secondaryCta: text("Explore the docs", "Документация", "查看文档"),
  installLabel: text("Install with npm", "Установка через npm", "使用 npm 安装"),
  openSource: text("Free and open source under MIT", "Бесплатно и открыто по лицензии MIT", "基于 MIT 许可免费开放"),
  principlesEyebrow: text("Designed for engineering teams", "Для инженерной работы", "为工程团队而设计"),
  workflowEyebrow: text("A visible working loop", "Прозрачный цикл работы", "清晰可见的工作循环"),
  workflowTitle: text("From task to verified result", "От задачи к проверенному результату", "从任务到验证结果"),
  workflowLead: text(
    "A clear process instead of a black box. You can inspect the context, the changes, and the evidence at every step.",
    "Понятный процесс вместо чёрного ящика. Контекст, изменения и доказательства доступны на каждом шаге.",
    "用清晰的流程取代黑盒。每一步的上下文、变更和证据都可以检查。",
  ),
  featuresEyebrow: text("Built for real projects", "Создан для реальных проектов", "为真实项目而生"),
  featuresTitle: text("The context stays. So does the control.", "Контекст сохраняется. Контроль тоже.", "上下文不丢失，控制权不放手。"),
  featuresLead: text(
    "The details that matter after the demo: durable memory, resumable sessions, explicit permissions, and tools you can extend.",
    "Всё, что важно после первого демо: долговременная память, продолжение сессий, явные разрешения и расширяемые инструменты.",
    "关注演示之后真正重要的能力：持久记忆、可恢复会话、明确权限和可扩展工具。",
  ),
  orbitEyebrow: text("One connected system", "Единая система", "一个互联的系统"),
  orbitTitle: text("See how the work fits together", "Вся работа — как на ладони", "看清工作如何协同"),
  orbitLead: text(
    "Memory, sessions, tools, permissions, and proof are part of the same local workflow — not a collection of disconnected add-ons.",
    "Память, сессии, инструменты, разрешения и доказательства работают в одном локальном процессе, а не как набор несвязанных дополнений.",
    "记忆、会话、工具、权限和证据同属一个本地工作流，而不是彼此孤立的附加组件。",
  ),
  releaseEyebrow: text(`New in ${APP_VERSION_LABEL}`, `Новое в ${APP_VERSION_LABEL}`, `${APP_VERSION_LABEL} 新功能`),
  releaseTitle: text("A more reliable agent, under the hood", "Больше надёжности в каждой задаче", "更可靠的代理，更扎实的能力"),
  releaseLead: text(
    "The latest release strengthens the unglamorous parts of agent work: long-running commands, safe edits, useful evidence, and environment diagnostics.",
    "Новый релиз улучшает самую важную часть работы агента: длинные команды, безопасные правки, полезные доказательства и диагностику окружения.",
    "新版本强化了代理工作的关键环节：长时间运行的命令、安全修改、有效证据和环境诊断。",
  ),
  releaseLink: text("Read the release notes", "Что нового в релизе", "查看发布说明"),
  finalEyebrow: text("Start with one bounded task", "Начните с одной конкретной задачи", "从一个明确的任务开始"),
  finalTitle: text("Let your next change come with proof.", "Пусть у следующего изменения будут доказательства.", "让下一次变更自带证据。"),
  finalText: text(
    "Install SOBA, connect your model, and see exactly how your agent works.",
    "Установите SOBA, подключите модель и посмотрите, как агент решает вашу задачу.",
    "安装 SOBA，连接你的模型，清楚了解代理如何完成任务。",
  ),
  footerTagline: text(
    "Local-first engineering. Verifiable results.",
    "Локальная разработка. Проверяемые результаты.",
    "本地优先的工程代理，结果可验证。",
  ),
};

const principles = [
  {
    value: "Local-first",
    label: text("Your project stays on your machine", "Проект остаётся на вашем компьютере", "项目保留在你的设备上"),
  },
  {
    value: "MIT",
    label: text("Open source, ready to inspect", "Открытый код, который можно проверить", "开源代码，随时可查"),
  },
  {
    value: "MCP",
    label: text("Your tools, connected explicitly", "Ваши инструменты с явным подключением", "明确连接你的工具"),
  },
  {
    value: "EN · RU · 中文",
    label: text("Interface and documentation", "Интерфейс и документация", "界面与文档"),
  },
];

const workflow = [
  {
    number: "01",
    icon: FileCode2,
    title: text("Understand", "Изучает", "理解"),
    description: text(
      "Reads the codebase, project memory, and existing session before touching anything.",
      "Сначала изучает код, память проекта и текущую сессию — и только потом вносит изменения.",
      "在修改之前，先读取代码库、项目记忆和现有会话。",
    ),
    meta: text("Code · docs · memory", "Код · документы · память", "代码 · 文档 · 记忆"),
  },
  {
    number: "02",
    icon: GitBranch,
    title: text("Make the change", "Изменяет", "修改"),
    description: text(
      "Works through bounded tools and explicit permissions, with every action visible.",
      "Работает через ограниченные инструменты и явные разрешения. Каждое действие видно.",
      "通过有边界的工具和明确权限执行，每个操作都清晰可见。",
    ),
    meta: text("Tools · skills · MCP", "Инструменты · навыки · MCP", "工具 · 技能 · MCP"),
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: text("Prove the result", "Доказывает", "验证"),
    description: text(
      "Runs relevant checks and connects the final claims to files, results, and remaining risks.",
      "Запускает нужные проверки и связывает итог с файлами, результатами и оставшимися рисками.",
      "运行相关检查，将最终结论与文件、结果和剩余风险关联。",
    ),
    meta: text("Checks · claims · receipts", "Проверки · выводы · receipts", "检查 · 声明 · 回执"),
  },
];

const features = [
  {
    icon: ClipboardCheck,
    title: text("Proof receipts", "Proof receipts", "Proof receipts"),
    description: text(
      "See which files changed, which checks ran, and what is still uncertain — not just a confident summary.",
      "Какие файлы изменены, какие проверки выполнены и что осталось неясным — не просто уверенный отчёт.",
      "查看变更文件、已运行检查和仍不确定的事项，而不只是一个自信的总结。",
    ),
  },
  {
    icon: Database,
    title: text("Memory with sources", "Память с источниками", "带来源的记忆"),
    description: text(
      "Project facts keep their origin, verification time, and rules for when they become stale.",
      "У фактов есть источник, время проверки и правила, по которым они устаревают.",
      "项目事实保留来源、验证时间以及失效规则。",
    ),
  },
  {
    icon: History,
    title: text("Resumable sessions", "Сессии с продолжением", "可恢复的会话"),
    description: text(
      "Continue, rewind, or branch past work without losing the decisions that got you there.",
      "Продолжайте, откатывайте или ветвите работу, не теряя принятые решения.",
      "继续、回退或分支过往工作，同时保留完整决策过程。",
    ),
  },
  {
    icon: LockKeyhole,
    title: text("Explicit permissions", "Явные разрешения", "明确的权限"),
    description: text(
      "Risky operations show their scope and leave a receipt for the decision you made.",
      "Для рискованных операций видны область действия и запись о принятом решении.",
      "高风险操作会显示范围，并记录你做出的权限决定。",
    ),
  },
  {
    icon: Blocks,
    title: text("Skills you can evaluate", "Навыки с оценкой качества", "可评估的技能"),
    description: text(
      "Turn repeatable workflows into versioned Markdown skills with benchmarks and rollback.",
      "Превращайте повторяемые процессы в версионируемые Markdown-навыки с бенчмарками и откатом.",
      "将重复工作流变成可版本化的 Markdown 技能，支持基准测试和回滚。",
    ),
  },
  {
    icon: Network,
    title: text("MCP on your terms", "MCP на ваших условиях", "由你掌控的 MCP"),
    description: text(
      "Connect local or remote tools while keeping permissions and results visible in one place.",
      "Подключайте локальные и удалённые инструменты, сохраняя права и результаты на виду.",
      "连接本地或远程工具，同时集中查看权限和结果。",
    ),
  },
];

const releaseHighlights = [
  {
    icon: Terminal,
    title: text("Background processes", "Фоновые процессы", "后台进程"),
    description: text(
      "Start a dev server, watch its status, read logs, and stop it without blocking the rest of the session.",
      "Запускайте dev-сервер, следите за статусом, читайте логи и останавливайте процесс, не блокируя сессию.",
      "启动开发服务器、查看状态和日志或停止进程，无需阻塞当前会话。",
    ),
    meta: "process start · status · logs · stop",
  },
  {
    icon: FileCode2,
    title: text("Safer edits", "Безопасные правки", "更安全的修改"),
    description: text(
      "Preview diffs before writing, detect stale files, and require an explicit choice before overwriting work.",
      "Смотрите diff до записи, отслеживайте устаревшие файлы и явно подтверждайте перезапись своей работы.",
      "写入前预览差异、检测过期文件，并在覆盖工作成果前明确要求确认。",
    ),
    meta: "dryRun · stale check · overwrite guard",
  },
  {
    icon: ClipboardCheck,
    title: text("Evidence you can trace", "Доказательства с историей", "可追溯的证据"),
    description: text(
      "Hashed command logs and session baselines make verification results easier to audit and reproduce.",
      "Хэшированные логи команд и базовые состояния сессии упрощают аудит и воспроизведение результатов проверок.",
      "哈希命令日志和会话基线让验证结果更易于审计和复现。",
    ),
    meta: ".soba/evidence/logs/ · baselines",
  },
  {
    icon: CheckCircle2,
    title: text("Environment diagnostics", "Диагностика окружения", "环境诊断"),
    description: text(
      "Check required and optional capabilities before a task fails on a missing tool or provider.",
      "Проверяйте обязательные и дополнительные возможности окружения до того, как задача остановится из-за отсутствующего инструмента или провайдера.",
      "在任务因缺少工具或提供商而失败之前，检查必需和可选的环境能力。",
    ),
    meta: "soba doctor",
  },
];

export const Route = createFileRoute("/$lang/")({
  head: ({ params }) => {
    const seo = getLandingSeo(params.lang);
    const path = `/${params.lang}`;

    return {
      meta: [
        { title: seo.title },
        { name: "description", content: seo.description },
        { property: "og:locale", content: seo.locale },
        { property: "og:title", content: seo.title },
        { property: "og:description", content: seo.description },
        { property: "og:url", content: canonicalUrl(path) },
        { property: "og:image", content: previewImageUrl },
        { name: "twitter:title", content: seo.title },
        { name: "twitter:description", content: seo.description },
        { name: "twitter:image", content: previewImageUrl },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(path) }, ...alternateLanguageLinks()],
    };
  },
  component: Home,
});

function Home() {
  const { lang } = Route.useParams();
  const locale: Locale = lang === "ru" || lang === "zh" ? lang : "en";
  const t = (value: LocalizedText) => value[locale];

  return (
    <HomeLayout {...baseOptions(lang)}>
      <main className="landing-shell">
        <section className="hero-section">
          <div className="landing-container hero-layout">
            <div className="hero-copy">
              <Link
                to="/$lang/docs/$"
                params={{ lang, _splat: "changelog" }}
                className="release-link"
              >
                <span className="release-dot" aria-hidden />
                {t(copy.release)}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
              <h1>
                <span>{t(copy.headlineFirst)}</span>
                <span>{t(copy.headlineSecond)}</span>
              </h1>
              <p className="hero-lead">{t(copy.lead)}</p>
              <div className="hero-actions">
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: "quick-start" }}
                  className="landing-button landing-button-primary"
                >
                  {t(copy.primaryCta)}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link to="/$lang/docs/$" params={{ lang, _splat: "" }} className="landing-button landing-button-secondary">
                  {t(copy.secondaryCta)}
                </Link>
              </div>
              <div className="install-block">
                <span>{t(copy.installLabel)}</span>
                <code>
                  <span aria-hidden>$</span> npm install -g soba-agent
                </code>
              </div>
              <p className="open-source-note">
                <Check className="size-3.5" aria-hidden />
                {t(copy.openSource)}
              </p>
            </div>
          </div>
        </section>

        <section className="principles-band" aria-label={t(copy.principlesEyebrow)}>
          <div className="landing-container principles-grid">
            {principles.map((principle) => (
              <div key={principle.value} className="principle-item">
                <strong>{principle.value}</strong>
                <span>{t(principle.label)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section workflow-section">
          <div className="landing-container">
            <div className="section-heading section-heading-split">
              <div>
                <p className="landing-eyebrow">{t(copy.workflowEyebrow)}</p>
                <h2>{t(copy.workflowTitle)}</h2>
              </div>
              <p>{t(copy.workflowLead)}</p>
            </div>
            <div className="workflow-grid">
              {workflow.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.number} className="workflow-step">
                    <div className="workflow-step-top">
                      <span className="workflow-step-icon">
                        <Icon className="size-5" strokeWidth={1.7} aria-hidden />
                      </span>
                      <span className="workflow-step-number">{step.number}</span>
                    </div>
                    <h3>{t(step.title)}</h3>
                    <p>{t(step.description)}</p>
                    <span className="workflow-step-meta">{t(step.meta)}</span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section features-section">
          <div className="landing-container">
            <div className="section-heading section-heading-centered">
              <p className="landing-eyebrow">{t(copy.featuresEyebrow)}</p>
              <h2>{t(copy.featuresTitle)}</h2>
              <p>{t(copy.featuresLead)}</p>
            </div>
            <div className="features-grid">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title.en} className="feature-card">
                    <span className="feature-icon">
                      <Icon className="size-5" strokeWidth={1.7} aria-hidden />
                    </span>
                    <h3>{t(feature.title)}</h3>
                    <p>{t(feature.description)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section orbit-section">
          <div className="landing-container">
            <div className="section-heading section-heading-split">
              <div>
                <p className="landing-eyebrow">{t(copy.orbitEyebrow)}</p>
                <h2>{t(copy.orbitTitle)}</h2>
              </div>
              <p>{t(copy.orbitLead)}</p>
            </div>
            <div className="orbit-panel orbit-showcase">
              <div className="orbit-panel-bar">
                <span>SOBA / EXECUTION MAP</span>
                <span className="orbit-live">
                  <span aria-hidden />
                  LOCAL
                </span>
              </div>
              <SobaOrbitCanvas />
            </div>
          </div>
        </section>

        <section className="landing-section release-section">
          <div className="landing-container">
            <div className="section-heading section-heading-split release-heading">
              <div>
                <p className="landing-eyebrow">{t(copy.releaseEyebrow)}</p>
                <h2>{t(copy.releaseTitle)}</h2>
              </div>
              <div>
                <p>{t(copy.releaseLead)}</p>
                <Link to="/$lang/docs/$" params={{ lang, _splat: "changelog" }} className="text-link">
                  {t(copy.releaseLink)}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>
            <div className="release-grid">
              {releaseHighlights.map((highlight) => {
                const Icon = highlight.icon;
                return (
                  <article key={highlight.title.en} className="release-card">
                    <span className="release-card-icon">
                      <Icon className="size-5" strokeWidth={1.7} aria-hidden />
                    </span>
                    <div>
                      <h3>{t(highlight.title)}</h3>
                      <p>{t(highlight.description)}</p>
                      <code>{highlight.meta}</code>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section final-section">
          <div className="landing-container">
            <div className="final-panel">
              <div>
                <p className="landing-eyebrow">{t(copy.finalEyebrow)}</p>
                <h2>{t(copy.finalTitle)}</h2>
                <p>{t(copy.finalText)}</p>
              </div>
              <div className="final-actions">
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: "quick-start" }}
                  className="landing-button landing-button-primary"
                >
                  {t(copy.primaryCta)}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a
                  href="https://github.com/avacadorun-dev/soba-agent"
                  className="landing-button landing-button-secondary"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                  <ArrowUpRight className="size-4" aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-container landing-footer-inner">
            <p>
              <strong>SOBA Agent</strong>
              <span>{t(copy.footerTagline)}</span>
            </p>
            <div>
              <span>{APP_VERSION_LABEL}</span>
              <Link to="/$lang/roadmap" params={{ lang }}>
                {lang === "ru" ? "Дорожная карта" : lang === "zh" ? "路线图" : "Roadmap"}
              </Link>
              <a href="https://github.com/avacadorun-dev/soba-agent" target="_blank" rel="noreferrer">
                GitHub
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </footer>
      </main>
    </HomeLayout>
  );
}
