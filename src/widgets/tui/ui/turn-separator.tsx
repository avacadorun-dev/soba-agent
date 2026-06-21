import { useTerminalDimensions } from "@opentui/solid";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";

/**
 * Turn separator: visually divides conversation turns.
 * Shows a full-width line ────── Turn N ────── ▾ with alternating colors.
 * Clickable to collapse/expand the turn.
 */
export function TurnSeparator(props: {
  turnNumber: number;
  colorIndex: number;
  collapsed: boolean;
  onToggle: () => void;
  store: TuiStore;
}) {
  const dims = useTerminalDimensions();
  const theme = () => getTuiTheme(props.store.themeName());

  // Alternate between primary and secondary colors
  const colors = ["primary", "secondary"] as const;
  const color = colors[props.colorIndex % colors.length];

  const label = () => ` ${props.store.l("tui.turn.label", { number: props.turnNumber })} `;
  const indicator = () => (props.collapsed ? " ▸" : " ▾");

  // Build line: colored-label + dim-dashes → full width + indicator
  const line = () => {
    const w = dims().width;
    const boxChar = "─";
    const labelText = label();
    const indicatorText = indicator();
    const rightLen = Math.max(0, w - labelText.length - indicatorText.length);
    const dashColor = theme().dim;
    const labelColor = theme()[color];

    return (
      <>
        <span style={{ fg: labelColor }}>{labelText}</span>
        <span style={{ fg: dashColor }}>{boxChar.repeat(rightLen)}</span>
        <span style={{ fg: dashColor }}>{indicatorText}</span>
      </>
    );
  };

  return (
    <box
      style={{
        paddingTop: 0,
        paddingBottom: 1,
      }}
      ref={(el) => {
        el.onMouseDown = () => props.onToggle();
      }}
    >
      <text wrapMode="none">{line()}</text>
    </box>
  );
}
