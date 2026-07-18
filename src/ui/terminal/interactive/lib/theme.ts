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

  // VS Code Dark Modern surfaces with the inherited Dark+ syntax palette.
  vscode: {
    background: "#1F1F1F",
    panel: "#181818",
    border: "#3C3C3C",
    text: "#CCCCCC",
    muted: "#9D9D9D",
    dim: "#6E7681",
    primary: "#4DAAFC",
    secondary: "#C586C0",
    success: "#B5CEA8",
    error: "#F85149",
    warning: "#D7BA7D",
  },

  // GitHub Primer Dark functional color tokens.
  github: {
    background: "#0D1117",
    panel: "#151B23",
    border: "#3D444D",
    text: "#F0F6FC",
    muted: "#9198A1",
    dim: "#656C76",
    primary: "#4493F8",
    secondary: "#AB7DF8",
    success: "#3FB950",
    error: "#F85149",
    warning: "#D29922",
  },

  aurora: {
    background: "#0D111A",
    panel: "#141A26",
    border: "#2A3447",
    text: "#DDE6F2",
    muted: "#7B89A3",
    dim: "#465268",
    primary: "#86B1F2",
    secondary: "#B19BE6",
    success: "#78BFA6",
    error: "#D9758A",
    warning: "#D2B06A",
  },

  synthwave: {
    background: "#070A12",
    panel: "#0D1220",
    border: "#273149",
    text: "#D8E0F0",
    muted: "#76819A",
    dim: "#414C63",
    primary: "#C76AF2",
    secondary: "#69CBEF",
    success: "#63D6A4",
    error: "#F06A83",
    warning: "#EFCB6A",
  },

  paper: {
    background: "#F5F0E7",
    panel: "#EBE3D6",
    border: "#D1C4B2",
    text: "#1E1A16",
    muted: "#5C5348",
    dim: "#A99D8C",
    primary: "#435A70",
    secondary: "#735D82",
    success: "#52765A",
    error: "#A64F56",
    warning: "#6B4F1E",
  },

  forest: {
    background: "#0B120E",
    panel: "#111A14",
    border: "#263326",
    text: "#D1D8CA",
    muted: "#74806E",
    dim: "#4A5547",
    primary: "#8EBD8A",
    secondary: "#A8B982",
    success: "#5A9E8C",
    error: "#C76A60",
    warning: "#CDA650",
  },
  operator: {
    background: "#080B10",
    panel: "#10151D",
    border: "#273241",
    text: "#E6EDF5",
    muted: "#8A96A8",
    dim: "#526071",
    primary: "#7DD3FC",
    secondary: "#A7F3D0",
    success: "#74C69D",
    error: "#F87171",
    warning: "#FBBF24",
  },

  ink: {
    background: "#F7F7F2",
    panel: "#ECEBE3",
    border: "#D5D2C6",
    text: "#171717",
    muted: "#5E625C",
    dim: "#A09D92",
    primary: "#244C66",
    secondary: "#6B4E71",
    success: "#3F7052",
    error: "#9B3D44",
    warning: "#71540B",
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
    background: "#161312",
    panel: "#211B18",
    border: "#3A2F2A",
    text: "#EADDD2",
    muted: "#A49083",
    dim: "#63544B",
    primary: "#C9906B",
    secondary: "#9CA77B",
    success: "#87A96B",
    error: "#C76E66",
    warning: "#D1A054",
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
