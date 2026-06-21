import { For, Match, Show, Switch } from "solid-js";
import { formatTokens, shortenPath } from "../lib/format-tool";
import { getTuiTheme } from "../lib/theme";
import type { ActivePane, SidebarMode } from "../model/types";
import type { TuiStore } from "../model/tui-store";
import { HelpMode } from "./help-mode";

// ─── BrandLogo — stylized SOBA AGENT header ───

export const SIDEBAR_COMPACT_LOGO_MAX_WIDTH = 20;

export function shouldUseCompactSidebarLogo(width: number): boolean {
  return width <= SIDEBAR_COMPACT_LOGO_MAX_WIDTH;
}

/** Compact colored "SOBA Agent" for narrow sidebar (width <= 20). */
function CompactLogo(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());

  return (
    <text wrapMode="none" truncate>
      <span style={{ fg: theme().primary, bold: true }}>S</span>
      <span style={{ fg: theme().secondary, bold: true }}>O</span>
      <span style={{ fg: theme().success, bold: true }}>B</span>
      <span style={{ fg: theme().warning, bold: true }}>A</span>
      <span style={{ fg: theme().muted, bold: true }}> Agent</span>
    </text>
  );
}

function FullLogo(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());

  return (
    <>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>
          ╔═══════════════════════╗
        </span>
      </text>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>║{"   "}</span>
        <span style={{ fg: theme().primary, bold: true }}>
          {" "}
          █▀▀ █▀█ █▀▄ █▀█
        </span>
        <span style={{ fg: theme().primary, bold: true }}>{"    "}║</span>
      </text>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>║{"   "}</span>
        <span style={{ fg: theme().secondary, bold: true }}>
          {" "}
          ▀▀█ █ █ █▀▄ █▀█
        </span>
        <span style={{ fg: theme().primary, bold: true }}>{"    "}║</span>
      </text>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>║{"   "}</span>
        <span style={{ fg: theme().primary, bold: true }}>
          {" "}
          ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀
        </span>
        <span style={{ fg: theme().primary, bold: true }}>{"    "}║</span>
      </text>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>║{"         "}</span>
        <span style={{ fg: theme().secondary, bold: true }}>AGENT</span>
        <span style={{ fg: theme().primary, bold: true }}>{"         "}║</span>
      </text>
      <text wrapMode="none" truncate>
        <span style={{ fg: theme().primary, bold: true }}>
          ╚═══════════════════════╝
        </span>
      </text>
    </>
  );
}

function BrandLogo(props: { store: TuiStore; width: number }) {
  return (
    <Show when={shouldUseCompactSidebarLogo(props.width)} fallback={<FullLogo store={props.store} />}>
      <CompactLogo store={props.store} />
    </Show>
  );
}

// ─── SidebarHeader — brand logo + mode ───

function SidebarHeader(props: { store: TuiStore; width: number }) {
  return (
    <>
      <box style={{ paddingLeft: 0 }}>
        <BrandLogo store={props.store} width={props.width} />
      </box>
      <ActivePaneLabel store={props.store} />
      <text> </text>
    </>
  );
}

const ACTIVE_PANE_KEYS: Record<
  ActivePane,
  {
    label: "tui.activePane.input" | "tui.activePane.output" | "tui.activePane.sidebar" | "tui.activePane.overlay";
    hint:
      | "tui.activePane.inputHint"
      | "tui.activePane.outputHint"
      | "tui.activePane.sidebarHint"
      | "tui.activePane.overlayHint";
  }
> = {
  input: { label: "tui.activePane.input", hint: "tui.activePane.inputHint" },
  output: { label: "tui.activePane.output", hint: "tui.activePane.outputHint" },
  sidebar: { label: "tui.activePane.sidebar", hint: "tui.activePane.sidebarHint" },
  overlay: { label: "tui.activePane.overlay", hint: "tui.activePane.overlayHint" },
};

function ActivePaneLabel(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const pane = () => ACTIVE_PANE_KEYS[props.store.activePane()];

  return (
    <>
      <text fg={theme().text} wrapMode="none" truncate>
        <span style={{ fg: theme().muted }}>{props.store.l("tui.activePane.title")} </span>
        <span style={{ fg: theme().secondary, bold: true }}>{props.store.l(pane().label)}</span>
      </text>
      <text fg={theme().dim} wrapMode="none" truncate>
        {props.store.l(pane().hint)}
      </text>
    </>
  );
}

// ─── ModeLabel — current mode indicator ───

const MODE_LABELS: Record<SidebarMode, string> = {
  session: "Session",
  changes: "Changes",
  files: "Files",
  tools: "Tools",
  debug: "Debug",
  help: "Help",
};

function ModeLabel(props: { mode: SidebarMode; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <text fg={theme().primary} wrapMode="none" truncate>
      <b>[ {MODE_LABELS[props.mode]} ]</b>
    </text>
  );
}

// ─── Section title ───

function Section(props: { label: string; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <text fg={theme().secondary} wrapMode="none" truncate>
      <b>{props.label.toUpperCase()}</b>
    </text>
  );
}

// ─── Key-value row ───

function KV(props: {
  key: string;
  value: string;
  store: TuiStore;
  indent?: number;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const pad = "".padStart(props.indent ?? 0);
  return (
    <text fg={theme().text} wrapMode="none" truncate>
      {pad}
      <span style={{ fg: theme().muted }}>{props.key.padEnd(10)}</span>
      {props.value}
    </text>
  );
}

// ─── Progress bar ───

export function getProgressBarSegments(percent: number, width = 10): { filled: number; empty: number; roundedPercent: number } {
  const safeWidth = Math.max(0, Math.floor(width));
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.min(safeWidth, Math.max(0, Math.round((safePercent / 100) * safeWidth)));

  return {
    filled,
    empty: safeWidth - filled,
    roundedPercent: Math.round(safePercent),
  };
}

function ProgressBar(props: { percent: number; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const segments = () => getProgressBarSegments(props.percent);
  const fillColor = () =>
    props.percent >= 90
      ? theme().error
      : props.percent >= 70
        ? theme().warning
        : theme().success;

  return (
    <text fg={theme().text} wrapMode="none" truncate>
      <span
        style={{
          fg: fillColor(),
        }}
      >
        {"█".repeat(segments().filled)}
      </span>
      <span style={{ fg: theme().muted }}>{"░".repeat(segments().empty)}</span>{" "}
      {segments().roundedPercent}%
    </text>
  );
}

// ─── Mode: Session ───

function SessionMode(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const cwd = () => shortenPath(props.store.options.cwd, 22);
  const ctxTokens = () => {
    const effective = props.store.effectiveContextTokens();
    if (effective > 0) return effective;
    // Fall back to budget tokens if context meter hasn't reported yet
    return props.store.usedTokens();
  };
  const ctxWindow = () => props.store.options.contextWindow;
  const pct = () =>
    ctxWindow() > 0 ? Math.min(100, (ctxTokens() / ctxWindow()) * 100) : 0;

  return (
    <>
      <Section label="session" store={props.store} />
      <KV
        key="id"
        value={props.store.getSessionId().slice(0, 8)}
        store={props.store}
      />
      <KV
        key="format"
        value={props.store.getSessionFormat()}
        store={props.store}
      />
      <KV
        key="persist"
        value={props.store.isSessionPersisted() ? "yes" : "no (memory)"}
        store={props.store}
      />
      <text> </text>

      <Section label="model" store={props.store} />
      <KV key="model" value={props.store.model()} store={props.store} />
      <KV key="provider" value={props.store.providerName() || "default"} store={props.store} />
      <text> </text>

      <Section label="context" store={props.store} />
      <text fg={theme().text} wrapMode="none" truncate>
        {formatTokens(ctxTokens())} / {formatTokens(ctxWindow())}
      </text>
      <ProgressBar percent={pct()} store={props.store} />
      <text> </text>

      <Section label="workdir" store={props.store} />
      <text fg={theme().muted} wrapMode="none" truncate>
        {cwd()}
      </text>
      <KV
        key="trusted"
        value={props.store.projectTrusted() ? "yes" : "no"}
        store={props.store}
      />
      <text> </text>

      <Section label="perms" store={props.store} />
      <text fg={theme().text} wrapMode="none" truncate>
        {props.store.permissionMode()}
      </text>
      <text> </text>

      <Section label="limits" store={props.store} />
      <KV key="iter max" value={props.store.maxAgentIterations() > 0 ? `${props.store.maxAgentIterations()}` : "∞"} store={props.store} />
      <KV key="stall max" value={props.store.maxStalledIterations() > 0 ? `${props.store.maxStalledIterations()}` : "∞"} store={props.store} />
      <KV key="run max" value={props.store.maxRunMinutes() > 0 ? `${props.store.maxRunMinutes()}m` : "∞"} store={props.store} />
      <KV key="budget" value={props.store.options.tokenBudget > 0 ? formatTokens(props.store.options.tokenBudget) : "∞"} store={props.store} />
      <text> </text>

      <KV key="output tok" value={props.store.maxOutputTokens() > 0 ? formatTokens(props.store.maxOutputTokens()) : "model default"} store={props.store} />
      <KV key="comp tok" value={props.store.maxCompletionTokens() > 0 ? formatTokens(props.store.maxCompletionTokens()) : "model default"} store={props.store} />
      <text> </text>

      <KV key="compact" value={props.store.autoCompact() ? "auto" : "manual"} store={props.store} />
      <KV key="debug" value={props.store.debug() ? "on" : "off"} store={props.store} />
    </>
  );
}

// ─── Mode: Changes ───

function ChangesMode(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const changes = () => props.store.changes();

  return (
    <>
      <Section label="changes" store={props.store} />
      <Show
        when={changes().length > 0}
        fallback={<text fg={theme().muted}>No changes</text>}
      >
        <For each={changes()}>
          {(change) => (
            <text>
              <span style={{ fg: theme().warning }}>M </span>
              <span style={{ fg: theme().muted }}>
                {shortenPath(change.path, 20)}
              </span>
              <span style={{ fg: theme().success }}> +{change.added}</span>
              <span style={{ fg: theme().error }}> -{change.removed}</span>
            </text>
          )}
        </For>
      </Show>
    </>
  );
}

// ─── Mode: Files ───

function FilesMode(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const files = () => props.store.fileTree();
  const changes = () => props.store.changes();

  return (
    <>
      <Section label="recent" store={props.store} />
      <Show
        when={files().length > 0}
        fallback={<text fg={theme().muted}>No recent files</text>}
      >
        <For each={files().slice(0, 8)}>
          {(file) => (
            <text fg={theme().muted} wrapMode="none" truncate>
              ● {shortenPath(file, 22)}
            </text>
          )}
        </For>
      </Show>

      <Show when={changes().length > 0}>
        <text> </text>
        <Section label="changed" store={props.store} />
        <For each={changes()}>
          {(change) => (
            <text fg={theme().warning} wrapMode="none" truncate>
              M {shortenPath(change.path, 22)}
            </text>
          )}
        </For>
      </Show>
    </>
  );
}

// ─── Mode: Tools ───

function ToolsMode(props: { store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const toolNames = () => props.store.options.toolNames;

  return (
    <>
      <Section label={`tools ${toolNames().length}`} store={props.store} />
      <For each={toolNames()}>
        {(tool) => (
          <text fg={theme().muted} wrapMode="none" truncate>
            ● {tool === "activate_skill" ? "skill" : tool}
          </text>
        )}
      </For>
      <text> </text>

      <Section label="permissions" store={props.store} />
      <KV key="mode" value={props.store.permissionMode()} store={props.store} />
      <KV
        key="trusted"
        value={props.store.projectTrusted() ? "yes" : "no"}
        store={props.store}
      />
      <text> </text>

      <Section label="model" store={props.store} />
      <text fg={theme().muted} wrapMode="none" truncate>
        {props.store.model()}
      </text>
    </>
  );
}

// ─── Mode: Debug ───

function DebugMode(props: { store: TuiStore }) {
  const effTokens = () => {
    const effective = props.store.effectiveContextTokens();
    if (effective > 0) return effective;
    return props.store.usedTokens();
  };
  const debugInfo = () => props.store.getContextDebugInfo();

  return (
    <>
      <Section label="ctx manager" store={props.store} />
      <KV key="effective" value={formatTokens(effTokens())} store={props.store} />
      <KV
        key="hard limit"
        value={debugInfo() ? formatTokens(debugInfo()!.hardLimit) : "—"}
        store={props.store}
      />
      <KV key="source" value={debugInfo()?.source ?? "—"} store={props.store} />
      <text> </text>

      <Section label="reserves" store={props.store} />
      <KV
        key="safety"
        value={
          debugInfo() ? formatTokens(debugInfo()!.safetyReserveTokens) : "—"
        }
        store={props.store}
      />
      <KV
        key="output"
        value={debugInfo() ? formatTokens(debugInfo()!.maxOutputTokens) : "—"}
        store={props.store}
      />
    </>
  );
}

// ─── Main Sidebar ───

export function Sidebar(props: { store: TuiStore; width: number }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const mode = () => props.store.sidebarMode();

  return (
    <scrollbox
      style={{
        width: props.width,
        height: "100%",
        flexShrink: 0,
        rootOptions: {
          border: ["right"],
          borderColor: theme().border,
          backgroundColor: theme().panel,
        },
        contentOptions: { paddingLeft: 1, paddingRight: 1 },
        scrollbarOptions: { showArrows: false },
      }}
    >
      <SidebarHeader store={props.store} width={props.width} />
      <ModeLabel mode={mode()} store={props.store} />
      <text> </text>

      <Switch>
        <Match when={mode() === "session"}>
          <SessionMode store={props.store} />
        </Match>
        <Match when={mode() === "changes"}>
          <ChangesMode store={props.store} />
        </Match>
        <Match when={mode() === "files"}>
          <FilesMode store={props.store} />
        </Match>
        <Match when={mode() === "tools"}>
          <ToolsMode store={props.store} />
        </Match>
        <Match when={mode() === "debug"}>
          <DebugMode store={props.store} />
        </Match>
        <Match when={mode() === "help"}>
          <HelpMode store={props.store} />
        </Match>
      </Switch>
    </scrollbox>
  );
}
