import { strict as assert } from "node:assert";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");

const { mergeConfig } = await import(pathToFileURL(join(workspace, "src", "config.ts")).href);
const defaults = {
  server: { host: "127.0.0.1", port: 3000 },
  logging: { level: "info", json: false },
};

assert.deepEqual(mergeConfig(defaults, { server: { port: 8080 } }), {
  server: { host: "127.0.0.1", port: 8080 },
  logging: { level: "info", json: false },
});
assert.deepEqual(mergeConfig(defaults, { logging: { level: "debug" } }), {
  server: { host: "127.0.0.1", port: 3000 },
  logging: { level: "debug", json: false },
});
assert.deepEqual(defaults, {
  server: { host: "127.0.0.1", port: 3000 },
  logging: { level: "info", json: false },
});
console.log("external acceptance passed: nested config merge");
