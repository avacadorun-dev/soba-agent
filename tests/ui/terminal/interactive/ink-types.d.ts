// Type stubs for optional TUI testing dependencies
// Install with: bun add -d ink-testing-library @types/react

declare module "ink-testing-library" {
  import type { ReactElement } from "react";
  export function render(
    tree: ReactElement,
    options?: { exitOnCtrlC?: boolean; width?: number; height?: number },
  ): {
    lastFrame: () => string;
    unmount: () => void;
    rerender: (tree: ReactElement) => void;
    clear: () => void;
  };
}

declare module "react" {
  interface ReactElement {}

  export type { ReactElement };
}
