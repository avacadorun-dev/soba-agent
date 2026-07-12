import { expect, test } from "bun:test";
import { type AppConfig, mergeConfig } from "../src/config";

const defaults: AppConfig = {
  server: { host: "127.0.0.1", port: 3000 },
  logging: { level: "info", json: false },
};

test("preserves sibling defaults in an overridden section", () => {
  expect(mergeConfig(defaults, { server: { port: 8080 } })).toEqual({
    server: { host: "127.0.0.1", port: 8080 },
    logging: { level: "info", json: false },
  });
});
