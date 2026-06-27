import treeSitterWorkerPath from "@opentui/core/parser.worker" with { type: "file" };

export function configureOpenTuiAssets(): void {
  process.env.OTUI_TREE_SITTER_WORKER_PATH ??= treeSitterWorkerPath;
}
