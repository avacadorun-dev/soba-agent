import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  GitBranch,
  Languages,
  LockKeyhole,
  Network,
  Shield,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";
import { SobaOrbitCanvas } from "@/components/soba-orbit-canvas";
import { TerminalCanvas } from "@/components/terminal-canvas";
import { baseOptions } from "@/lib/layout.shared";
import { alternateLanguageLinks, canonicalUrl, getLandingSeo, previewImageUrl } from "@/lib/seo";
import { APP_VERSION_LABEL } from "@/lib/version";

const features = [
  {
    icon: ClipboardCheck,
    title: {
      en: "Evidence-first finishes",
      ru: "Финиш с доказательствами",
      zh: "证据优先的完成状态",
    },
    desc: {
      en: "Proof receipts map changed files, checks, claims, risks, and permissions to the final answer.",
      ru: "Proof receipts связывают изменённые файлы, проверки, claims, риски и разрешения с финальным ответом.",
      zh: "Proof receipts 会把变更文件、检查、声明、风险和权限映射到最终回答。",
    },
  },
  {
    icon: GitBranch,
    title: {
      en: "Session time machine",
      ru: "Сессии как time machine",
      zh: "会话时间机器",
    },
    desc: {
      en: "Continue, rewind, branch, and inspect past turns without losing the work trail.",
      ru: "Можно продолжить, откатиться, ветвиться и смотреть прошлые turn'ы без потери следа работы.",
      zh: "继续、回退、分支并查看过去回合，同时保留工作轨迹。",
    },
  },
  {
    icon: BrainCircuit,
    title: {
      en: "Portable handoff capsules",
      ru: "Portable handoff capsules",
      zh: "可移植交接胶囊",
    },
    desc: {
      en: "Capsules keep goals, decisions, files, risks, and next steps compact enough to resume elsewhere.",
      ru: "Капсулы держат цель, решения, файлы, риски и следующие шаги так, чтобы задачу можно было продолжить.",
      zh: "胶囊保存目标、决策、文件、风险和下一步，方便在别处继续。",
    },
  },
  {
    icon: BrainCircuit,
    title: {
      en: "Memory with provenance",
      ru: "Память с provenance",
      zh: "带来源的项目记忆",
    },
    desc: {
      en: "Project facts can carry source files, verification time, confidence, and stale-if-changed rules.",
      ru: "Факты проекта получают source files, время проверки, confidence и правила устаревания.",
      zh: "项目事实可以带有源文件、验证时间、置信度和变更即过期规则。",
    },
  },
  {
    icon: Network,
    title: {
      en: "MCP without losing control",
      ru: "MCP без потери контроля",
      zh: "可控的 MCP 工具",
    },
    desc: {
      en: "Connect stdio or Streamable HTTP servers while SOBA keeps permissions and tool results visible.",
      ru: "Подключайте stdio или Streamable HTTP servers, а SOBA оставит права и результаты инструментов видимыми.",
      zh: "接入 stdio 或 Streamable HTTP 服务，同时保持权限和工具结果可见。",
    },
  },
  {
    icon: LockKeyhole,
    title: {
      en: "Permission receipts",
      ru: "Permission receipts",
      zh: "权限回执",
    },
    desc: {
      en: "Risky operations show scope, alternatives, and the decision that allowed or denied them.",
      ru: "Рискованные операции показывают scope, альтернативы и решение, которым их разрешили или запретили.",
      zh: "高风险操作会显示范围、替代方案以及允许或拒绝的决定。",
    },
  },
  {
    icon: Zap,
    title: {
      en: "Skill evolution lab",
      ru: "Skill evolution lab",
      zh: "技能演进实验室",
    },
    desc: {
      en: "Markdown skills have evals, bench, trace, revision history, promotion, and rollback.",
      ru: "Markdown skills получают eval, bench, trace, историю версий, promote и rollback.",
      zh: "Markdown 技能支持 eval、bench、trace、版本历史、promote 和 rollback。",
    },
  },
  {
    icon: Languages,
    title: {
      en: "Three languages",
      ru: "Три языка",
      zh: "三种语言",
    },
    desc: {
      en: "English, Russian, and Chinese UI/docs, with release messaging kept aligned.",
      ru: "Интерфейс и документация на английском, русском и китайском языках, с синхронным release message.",
      zh: "英文、俄文和中文 UI/文档，并保持发布信息一致。",
    },
  },
];

const workflow = [
  {
    icon: Network,
    title: { en: "Read", ru: "Читает", zh: "读取" },
    desc: {
      en: "Looks at code, docs, session state, memory receipts, and MCP context first.",
      ru: "Сначала смотрит код, документацию, состояние сессии, memory receipts и MCP context.",
      zh: "先查看代码、文档、会话状态、记忆回执和 MCP 上下文。",
    },
  },
  {
    icon: Workflow,
    title: { en: "Do", ru: "Делает", zh: "执行" },
    desc: {
      en: "Edits through bounded tools, skills, shell checks, and MCP integrations.",
      ru: "Правит через ограниченные tools, skills, shell checks и MCP integrations.",
      zh: "通过有边界的工具、技能、shell 检查和 MCP 集成执行。",
    },
  },
  {
    icon: Shield,
    title: { en: "Prove", ru: "Доказывает", zh: "证明" },
    desc: {
      en: "Maps checks, claims, risks, and permissions into a visible proof trail.",
      ru: "Связывает проверки, claims, риски и разрешения в понятный отчёт с доказательствами.",
      zh: "把检查、声明、风险和权限映射成可见证据链。",
    },
  },
];

const copy = {
  badge: {
    en: `SOBA Agent ${APP_VERSION_LABEL} · local-first engineering agent`,
    ru: `SOBA Agent ${APP_VERSION_LABEL} · local-first инженерный агент`,
    zh: `SOBA Agent ${APP_VERSION_LABEL} · local-first 工程代理`,
  },
  headlineLines: {
    en: ["The coding agent", "that leaves receipts"],
    ru: ["SOBA", "агент для", "разработки"],
    zh: ["编码代理", "会留下证据"],
  },
  lead: {
    en: "SOBA is a local-first engineering agent for teams that want more than code edits. It remembers the project, works inside bounded tool loops, verifies outcomes, and turns work into evidence.",
    ru: "SOBA — local-first инженерный агент для работы, где важны не только правки кода. Он помнит проект, работает в ограниченных tool loops, проверяет результат и сохраняет подтверждения того, что сделал.",
    zh: "SOBA 是 local-first 工程代理，不只是改代码。它记住项目，在有边界的工具循环中工作，验证结果，并把工作转成证据。",
  },
  primaryCta: { en: "Read the docs", ru: "Документы", zh: "阅读文档" },
  secondaryCta: { en: "Quick start", ru: "Быстрый старт", zh: "快速入门" },
  githubCta: { en: "GitHub", ru: "GitHub", zh: "GitHub" },
  roadmapCta: { en: "Roadmap", ru: "Дорожная карта", zh: "路线图" },
  proof: {
    en: ["Proof receipts", "Memory provenance", "Permission receipts", "Skill bench"],
    ru: ["Proof receipts", "Memory provenance", "Permission receipts", "Skill bench"],
    zh: ["Proof receipts", "Memory provenance", "Permission receipts", "Skill bench"],
  },
  orbitEyebrow: { en: "Execution model", ru: "Модель работы", zh: "执行模型" },
  orbitTitle: {
    en: "Local control, visible proof, repeatable habits.",
    ru: "Локальный контроль, видимый proof, повторяемые привычки.",
    zh: "本地控制、可见证据、可重复习惯。",
  },
  orbitText: {
    en: "SOBA keeps memory, tools, MCP, skills, sessions, capsules, and proof receipts in the same local workflow.",
    ru: "SOBA держит memory, tools, MCP, skills, sessions, capsules и proof receipts в одном локальном workflow.",
    zh: "SOBA 把记忆、工具、MCP、技能、会话、胶囊和 proof receipts 放在同一个本地工作流。",
  },
  architectureInput: {
    en: "task · files · session · memory receipts · MCP",
    ru: "задача · файлы · сессия · memory receipts · MCP",
    zh: "任务 · 文件 · 会话 · 记忆回执 · MCP",
  },
  architectureInputLabel: {
    en: "input",
    ru: "на входе",
    zh: "输入",
  },
  architectureOutput: {
    en: "patches · checks · claims · risks · proof receipts",
    ru: "правки · проверки · claims · риски · proof receipts",
    zh: "补丁 · 检查 · 声明 · 风险 · proof receipts",
  },
  architectureOutputLabel: {
    en: "output",
    ru: "на выходе",
    zh: "输出",
  },
  featuresTitle: {
    en: "What makes SOBA different",
    ru: "Чем SOBA отличается",
    zh: "SOBA 的不同之处",
  },
  workflowTitle: {
    en: "Read. Do. Prove.",
    ru: "Прочитал. Сделал. Доказал.",
    zh: "读取。执行。证明。",
  },
  terminalEyebrow: {
    en: "TUI preview",
    ru: "Интерфейс",
    zh: "TUI 预览",
  },
  terminalTitle: {
    en: "A terminal surface for verifiable work",
    ru: "Терминал для проверяемой работы",
    zh: "用于可验证工作的终端界面",
  },
  terminalText: {
    en: "Use one-shot prompts for small tasks or the TUI for long work. Slash commands, model switching, proof summaries, memory, permissions, and MCP status stay visible.",
    ru: "Для коротких задач есть one-shot, для длинных — TUI. Slash-команды, выбор модели, proof summaries, memory, permissions и MCP status остаются видимыми.",
    zh: "小任务用 one-shot，长任务用 TUI。斜杠命令、模型切换、proof summaries、记忆、权限和 MCP 状态保持可见。",
  },
};

const stats = [
  { value: "Proof", label: { en: "Claim-mapped evidence", ru: "Доказательства для claims", zh: "声明映射证据" } },
  { value: "Memory", label: { en: "Provenance + staleness", ru: "Provenance + staleness", zh: "来源 + 过期检测" } },
  { value: "MCP", label: { en: "stdio + remote tools", ru: "stdio + remote tools", zh: "stdio + remote 工具" } },
  { value: "Local", label: { en: "Bounded permissions", ru: "Ограниченные права", zh: "有边界的权限" } },
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
  const t = (obj: Record<string, string>) => obj[lang] ?? obj.en;
  const localizedHeadlineLines = copy.headlineLines[lang as keyof typeof copy.headlineLines] ?? copy.headlineLines.en;
  const localizedProof = copy.proof[lang as keyof typeof copy.proof] ?? copy.proof.en;

  return (
    <HomeLayout {...baseOptions(lang)}>
      <main className="landing-shell">
        <section className="hero-section">
          <div className="hero-bg" aria-hidden />
          <div className="hero-coordinate hero-coordinate-side" aria-hidden>
            LOCAL / VERIFIABLE / OPEN
          </div>
          <div className="hero-grid mx-auto grid items-start px-6 lg:px-8">
            <div className="hero-copy">
              <div className="hero-badge">
                <Sparkles className="size-3.5" />
                <span>{t(copy.badge)}</span>
              </div>
              <h1
                className="mt-6 text-5xl font-bold tracking-[-0.045em] text-fd-foreground sm:text-7xl lg:text-[4.25rem] lg:leading-[4.5rem]"
                aria-label={localizedHeadlineLines.join(" ")}
              >
                {localizedHeadlineLines.map((line, index) => (
                  <span
                    key={line}
                    className={index === 0 ? "headline-line" : "headline-line headline-accent"}
                    aria-hidden="true"
                  >
                    {line}
                  </span>
                ))}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-fd-muted-foreground sm:text-xl">{t(copy.lead)}</p>

              <div className="hero-actions mt-8 flex flex-wrap items-center gap-4">
                <Link to="/$lang/docs/$" params={{ lang, _splat: "" }} className="hero-cta hero-cta-primary">
                  {t(copy.primaryCta)}
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: "quick-start" }}
                  className="hero-cta hero-cta-secondary"
                >
                  {t(copy.secondaryCta)}
                </Link>
                <Link to="/$lang/roadmap" params={{ lang }} className="hero-cta hero-cta-secondary">
                  {t(copy.roadmapCta)}
                </Link>
                <a
                  href="https://github.com/avacadorun-dev/soba-agent"
                  className="hero-cta hero-cta-secondary"
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitBranch className="size-4" />
                  {t(copy.githubCta)}
                </a>
              </div>

              <div className="hero-proof-ledger mt-6 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                {localizedProof.map((item, index) => (
                  <div key={item} className="proof-pill">
                    <span className="proof-index">0{index + 1}</span>
                    <span>{item}</span>
                    <CheckCircle2 className="size-4" />
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-visual-card">
              <div className="hero-visual-header" aria-hidden>
                <span>SOBA / SYSTEM MAP</span>
                <span className="visual-live-dot">LIVE</span>
              </div>
              <SobaOrbitCanvas />
              <div className="hero-visual-caption">
                <span>OpenResponses</span>
                <span>•</span>
                <span>MCP</span>
                <span>•</span>
                <span>Memory</span>
                <span>•</span>
                <span>trust layer</span>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-band border-y border-fd-border bg-fd-muted/20 py-8">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-6 lg:grid-cols-4 lg:px-8">
            {stats.map((stat, index) => (
              <div key={stat.label.en} className="stat-card">
                <span className="stat-index">0{index + 1}</span>
                <div className="text-2xl font-bold text-fd-foreground sm:text-3xl">{stat.value}</div>
                <div className="mt-1 text-sm text-fd-muted-foreground">{t(stat.label)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
            <div className="section-heading lg:sticky lg:top-24 lg:self-start">
              <p className="eyebrow"><span>01</span>{t(copy.orbitEyebrow)}</p>
              <h2>{t(copy.orbitTitle)}</h2>
              <p>{t(copy.orbitText)}</p>
            </div>
            <div className="architecture-panel">
              <div className="architecture-row">
                <span>{t(copy.architectureInputLabel)}</span>
                <strong>{t(copy.architectureInput)}</strong>
              </div>
              <div className="architecture-core-row">
                <div className="architecture-agent-core">
                  <img src="/brand/soba-mascot-alpha.png" alt="" aria-hidden />
                </div>
                <div className="architecture-flow">
                  {workflow.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title.en} className="workflow-card">
                        <div className="workflow-icon">
                          <Icon className="size-5" />
                        </div>
                        <h3>{t(item.title)}</h3>
                        <p>{t(item.desc)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="architecture-row">
                <span>{t(copy.architectureOutputLabel)}</span>
                <strong>{t(copy.architectureOutput)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="section-block border-t border-fd-border">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="section-heading mx-auto max-w-3xl text-center">
              <p className="eyebrow"><span>02</span>SOBA / DIFFERENCE</p>
              <h2>{t(copy.featuresTitle)}</h2>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title.en} className="feature-card landing-feature-card">
                    <span className="feature-number">{String(index + 1).padStart(2, "0")}</span>
                    <div className="feature-icon">
                      <Icon className="size-5" />
                    </div>
                    <h3>{t(feature.title)}</h3>
                    <p>{t(feature.desc)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section-block border-t border-fd-border">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
            <div className="section-heading">
              <p className="eyebrow"><span>03</span>{t(copy.terminalEyebrow)}</p>
              <h2>{t(copy.terminalTitle)}</h2>
              <p>{t(copy.terminalText)}</p>
              <div className="mt-8">
                <Link to="/$lang/docs/$" params={{ lang, _splat: "quick-start" }} className="hero-cta hero-cta-primary">
                  {t(copy.workflowTitle)}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
            <div className="terminal-showcase">
              <TerminalCanvas />
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 text-sm text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <p>
              SOBA Agent {APP_VERSION_LABEL} —{" "}
              {lang === "ru"
                ? "local-first агент для разработки"
                : lang === "zh"
                  ? "会留下证据的 local-first 工程代理"
                  : "local-first engineering agent that leaves receipts"}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="https://github.com/avacadorun-dev/soba-agent"
                className="footer-link"
                target="_blank"
                rel="noreferrer"
              >
                <GitBranch className="size-3.5" />
                {t(copy.githubCta)}
              </a>
              <Link to="/$lang/docs/$" params={{ lang, _splat: "" }} className="footer-link">
                {t(copy.primaryCta)}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </HomeLayout>
  );
}
