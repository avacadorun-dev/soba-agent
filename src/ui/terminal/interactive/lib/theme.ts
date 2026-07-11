import { RGBA, SyntaxStyle } from "@opentui/core";
import type { TuiThemeName } from "../../../../application/ui/public";

export interface TuiTheme {
  background: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  dim: string;
  primary: string;
  secondary: string;
  success: string;
  error: string;
  warning: string;
}

export const TUI_THEMES: Record<TuiThemeName, TuiTheme> = {
  graphite: {
    background: "#0E0F11",
    panel: "#181A1F",
    border: "#30343B",
    text: "#ECEDEF",
    muted: "#989DA6",
    dim: "#5E646E",
    primary: "#70D6A0",
    secondary: "#8AAEC2",
    success: "#55C98B",
    error: "#F07A78",
    warning: "#DDB76A",
  },

  aurora: {
    background: "#0A1018",
    panel: "#111B29",
    border: "#283B54",
    text: "#E7F0FA",
    muted: "#8CA0B8",
    dim: "#50647B",
    primary: "#8BC5FF",
    secondary: "#C4A7FF",
    success: "#6FD3BA",
    error: "#F1879E",
    warning: "#E8C878",
  },

  synthwave: {
    background: "#080714",
    panel: "#111026",
    border: "#352E5C",
    text: "#F2EBFF",
    muted: "#9A8DBB",
    dim: "#5C5279",
    primary: "#E879F9",
    secondary: "#67E8F9",
    success: "#5EEAB1",
    error: "#FB7185",
    warning: "#FDE047",
  },

  paper: {
    background: "#F4F0E7",
    panel: "#E8E1D3",
    border: "#C9BDAA",
    text: "#242019",
    muted: "#655E53",
    dim: "#A39A8A",
    primary: "#315E78",
    secondary: "#765477",
    success: "#2E7255",
    error: "#B5474F",
    warning: "#8A6116",
  },

  forest: {
    background: "#09110D",
    panel: "#111C15",
    border: "#29402F",
    text: "#DDE7DA",
    muted: "#899B86",
    dim: "#536554",
    primary: "#8BCF91",
    secondary: "#C0C979",
    success: "#62C38A",
    error: "#DF756A",
    warning: "#D6B85C",
  },
  operator: {
    background: "#070B12",
    panel: "#0E1622",
    border: "#23364A",
    text: "#E9F2FA",
    muted: "#91A4B8",
    dim: "#52677D",
    primary: "#62D5F2",
    secondary: "#99F6E4",
    success: "#5DE0A0",
    error: "#FF7377",
    warning: "#FFD166",
  },

  ink: {
    background: "#F2F0E9",
    panel: "#E5E1D6",
    border: "#C9C3B4",
    text: "#171714",
    muted: "#626057",
    dim: "#999487",
    primary: "#286A50",
    secondary: "#4D667A",
    success: "#3D7D5B",
    error: "#A7444A",
    warning: "#765518",
  },

  highContrast: {
    background: "#000000",
    panel: "#0B0B0B",
    border: "#6A6A6A",
    text: "#FFFFFF",
    muted: "#C7C7C7",
    dim: "#8A8A8A",
    primary: "#7DD3FC",
    secondary: "#F0ABFC",
    success: "#86EFAC",
    error: "#FDA4AF",
    warning: "#FDE68A",
  },

  clay: {
    background: "#15110F",
    panel: "#211A16",
    border: "#49382F",
    text: "#F0E2D7",
    muted: "#AF9382",
    dim: "#6C5548",
    primary: "#D79A72",
    secondary: "#A8B77D",
    success: "#8BC784",
    error: "#E27970",
    warning: "#DDB45E",
  },
};

const markdownStyles = new Map<TuiThemeName, SyntaxStyle>();

export function getTuiTheme(name: TuiThemeName): TuiTheme {
  return TUI_THEMES[name];
}

export function getMarkdownStyle(name: TuiThemeName): SyntaxStyle {
  const cached = markdownStyles.get(name);
  if (cached) return cached;

  const theme = getTuiTheme(name);

  const style = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(theme.text) },
    keyword: { fg: RGBA.fromHex(theme.primary), bold: true },
    string: { fg: RGBA.fromHex(theme.success) },
    comment: { fg: RGBA.fromHex(theme.muted), italic: true },
    number: { fg: RGBA.fromHex(theme.warning) },
    function: { fg: RGBA.fromHex(theme.secondary) },
    type: { fg: RGBA.fromHex(theme.primary) },
    operator: { fg: RGBA.fromHex(theme.muted) },
  });

  markdownStyles.set(name, style);
  return style;
}
