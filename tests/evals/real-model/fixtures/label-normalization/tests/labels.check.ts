import { expect, test } from "bun:test";
import { normalizeLabels } from "../src/labels";

test("normalizes comma-separated labels", () => {
  expect(normalizeLabels(" Bug, feature,bug, , FEATURE ,docs ")).toEqual(["bug", "feature", "docs"]);
});
