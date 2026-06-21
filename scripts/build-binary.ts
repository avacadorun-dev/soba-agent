import { mkdirSync } from "node:fs";
import { join } from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";

const pkg = await Bun.file("package.json").json<{ version: string }>();
const version = pkg.version;

const SUPPORTED_TARGETS = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-arm64", "bun-linux-x64"] as const;
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

const requestedTarget = process.argv[2] ?? "bun-darwin-arm64";
if (!SUPPORTED_TARGETS.includes(requestedTarget as SupportedTarget)) {
  console.error(`Unsupported target "${requestedTarget}". Use one of: ${SUPPORTED_TARGETS.join(", ")}`);
  process.exit(1);
}

const target = requestedTarget as SupportedTarget;
const outputDir = join("dist", "bin");
const outfile = join(outputDir, `soba-${target.replace("bun-", "")}-v${version}`);
mkdirSync(outputDir, { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  target: "bun",
  plugins: [solidPlugin],
  minify: true,
  compile: {
    target,
    outfile,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built ${outfile}`);
