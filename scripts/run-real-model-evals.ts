import { resolve } from "node:path";
import { runRealModelComparativeEval } from "../tests/evals/real-model/real-model-eval-runner";

const args = process.argv.slice(2);
const profile = flagValue(args, "--profile");
if (!profile) {
  console.error("Usage: bun run eval:real-model --profile <profile.json> [--output <dir>] [--timeout-ms <ms>] [--retain-workspaces]");
  process.exit(2);
}

const projectRoot = process.cwd();
const outputDir = flagValue(args, "--output") ?? ".soba/evals";
const timeoutValue = flagValue(args, "--timeout-ms");
const timeoutMs = timeoutValue ? Number.parseInt(timeoutValue, 10) : undefined;
const report = await runRealModelComparativeEval({
  projectRoot,
  profilePath: profile,
  outputDir,
  timeoutMs,
  retainWorkspaces: args.includes("--retain-workspaces"),
});
console.log(resolve(projectRoot, outputDir, report.runId, "report.json"));
console.log(JSON.stringify(report.metrics, null, 2));

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}
