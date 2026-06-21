import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
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

const features = [
  {
    icon: Terminal,
    title: {
      en: "Cozy terminal TUI",
      ru: "Уютный консольный TUI",
      zh: "舒适的终端 TUI",
    },
    desc: {
      en: "Slash commands, hotkeys, and readable tool output right where you code.",
      ru: "Slash-команды, горячие клавиши и понятный вывод инструментов прямо рядом с кодом.",
      zh: "斜杠命令、热键和清晰的工具输出，都在你写代码的地方。",
    },
  },
  {
    icon: GitBranch,
    title: {
      en: "Sessions that remember",
      ru: "Сессии, которые помнят",
      zh: "会记住的会话",
    },
    desc: {
      en: "Continue, rewind, and inspect past turns without losing the thread.",
      ru: "Продолжайте, перематывайте и смотрите прошлые ходы без потери нити.",
      zh: "继续、回退、查看过去的回合，不丢上下文。",
    },
  },
  {
    icon: BrainCircuit,
    title: {
      en: "Context that stays tidy",
      ru: "Контекст в порядке",
      zh: "保持整洁的上下文",
    },
    desc: {
      en: "Capsules keep decisions, files, and next steps compact enough for long work.",
      ru: "Капсулы аккуратно держат решения, файлы и следующие шаги для длинной работы.",
      zh: "胶囊保存决策、文件和下一步，让长任务也清爽。",
    },
  },
  {
    icon: BrainCircuit,
    title: {
      en: "Project Memory",
      ru: "Project Memory",
      zh: "项目记忆",
    },
    desc: {
      en: "A small project notebook for architecture, conventions, and things the agent should not forget.",
      ru: "Небольшой блокнот проекта: архитектура, договорённости и всё, что агенту лучше не забывать.",
      zh: "一个小小的项目笔记本：架构、约定和代理不该忘的东西。",
    },
  },
  {
    icon: Network,
    title: {
      en: "MCP tools",
      ru: "MCP tools",
      zh: "MCP 工具",
    },
    desc: {
      en: "Connect stdio or Streamable HTTP MCP servers when the built-ins are not enough.",
      ru: "Подключайте stdio или Streamable HTTP MCP-серверы, когда встроенных инструментов не хватает.",
      zh: "内置工具不够时，可以接入 stdio 或 Streamable HTTP MCP 服务器。",
    },
  },
  {
    icon: LockKeyhole,
    title: {
      en: "Clear permissions",
      ru: "Понятные разрешения",
      zh: "清晰的权限",
    },
    desc: {
      en: "Read, edit, run, approve, or deny. Risky actions stay visible.",
      ru: "Читать, править, запускать, разрешать или отклонять. Рискованные действия видны сразу.",
      zh: "读取、编辑、运行、允许或拒绝。高风险操作会清楚显示。",
    },
  },
  {
    icon: Zap,
    title: {
      en: "Tiny reusable skills",
      ru: "Маленькие переиспользуемые skills",
      zh: "小巧可复用技能",
    },
    desc: {
      en: "Package project habits into Markdown skills and reuse them when the work repeats.",
      ru: "Собирайте привычки проекта в Markdown skills и возвращайтесь к ним, когда задача повторяется.",
      zh: "把项目习惯写成 Markdown 技能，需要时重复使用。",
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
      en: "English, Russian, and Chinese UI/docs, with quick switching in the TUI.",
      ru: "UI и документация на английском, русском и китайском, с быстрым переключением прямо в TUI.",
      zh: "英文、俄文和中文 UI/文档，可在 TUI 中快速切换。",
    },
  },
];

const workflow = [
  {
    icon: Network,
    title: { en: "Read", ru: "Читает", zh: "读取" },
    desc: {
      en: "Looks at code, docs, memory, and session context first.",
      ru: "Сначала смотрит код, документацию, memory и контекст сессии.",
      zh: "先看代码、文档、记忆和会话上下文。",
    },
  },
  {
    icon: Workflow,
    title: { en: "Do", ru: "Делает", zh: "执行" },
    desc: {
      en: "Uses built-in tools, shell shortcuts, skills, and MCP.",
      ru: "Использует встроенные инструменты, быстрые shell-команды, skills и MCP.",
      zh: "使用内置工具、shell 快捷方式、技能和 MCP。",
    },
  },
  {
    icon: Shield,
    title: { en: "Check", ru: "Проверяет", zh: "检查" },
    desc: {
      en: "Runs the project checks and leaves the result in the session.",
      ru: "Запускает проверки проекта и оставляет результат в сессии.",
      zh: "运行项目检查，并把结果留在会话里。",
    },
  },
];

const copy = {
  badge: {
    en: "SOBA Agent v0.4.1 · cute terminal coding agent",
    ru: "SOBA Agent v0.4.1 · маленький консольный помощник для кода",
    zh: "SOBA Agent v0.4.1 · 可爱的终端编码代理",
  },
  headlineA: { en: "A tiny coding agent", ru: "Маленький помощник для кода", zh: "一个小小的编码代理" },
  headlineB: { en: "that remembers", ru: "который помнит", zh: "会记住事情" },
  lead: {
    en: "SOBA helps with coding from the terminal. It remembers project notes, connects MCP tools over stdio or Streamable HTTP, keeps sessions tidy, and asks before risky moves.",
    ru: "SOBA помогает спокойно работать с кодом из консоли. Она помнит заметки проекта, подключает MCP-инструменты через stdio или Streamable HTTP, держит сессии в порядке и спрашивает перед рискованными действиями.",
    zh: "SOBA 在终端里帮你写代码。它记住项目笔记，通过 stdio 或 Streamable HTTP 连接 MCP 工具，整理会话，并在高风险操作前询问。",
  },
  primaryCta: { en: "Read the docs", ru: "Читать доки", zh: "阅读文档" },
  secondaryCta: { en: "Quick start", ru: "Быстрый старт", zh: "快速入门" },
  roadmapCta: { en: "Roadmap", ru: "Дорожная карта", zh: "路线图" },
  proof: {
    en: ["Project Memory", "MCP tools", "Friendly TUI", "Long sessions"],
    ru: ["Память проекта", "MCP-инструменты", "Уютный TUI", "Длинные сессии"],
    zh: ["项目记忆", "MCP 工具", "友好的 TUI", "长会话"],
  },
  orbitEyebrow: { en: "How it fits", ru: "Как всё связано", zh: "如何组合" },
  orbitTitle: {
    en: "One small core. Lots of helpful orbits.",
    ru: "Одно маленькое ядро. Вокруг него - всё нужное.",
    zh: "一个小核心，许多有用的小轨道。",
  },
  orbitText: {
    en: "Memory, MCP, tools, sessions, capsules, and skills stay close to the agent core.",
    ru: "Память проекта, MCP, инструменты, сессии, capsules и skills держатся рядом с ядром агента.",
    zh: "记忆、MCP、工具、会话、胶囊和技能围绕代理核心。",
  },
  architectureInput: {
    en: "prompt · files · session · memory · MCP",
    ru: "запрос · файлы · сессия · память · MCP",
    zh: "提示 · 文件 · 会话 · 记忆 · MCP",
  },
  architectureInputLabel: {
    en: "input",
    ru: "на входе",
    zh: "输入",
  },
  architectureOutput: {
    en: "patches · verification · memory updates · session checkpoint",
    ru: "правки · проверки · обновления памяти · checkpoint сессии",
    zh: "补丁 · 验证 · 记忆更新 · 会话检查点",
  },
  architectureOutputLabel: {
    en: "output",
    ru: "на выходе",
    zh: "输出",
  },
  featuresTitle: {
    en: "Small pieces that help a lot",
    ru: "Маленькие вещи, которые помогают каждый день",
    zh: "小组件，大帮助",
  },
  featuresEyebrow: {
    en: "SOBA capabilities",
    ru: "Что умеет SOBA",
    zh: "SOBA 能力",
  },
  workflowTitle: {
    en: "Read. Do. Check.",
    ru: "Прочитал. Сделал. Проверил.",
    zh: "读取。执行。检查。",
  },
  terminalEyebrow: {
    en: "TUI preview",
    ru: "Как это выглядит",
    zh: "TUI 预览",
  },
  terminalTitle: {
    en: "Still just your terminal",
    ru: "Всё ещё просто ваша консоль",
    zh: "仍然只是你的终端",
  },
  terminalText: {
    en: "Commands, tool output, compacted context, language switching, and checks stay visible in one calm place.",
    ru: "Команды, вывод инструментов, сжатый контекст, язык и проверки остаются в одном спокойном месте.",
    zh: "命令、工具输出、压缩上下文、语言切换和检查都在一个安静的地方。",
  },
};

const stats = [
  { value: "JSONL", label: { en: "Durable sessions", ru: "Долговечные сессии", zh: "持久会话" } },
  { value: "Memory", label: { en: "Project knowledge", ru: "Знания проекта", zh: "项目知识" } },
  { value: "MCP", label: { en: "stdio + remote tools", ru: "stdio + remote tools", zh: "stdio + remote 工具" } },
  { value: "Safe", label: { en: "Ask before risky", ru: "Спросит перед риском", zh: "高风险前会询问" } },
];

export const Route = createFileRoute("/$lang/")({
  component: Home,
});

function Home() {
  const { lang } = Route.useParams();
  const t = (obj: Record<string, string>) => obj[lang] ?? obj.en;
  const localizedProof = copy.proof[lang as keyof typeof copy.proof] ?? copy.proof.en;

  return (
    <HomeLayout {...baseOptions(lang)}>
      <main className="landing-shell">
        <section className="hero-section">
          <div className="hero-bg" aria-hidden />
          <div className="hero-grid mx-auto grid max-w-7xl items-center gap-10 px-6 py-20 sm:py-24 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-28">
            <div className="hero-copy">
              <div className="hero-badge">
                <Sparkles className="size-3.5" />
                <span>{t(copy.badge)}</span>
              </div>
              <h1 className="mt-7 text-5xl font-bold tracking-[-0.045em] text-fd-foreground sm:text-7xl lg:text-8xl">
                {t(copy.headlineA)} <span>{t(copy.headlineB)}</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fd-muted-foreground sm:text-xl">{t(copy.lead)}</p>

              <div className="mt-9 flex flex-wrap items-center gap-4">
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
              </div>

              <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                {localizedProof.map((item) => (
                  <div key={item} className="proof-pill">
                    <CheckCircle2 className="size-4" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-visual-card">
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

        <section className="border-y border-fd-border bg-fd-muted/20 py-8">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-6 lg:grid-cols-4 lg:px-8">
            {stats.map((stat) => (
              <div key={stat.label.en} className="stat-card">
                <div className="text-2xl font-bold text-fd-foreground sm:text-3xl">{stat.value}</div>
                <div className="mt-1 text-sm text-fd-muted-foreground">{t(stat.label)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
            <div className="section-heading lg:sticky lg:top-24 lg:self-start">
              <p className="eyebrow">{t(copy.orbitEyebrow)}</p>
              <h2>{t(copy.orbitTitle)}</h2>
              <p>{t(copy.orbitText)}</p>
            </div>
            <div className="architecture-panel">
              <div className="architecture-row">
                <span>{t(copy.architectureInputLabel)}</span>
                <strong>{t(copy.architectureInput)}</strong>
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
              <p className="eyebrow">{t(copy.featuresEyebrow)}</p>
              <h2>{t(copy.featuresTitle)}</h2>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title.en} className="feature-card landing-feature-card">
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
              <p className="eyebrow">{t(copy.terminalEyebrow)}</p>
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
              SOBA Agent v0.4.1 —{" "}
              {lang === "ru"
                ? "консольный помощник для разработки"
                : lang === "zh"
                  ? "终端 AI 编码助手"
                  : "terminal AI coding assistant"}
            </p>
            <Link to="/$lang/docs/$" params={{ lang, _splat: "" }} className="footer-link">
              {t(copy.primaryCta)}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </footer>
      </main>
    </HomeLayout>
  );
}
