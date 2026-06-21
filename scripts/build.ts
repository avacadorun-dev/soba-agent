import solidPlugin from "@opentui/solid/bun-plugin";
import { relative } from "node:path";

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "bun",
  external: ["@opentui/core"],
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`${relative(process.cwd(), output.path)} ${output.size} bytes`);
}
