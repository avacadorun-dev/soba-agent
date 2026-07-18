import { SYNTHWAVE_NOODLE_FRAMES } from "../../output/agent-status-line";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";

export function StatusBar(props: { store: TuiStore; width: number }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const label = () => {
    const frame = props.store.noodleFrame();
    const mode = props.store.workMode();
    const modeBadge = mode === "plan" ? " [plan]" : mode === "goal" ? " [goal]" : "";
    return frame === null || props.store.activeCompaction()
      ? `● ${props.store.status()}${modeBadge}`
      : `${SYNTHWAVE_NOODLE_FRAMES[frame]} ${props.store.getThinkingLabel()}${modeBadge}`;
  };
  return (
    <box
      height={1}
      backgroundColor={theme().panel}
      style={{ flexDirection: "row", justifyContent: "space-between", paddingLeft: 1, paddingRight: 1 }}
    >
      <text wrapMode="none" truncate
        fg={
          props.store.workMode() === "plan" || props.store.workMode() === "goal"
            ? theme().warning
            : props.store.noodleFrame() === null || props.store.activeCompaction()
              ? props.store.isIdle()
                ? theme().success
                : theme().warning
              : theme().primary
        }
      >
        {label()}
      </text>
      <text fg={theme().muted} wrapMode="none" truncate>
        {props.width >= 100 ? props.store.getHelpKeys() : props.width >= 60 ? props.store.l("tui.keys.helpShort") : ""}
      </text>
    </box>
  );
}
