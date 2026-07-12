import { strict as assert } from "node:assert";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");

const { add } = await import(pathToFileURL(join(workspace, "src", "math.ts")).href);
assert.equal(add(2, 3), 5);
assert.equal(add(-2, -3), -5);
assert.equal(add(0, 0), 0);
console.log("external acceptance passed: math addition");
