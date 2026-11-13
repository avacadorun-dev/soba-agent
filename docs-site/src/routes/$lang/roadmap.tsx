import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  CheckCircle2,
  Compass,
  Flag,
  FolderGit2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { baseOptions } from "@/lib/layout.shared";
import { APP_VERSION_LABEL } from "@/lib/version";

type Locale = "en" | "ru" | "zh";
type LocalizedText = Record<Locale, string>;

const text = (en: string, ru: string, zh: string): LocalizedText => ({ en, ru, zh });

const copy = {
  badge: text(`Roadmap · ${APP_VERSION_LABEL} released`, `Дорожная карта · ${APP_VERSION_LABEL} выпущена`, `路线图 · ${APP_VERSION_LABEL} 已发布`),
  title: text(
    "Evidence first. Autonomy when it earns it.",
    "Сначала доказательства. Автономность — по готовности.",
    "证据优先，自主运行水到渠成。",
  ),
  lead: text(
    "The path to 1.0 prioritizes proofs that people and CI can use, safe execution boundaries, and only then longer-running verified loops.",
    "На пути к 1.0 мы сначала создаём доказательства, полезные людям и CI, затем безопасные границы выполнения — и только потом длительные verified loops.",
    "通往 1.0 的路径优先考虑可供人员和 CI 使用的证据、安全的执行边界，然后才是长时间运行的验证循环。",
  ),
  primaryCta: text("Read the release notes", "Что нового в релизе", "查看发布说明"),
  backCta: text("Back to home", "На главную", "返回首页"),
  nowLabel: text("Current release", "Текущий релиз", "当前版本"),
  nowState: text("Released", "Выпущена", "已发布"),
  horizonEyebrow: text("The path to 1.0", "Дорога к 1.0", "通往 1.0 的路径"),
  horizonTitle: text("Build trust before delegation.", "Сначала доверие, потом делегирование.", "先建立信任，再进行委托。"),
  horizonLead: text(
    "Each stage makes results more verifiable before execution becomes more autonomous.",
    "Каждый этап сначала делает результаты проверяемее и только затем увеличивает автономность выполнения.",
    "每个阶段都先提高结果的可验证性，再逐步增强执行自主性。",
  ),
  principlesEyebrow: text("What stays constant", "Что остаётся неизменным", "始终不变的原则"),
  principlesTitle: text("The principles do not move with the versions.", "Принципы не меняются от версии к версии.", "原则不会随版本改变。"),
  footerEyebrow: text("The north star", "Главный ориентир", "北极星"),
  footerTitle: text("Verification and governance infrastructure for coding agents.", "Инфраструктура проверки и управления для coding agents.", "面向编码代理的验证与治理基础设施。"),
  footerText: text(
    "SOBA Agent is the local-first reference implementation. The trust contract should be useful beyond a single TUI, model, or vendor.",
    "SOBA Agent — local-first reference implementation. Trust contract должен быть полезен за пределами одного TUI, модели или вендора.",
    "SOBA Agent 是 local-first 参考实现。信任契约应适用于单一 TUI、模型或供应商之外。",
  ),
};

const stages = [
  {
    icon: CheckCircle2,
    status: "complete",
    release: "v0.6.x",
    state: text("Completed", "Завершено", "已完成"),
    title: text("Proof integrity & eval baseline", "Proof integrity и eval baseline", "证明完整性与评估基线"),
    intent: text(
      "Sealed proof contracts, adversarial false-completion fixtures, and real-model comparisons established the evidence foundation.",
      "Sealed proof contracts, adversarial false-completion fixtures и real-model сравнения заложили основу доказуемой работы.",
      "密封证明契约、对抗性错误完成测试和真实模型对比奠定了证据基础。",
    ),
    outcomes: [
      text("Versioned and sealed proof contract", "Versioned и sealed proof contract", "版本化且密封的证明契约"),
      text("Adversarial false-completion corpus", "Adversarial false-completion corpus", "对抗性错误完成语料库"),
      text("Repeatable real-model evaluations", "Повторяемые real-model evaluations", "可重复的真实模型评估"),
    ],
  },
  {
    icon: Wrench,
    status: "current",
    release: APP_VERSION_LABEL,
    state: text("Released", "Выпущена", "已发布"),
    title: text("Harness reliability", "Надёжность harness", "Harness 可靠性"),
    intent: text(
      "The current release strengthens the existing agent workflow without pretending that external proof contracts or unattended execution are already done.",
      "Текущий релиз укрепляет существующий workflow агента. Мы не выдаём external proof contracts и unattended execution за уже готовые возможности.",
      "当前版本强化了现有代理工作流，但不会把外部证明契约或无人值守执行说成已经完成。",
    ),
    outcomes: [
      text("Background process lifecycle", "Жизненный цикл фоновых процессов", "后台进程生命周期"),
      text("Verification baselines and hashed logs", "Verification baselines и хэшированные логи", "验证基线与哈希日志"),
      text("Safer edits and diff previews", "Безопасные правки и preview diff", "更安全的修改与差异预览"),
      text("Capability diagnostics with soba doctor", "Диагностика возможностей через soba doctor", "通过 soba doctor 诊断环境能力"),
    ],
  },
  {
    icon: Blocks,
    status: "planned",
    release: "Next",
    state: text("Planned", "Запланировано", "已规划"),
    title: text("Portable trust surface", "Portable trust surface", "可移植信任层"),
    intent: text(
      "The same versioned proof contract should work outside SOBA's own agent: through a public API, external run manifests, and generic CI without model credentials.",
      "Один versioned proof contract должен работать за пределами SOBA Agent: через public API, external run manifests и generic CI без model credentials.",
      "同一个版本化证明契约应在 SOBA 自有代理之外工作：通过公共 API、外部运行清单和无需模型凭据的通用 CI。",
    ),
    outcomes: [
      text("Public proof build/validate API", "Public proof build/validate API", "公共证明构建与验证 API"),
      text("External Run Manifest v1", "External Run Manifest v1", "External Run Manifest v1"),
      text("Headless CI proof gate", "Headless CI proof gate", "无头 CI 证明门禁"),
      text("One internal and external proof path", "Единый internal/external proof path", "统一的内部与外部证明路径"),
    ],
  },
  {
    icon: FolderGit2,
    status: "planned",
    release: "After that",
    state: text("Planned", "Запланировано", "已规划"),
    title: text("Safe workspace foundation", "Safe workspace foundation", "安全工作区基础"),
    intent: text(
      "Isolated worktrees, fail-closed policies, resource budgets, and durable run states make unattended execution bounded and recoverable.",
      "Изолированные worktrees, fail-closed policies, resource budgets и durable run states сделают unattended execution ограниченным и восстанавливаемым.",
      "隔离 worktree、失败即关闭的策略、资源预算和持久运行状态，让无人值守执行有边界且可恢复。",
    ),
    outcomes: [
      text("Workspace lifecycle and Git worktrees", "Workspace lifecycle и Git worktrees", "工作区生命周期与 Git worktree"),
      text("Non-interactive fail-closed policy", "Non-interactive fail-closed policy", "非交互式失败即关闭策略"),
      text("Budgets and crash-safe run state", "Budgets и crash-safe run state", "预算与崩溃安全的运行状态"),
      text("Redaction and isolation tests", "Redaction и isolation tests", "脱敏与隔离测试"),
    ],
  },
  {
    icon: RefreshCw,
    status: "conditional",
    release: "v0.8.x",
    state: text("Conditional", "После go/no-go", "条件阶段"),
    title: text("Minimal verified loop", "Minimal verified loop", "最小验证循环"),
    intent: text(
      "Only after the trust and workspace gates: fresh-context iterations repeat one bounded task until controller-owned deterministic gates accept it.",
      "Только после trust и workspace gates: fresh-context iterations повторяют одну bounded task до принятия controller-owned deterministic gates.",
      "只有在信任和工作区条件达标后：全新上下文迭代重复一个有边界的任务，直到控制器所有的确定性门禁接受。",
    ),
    outcomes: [
      text("Fresh session per iteration", "Новая сессия для каждой итерации", "每次迭代使用全新会话"),
      text("Controller-owned acceptance gates", "Controller-owned acceptance gates", "控制器所有的验收门禁"),
      text("Failure feedback and bounded retries", "Failure feedback и bounded retries", "失败反馈与有界重试"),
      text("Resume without duplicate work", "Resume без дублирования работы", "恢复运行而不重复工作"),
    ],
  },
  {
    icon: Flag,
    status: "planned",
    release: "v0.9 → 1.0",
    state: text("Stabilize", "Стабилизация", "稳定化"),
    title: text("Stable trust contract", "Stable trust contract", "稳定的信任契约"),
    intent: text(
      "Adoption hardening, compatibility, selected integrations, and reproducible release evaluations turn the trust promise into a stable 1.0 contract.",
      "Adoption hardening, compatibility, выбранные integrations и воспроизводимые release evaluations превратят trust promise в стабильный contract 1.0.",
      "采用强化、兼容性、精选集成和可重复的发布评估，将把信任承诺变成稳定的 1.0 契约。",
    ),
    outcomes: [
      text("Schema compatibility and migrations", "Schema compatibility и migrations", "模式兼容性与迁移"),
      text("Observed proof consumption in review or CI", "Подтверждённое использование proofs в review или CI", "在审查或 CI 中实际使用证明"),
      text("Selected integrations driven by usage", "Интеграции, выбранные по реальному использованию", "根据实际使用选择集成"),
      text("Documented capabilities and limitations", "Документированные возможности и ограничения", "记录能力与限制"),
    ],
  },
];

const currentStage = stages[1];

const principles = [
  {
    icon: ShieldCheck,
    title: text("Verify before confidence", "Сначала проверка, потом уверенность", "先验证，再确信"),
    text: text(
      "A green answer needs visible work, relevant checks, and evidence — or an honest unverified status.",
      "За ответом «готово» должны стоять изменения, релевантные проверки и доказательства — либо честный статус unverified.",
      "成功的回答需要可见的工作、相关检查和证据，否则必须明确标记为未验证。",
    ),
  },
  {
    icon: FolderGit2,
    title: text("Bounded by default", "Ограничения по умолчанию", "默认有边界"),
    text: text(
      "Permissions, workspaces, budgets, and typed terminal states constrain execution before background work expands.",
      "Permissions, workspaces, budgets и typed terminal states ограничивают выполнение до расширения фоновой работы.",
      "在扩展后台工作之前，权限、工作区、预算和明确的终态会约束执行。",
    ),
  },
  {
    icon: Compass,
    title: text("Adoption before autonomy", "Использование раньше автономности", "实际采用先于自主性"),
    text: text(
      "Longer loops come only after proofs are consumed in real review or CI workflows. Autonomy is not a goal in itself.",
      "Длинные loops появятся только после реального использования proofs в review или CI. Автономность — не самоцель.",
      "只有在证明真正用于审查或 CI 工作流后，才会引入更长的循环。自主性本身不是目标。",
    ),
  },
];

export const Route = createFileRoute("/$lang/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const { lang } = Route.useParams();
  const locale: Locale = lang === "ru" || lang === "zh" ? lang : "en";
  const t = (value: LocalizedText) => value[locale];

  return (
    <HomeLayout {...baseOptions(lang)}>
      <main className="landing-shell roadmap-shell">
        <section className="roadmap-hero">
          <div className="landing-container roadmap-hero-grid">
            <div className="roadmap-hero-copy">
              <Link to="/$lang" params={{ lang }} className="roadmap-back-link">
                <ArrowLeft className="size-4" aria-hidden />
                {t(copy.backCta)}
              </Link>
              <p className="landing-eyebrow">{t(copy.badge)}</p>
              <h1>{t(copy.title)}</h1>
              <p className="roadmap-hero-lead">{t(copy.lead)}</p>
              <div className="roadmap-actions">
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: "changelog" }}
                  className="landing-button landing-button-primary"
                >
                  {t(copy.primaryCta)}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>

            <aside className="roadmap-now-panel" aria-label={t(copy.nowLabel)}>
              <div className="roadmap-now-header">
                <span>{t(copy.nowLabel)}</span>
                <strong>{currentStage.release}</strong>
              </div>
              <div className="roadmap-now-body">
                <span className="roadmap-now-icon">
                  <Wrench className="size-5" aria-hidden />
                </span>
                <p className="roadmap-now-state">
                  <span aria-hidden />
                  {t(copy.nowState)}
                </p>
                <h2>{t(currentStage.title)}</h2>
                <p>{t(currentStage.intent)}</p>
              </div>
              <ul className="roadmap-now-list">
                {currentStage.outcomes.map((outcome) => (
                  <li key={outcome.en}>
                    <Check className="size-3.5" aria-hidden />
                    {t(outcome)}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        <section className="roadmap-section">
          <div className="landing-container">
            <div className="section-heading section-heading-split roadmap-section-heading">
              <div>
                <p className="landing-eyebrow">{t(copy.horizonEyebrow)}</p>
                <h2>{t(copy.horizonTitle)}</h2>
              </div>
              <p>{t(copy.horizonLead)}</p>
            </div>
            <div className="roadmap-timeline">
              {stages.map((stage) => {
                const Icon = stage.icon;

                return (
                  <article key={stage.release} className={`roadmap-stage roadmap-stage-${stage.status}`}>
                    <div className="roadmap-stage-release">
                      <strong>{stage.release}</strong>
                      <span>{t(stage.state)}</span>
                    </div>
                    <span className="roadmap-stage-icon">
                      <Icon className="size-5" strokeWidth={1.7} aria-hidden />
                    </span>
                    <div className="roadmap-stage-content">
                      <h3>{t(stage.title)}</h3>
                      <p>{t(stage.intent)}</p>
                      <ul className="roadmap-stage-outcomes">
                        {stage.outcomes.map((outcome) => (
                          <li key={outcome.en}>
                            <Check className="size-3.5" aria-hidden />
                            {t(outcome)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="roadmap-section roadmap-principles-section">
          <div className="landing-container">
            <div className="section-heading section-heading-centered">
              <p className="landing-eyebrow">{t(copy.principlesEyebrow)}</p>
              <h2>{t(copy.principlesTitle)}</h2>
            </div>
            <div className="roadmap-principles">
              {principles.map((principle) => {
                const Icon = principle.icon;

                return (
                  <article key={principle.title.en} className="roadmap-principle">
                    <span className="roadmap-principle-icon">
                      <Icon className="size-5" strokeWidth={1.7} aria-hidden />
                    </span>
                    <h3>{t(principle.title)}</h3>
                    <p>{t(principle.text)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="roadmap-footer-band">
          <div className="landing-container roadmap-footer-panel">
            <p className="landing-eyebrow">{t(copy.footerEyebrow)}</p>
            <h2>{t(copy.footerTitle)}</h2>
            <p>{t(copy.footerText)}</p>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
