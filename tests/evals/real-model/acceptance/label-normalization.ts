import { strict as assert } from "node:assert";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("workspace argument is required");

const { normalizeLabels } = await import(pathToFileURL(join(workspace, "src", "labels.ts")).href);
assert.deepEqual(normalizeLabels(" Bug, feature,bug, , FEATURE ,docs "), ["bug", "feature", "docs"]);
assert.deepEqual(normalizeLabels("zeta, alpha, beta, alpha"), ["zeta", "alpha", "beta"]);
assert.deepEqual(normalizeLabels("  ,  "), []);
console.log("external acceptance passed: label normalization");
