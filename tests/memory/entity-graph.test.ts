import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EntityGraphError, EntityGraphStore } from "../../src/engine/memory/entity-graph";
import type { EntityNode } from "../../src/engine/memory/types";

describe("EntityGraphStore", () => {
  let projectRoot: string;
  let store: EntityGraphStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-entity-graph-"));
    store = new EntityGraphStore({ projectRoot });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("add node stores and returns a defensive copy", () => {
    const node = makeNode("file:src/cli.ts", "file", "src/cli.ts", { path: "src/cli.ts" });

    const added = store.addNode(node);
    added.metadata.path = "mutated";

    expect(store.getNode("file:src/cli.ts")).toEqual(node);
    expect(store.getGraph().nodes).toHaveLength(1);
  });

  test("add edge requires existing nodes", () => {
    store.addNode(makeNode("module:core", "module", "core"));

    expect(() => store.addEdge({ from: "module:core", to: "file:missing", type: "contains" })).toThrow(EntityGraphError);
  });

  test("get neighbors by direction and type", () => {
    store.addNode(makeNode("module:core", "module", "core"));
    store.addNode(makeNode("file:session", "file", "session-manager.ts"));
    store.addNode(makeNode("dependency:bun", "dependency", "Bun"));

    store.addEdge({ from: "module:core", to: "file:session", type: "contains" });
    store.addEdge({ from: "file:session", to: "dependency:bun", type: "depends_on" });
    store.addEdge({ from: "file:session", to: "module:core", type: "imports" });

    expect(
      store.getNeighbors("file:session", { direction: "outgoing" }).map((neighbor) => [
        neighbor.direction,
        neighbor.edge.type,
        neighbor.node.id,
      ]),
    ).toEqual([
      ["outgoing", "depends_on", "dependency:bun"],
      ["outgoing", "imports", "module:core"],
    ]);
    expect(
      store.getNeighbors("file:session", { direction: "incoming", type: "contains" }).map((neighbor) => neighbor.node.id),
    ).toEqual(["module:core"]);
  });

  test("save/load roundtrip persists graph.json", () => {
    store.addNode(makeNode("file:a", "file", "a.ts", { path: "src/a.ts", exports: ["run"] }));
    store.addNode(makeNode("function:run", "function", "run"));
    store.addEdge({ from: "file:a", to: "function:run", type: "contains", weight: 0.9 });

    store.save();

    expect(existsSync(store.getGraphPath())).toBe(true);

    const reloaded = new EntityGraphStore({ projectRoot });
    const graph = reloaded.load();

    expect(graph).toEqual(store.getGraph());
    expect(reloaded.getNode("file:a")?.metadata.exports).toEqual(["run"]);
  });

  test("duplicate node upserts by id without growing graph", () => {
    store.addNode(makeNode("file:a", "file", "a.ts", { path: "src/a.ts" }));
    store.addNode(makeNode("file:a", "file", "renamed-a.ts", { path: "src/renamed-a.ts", lineCount: 42 }));

    expect(store.getGraph().nodes).toHaveLength(1);
    expect(store.getNode("file:a")).toMatchObject({
      name: "renamed-a.ts",
      metadata: {
        path: "src/renamed-a.ts",
        lineCount: 42,
      },
    });
  });

  test("duplicate edge upserts by from/to/type without growing graph", () => {
    store.addNode(makeNode("file:a", "file", "a.ts"));
    store.addNode(makeNode("file:b", "file", "b.ts"));

    store.addEdge({ from: "file:a", to: "file:b", type: "imports", weight: 0.2 });
    store.addEdge({ from: "file:a", to: "file:b", type: "imports", weight: 0.8 });

    expect(store.getGraph().edges).toEqual([{ from: "file:a", to: "file:b", type: "imports", weight: 0.8 }]);
  });

  test("empty graph load is graceful when graph file is missing", () => {
    const graph = store.load();

    expect(graph).toEqual({ nodes: [], edges: [] });
    expect(store.getGraph()).toEqual({ nodes: [], edges: [] });
  });

  test("corrupted graph file gives a clear failure", () => {
    store.addNode(makeNode("file:a", "file", "a.ts"));
    store.save();
    writeFileSync(store.getGraphPath(), "{ broken", "utf-8");

    expect(() => store.load()).toThrow(EntityGraphError);
  });
});

function makeNode(
  id: string,
  type: EntityNode["type"],
  name: string,
  metadata: EntityNode["metadata"] = {},
): EntityNode {
  return {
    id,
    type,
    name,
    metadata,
  };
}
