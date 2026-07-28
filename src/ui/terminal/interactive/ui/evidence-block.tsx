import { Show, createMemo } from "solid-js";
import { toTuiEvidenceView, type TuiEvidenceItem } from "../lib/evidence-summary";
import { BLOCK } from "../lib/message-blocks";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";
import type { TuiMessage } from "../model/types";

type EvidenceMessage = Extract<TuiMessage, { type: "evidence" }>;

function EvidenceSection(props: {
  title: string;
  items: TuiEvidenceItem[];
  store: TuiStore;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <Show when={props.items.length > 0}>
      <box style={{ flexDirection: "column", gap: BLOCK.gap }}>
        <text fg={theme().muted} wrapMode="none">
          {props.title}
        </text>
        {props.items.map((item) => (
          <text fg={itemColor(item.status, props.store)} wrapMode="word">
            {"  "}
            {statusIcon(item.status)}
            {" "}
            {item.text}
            <Show when={item.status}>
              <span style={{ fg: theme().dim }}> · {statusLabel(item.status!, props.store)}</span>
            </Show>
          </text>
        ))}
      </box>
    </Show>
  );
}

export function EvidenceBlock(props: {
  message: EvidenceMessage;
  store: TuiStore;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const view = createMemo(() => toTuiEvidenceView(props.message.summary));
  const needsAttention = () => view().headline === "needs_attention";
  const headlineColor = () => needsAttention() ? theme().warning : theme().success;
  const compact = createMemo(() => {
    const parts: string[] = [];
    if (view().changedFiles.length > 0) {
      parts.push(props.store.l("tui.proof.count.files", { count: view().changedFiles.length }));
    }
    if (view().checks.length > 0) {
      parts.push(props.store.l("tui.proof.count.checks", { count: view().checks.length }));
    }
    if (view().claims.length > 0) {
      parts.push(props.store.l("tui.proof.count.claims", { count: view().claims.length }));
    }
    if (view().risks.length > 0) {
      parts.push(props.store.l("tui.proof.count.risks", { count: view().risks.length }));
    }
    return parts.join(" · ");
  });

  return (
    <box
      width="100%"
      backgroundColor={theme().panel}
      borderStyle={BLOCK.borderStyle}
      border={["left"]}
      borderColor={props.focused ? theme().primary : headlineColor()}
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        paddingBottom: 1,
        marginBottom: BLOCK.marginBottom,
        gap: BLOCK.gap,
      }}
      ref={(el) => {
        el.onMouseUp = () => props.onToggle();
      }}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <text wrapMode="none" truncate>
          <span style={{ fg: headlineColor(), bold: true }}>{needsAttention() ? "!" : "✓"}</span>
          <span style={{ fg: theme().muted }}> {props.store.l("tui.proof.title")}</span>
          <span style={{ fg: headlineColor() }}>
            {" · "}
            {props.store.l(needsAttention() ? "tui.proof.needsAttention" : "tui.proof.verified")}
          </span>
          <Show when={compact().length > 0}>
            <span style={{ fg: theme().dim }}> · {compact()}</span>
          </Show>
        </text>
        <text fg={props.focused ? theme().primary : theme().dim} wrapMode="none">
          {props.expanded ? props.store.l("tui.proof.expanded") : props.store.l("tui.proof.collapsed")}
        </text>
      </box>

      <Show when={props.expanded}>
        <Show when={view().outcome}>
          <text fg={needsAttention() ? theme().warning : theme().success} wrapMode="word">
            {props.store.l("tui.proof.outcome")}: {outcomeLabel(view().outcome!, props.store)}
          </text>
        </Show>
        <Show when={needsAttention() && view().reason}>
          <text fg={view().outcome === "invalid" ? theme().error : theme().warning} wrapMode="word">
            {props.store.l("tui.proof.reason")}: {reasonLabel(view().reason!, view().outcome, props.store)}
          </text>
        </Show>
        <Show when={view().activity}>
          <text fg={theme().dim} wrapMode="word">
            {view().activity}
          </text>
        </Show>
        <Show when={view().diff}>
          <text fg={theme().muted} wrapMode="word">
            {props.store.l("tui.proof.diff")}: {view().diff}
          </text>
        </Show>
        <EvidenceSection
          title={props.store.l("tui.proof.changedFiles")}
          items={view().changedFiles}
          store={props.store}
        />
        <EvidenceSection title={props.store.l("tui.proof.checks")} items={view().checks} store={props.store} />
        <EvidenceSection title={props.store.l("tui.proof.claims")} items={view().claims} store={props.store} />
        <EvidenceSection title={props.store.l("tui.proof.risks")} items={view().risks} store={props.store} />
        <EvidenceSection
          title={props.store.l("tui.proof.permissions")}
          items={view().permissions}
          store={props.store}
        />
        <EvidenceSection
          title={props.store.l("tui.proof.reviewActions")}
          items={view().reviewActions}
          store={props.store}
        />
        <Show when={view().receipt}>
          <text fg={view().receipt === "not saved" ? theme().warning : theme().dim} wrapMode="word">
            {props.store.l("tui.proof.receipt")}:{" "}
            {view().receipt === "not saved" ? props.store.l("tui.proof.receiptNotSaved") : view().receipt}
          </text>
        </Show>
        <Show when={view().nextCommand}>
          <text fg={theme().secondary} wrapMode="word">
            {props.store.l("tui.proof.details")}: {view().nextCommand}
          </text>
        </Show>
      </Show>
    </box>
  );
}

function statusIcon(status: string | undefined): string {
  if (status === "passed" || status === "supported" || status === "recorded") return "✓";
  if (status === "failed" || status === "error" || status === "deny") return "×";
  if (status === "skipped" || status === "not_run" || status === "unsupported" || status === "unverified") return "!";
  return "·";
}

function itemColor(status: string | undefined, store: TuiStore): string {
  const theme = getTuiTheme(store.themeName());
  if (status === "passed" || status === "supported" || status === "recorded") return theme.success;
  if (status === "failed" || status === "error" || status === "deny") return theme.error;
  if (status === "skipped" || status === "not_run" || status === "unsupported" || status === "unverified") {
    return theme.warning;
  }
  return theme.text;
}

function statusLabel(status: string, store: TuiStore): string {
  const keyByStatus: Record<string, Parameters<TuiStore["l"]>[0]> = {
    passed: "tui.proof.status.passed",
    failed: "tui.proof.status.failed",
    skipped: "tui.proof.status.skipped",
    not_run: "tui.proof.status.notRun",
    not_required: "tui.proof.status.notRequired",
    supported: "tui.proof.status.supported",
    unsupported: "tui.proof.status.unsupported",
    unverified: "tui.proof.status.unverified",
    warning: "tui.proof.status.warning",
    error: "tui.proof.status.error",
  };
  const key = keyByStatus[status];
  return key ? store.l(key) : status.replaceAll("_", " ");
}

function outcomeLabel(outcome: string, store: TuiStore): string {
  const keyByOutcome: Record<string, Parameters<TuiStore["l"]>[0]> = {
    verified: "tui.proof.outcome.verified",
    partially_verified: "tui.proof.outcome.partiallyVerified",
    unverified: "tui.proof.outcome.unverified",
    blocked: "tui.proof.outcome.blocked",
    invalid: "tui.proof.outcome.invalid",
  };
  const key = keyByOutcome[outcome];
  return key ? store.l(key) : outcome.replaceAll("_", " ");
}

function reasonLabel(reason: string, outcome: string | undefined, store: TuiStore): string {
  if (reason === "proof_receipt_not_saved") return store.l("tui.proof.reason.notSaved");
  if (reason === "legacy_unsealed_proof") return store.l("tui.proof.reason.legacy");
  if (outcome === "partially_verified") return store.l("tui.proof.reason.partial");
  if (outcome === "unverified") return store.l("tui.proof.reason.unverified");
  if (outcome === "blocked") return store.l("tui.proof.reason.blocked");
  if (outcome === "invalid") return store.l("tui.proof.reason.invalid");
  return reason;
}
