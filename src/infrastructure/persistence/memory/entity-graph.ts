import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ENTITY_EDGE_TYPES,
  ENTITY_NODE_TYPES,
  type EntityEdge,
  type EntityGraph,
  type EntityGraphStoreOptions,
  type EntityNeighbor,
  type EntityNeighborFilters,
  type EntityNode,
} from "../../../kernel/memory/types";

const GRAPH_STORE_VERSION = 1;

interface PersistedEntityGraph {
  version: number;
  lastUpdated: string;
  graph: EntityGraph;
}

export type EntityGraphErrorCode = "invalid_node" | "invalid_edge" | "unknown_node" | "corrupted_graph";

export class EntityGraphError extends Error {
  readonly code: EntityGraphErrorCode;

  constructor(code: EntityGraphErrorCode, message: string) {
    super(message);
    this.name = "EntityGraphError";
    this.code = code;
  }
}

export class EntityGraphStore {
  private readonly projectRoot: string;
  private readonly memoryDir: string;
  private readonly graphPath: string;
  private graph: EntityGraph;

  constructor(options: EntityGraphStoreOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.memoryDir = resolve(options.memoryDir ?? join(this.projectRoot, ".soba", "memory"));
    this.graphPath = join(this.memoryDir, "graph.json");
    this.graph = createEmptyGraph();
  }

  getMemoryDir(): string {
    return this.memoryDir;
  }

  getGraphPath(): string {
    return this.graphPath;
  }

  addNode(node: EntityNode): EntityNode {
    validateNode(node);

    const existingIndex = this.graph.nodes.findIndex((candidate) => candidate.id === node.id);
    const nextNode = cloneNode(node);

    if (existingIndex >= 0) {
      this.graph = {
        nodes: this.graph.nodes.map((candidate, index) => (index === existingIndex ? nextNode : candidate)),
        edges: this.graph.edges,
      };
      return cloneNode(nextNode);
    }

    this.graph = {
      nodes: [...this.graph.nodes, nextNode],
      edges: this.graph.edges,
    };

    return cloneNode(nextNode);
  }

  addEdge(edge: EntityEdge): EntityEdge {
    validateEdge(edge);
    this.assertNodeExists(edge.from);
    this.assertNodeExists(edge.to);

    const existingIndex = this.graph.edges.findIndex((candidate) => edgeKey(candidate) === edgeKey(edge));
    const nextEdge = cloneEdge(edge);

    if (existingIndex >= 0) {
      this.graph = {
        nodes: this.graph.nodes,
        edges: this.graph.edges.map((candidate, index) => (index === existingIndex ? nextEdge : candidate)),
      };
      return cloneEdge(nextEdge);
    }

    this.graph = {
      nodes: this.graph.nodes,
      edges: [...this.graph.edges, nextEdge],
    };

    return cloneEdge(nextEdge);
  }

  getNode(id: string): EntityNode | undefined {
    const node = this.graph.nodes.find((candidate) => candidate.id === id);
    return node ? cloneNode(node) : undefined;
  }

  getNeighbors(id: string, filters: EntityNeighborFilters = {}): EntityNeighbor[] {
    const direction = filters.direction ?? "both";
    const neighbors: EntityNeighbor[] = [];

    for (const edge of this.graph.edges) {
      if (filters.type && edge.type !== filters.type) {
        continue;
      }

      if ((direction === "outgoing" || direction === "both") && edge.from === id) {
        const node = this.getNode(edge.to);
        if (node) {
          neighbors.push({ node, edge: cloneEdge(edge), direction: "outgoing" });
        }
      }

      if ((direction === "incoming" || direction === "both") && edge.to === id) {
        const node = this.getNode(edge.from);
        if (node) {
          neighbors.push({ node, edge: cloneEdge(edge), direction: "incoming" });
        }
      }
    }

    return neighbors.sort(compareNeighbors);
  }

  getGraph(): EntityGraph {
    return cloneGraph(this.graph);
  }

  clear(): void {
    this.graph = createEmptyGraph();
  }

  save(): PersistedEntityGraph {
    const persisted = {
      version: GRAPH_STORE_VERSION,
      lastUpdated: new Date().toISOString(),
      graph: this.getGraph(),
    };

    mkdirSync(dirname(this.graphPath), { recursive: true });
    writeFileSync(this.graphPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf-8");
    return persisted;
  }

  load(): EntityGraph {
    if (!existsSync(this.graphPath)) {
      this.graph = createEmptyGraph();
      return this.getGraph();
    }

    try {
      const parsed = JSON.parse(readFileSync(this.graphPath, "utf-8")) as unknown;
      const graph = parsePersistedGraph(parsed);
      this.graph = graph;
      return this.getGraph();
    } catch (error) {
      if (error instanceof EntityGraphError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new EntityGraphError("corrupted_graph", `Could not parse entity graph: ${message}`);
    }
  }

  private assertNodeExists(id: string): void {
    if (!this.graph.nodes.some((node) => node.id === id)) {
      throw new EntityGraphError("unknown_node", `Entity graph node not found: ${id}`);
    }
  }
}

function createEmptyGraph(): EntityGraph {
  return {
    nodes: [],
    edges: [],
  };
}

function parsePersistedGraph(value: unknown): EntityGraph {
  if (!isRecord(value)) {
    throw new EntityGraphError("corrupted_graph", "Persisted entity graph must be an object");
  }

  if (value.version !== GRAPH_STORE_VERSION) {
    throw new EntityGraphError("corrupted_graph", "Persisted entity graph version is unsupported");
  }
  if (!isRecord(value.graph) || !Array.isArray(value.graph.nodes) || !Array.isArray(value.graph.edges)) {
    throw new EntityGraphError("corrupted_graph", "Persisted entity graph shape is invalid");
  }

  const graph: EntityGraph = {
    nodes: value.graph.nodes,
    edges: value.graph.edges,
  };

  for (const node of graph.nodes) {
    validateNode(node);
  }
  for (const edge of graph.edges) {
    validateEdge(edge);
    if (!graph.nodes.some((node) => node.id === edge.from) || !graph.nodes.some((node) => node.id === edge.to)) {
      throw new EntityGraphError("corrupted_graph", `Persisted entity graph edge references unknown node: ${edgeKey(edge)}`);
    }
  }

  return deduplicateGraph(graph);
}

function deduplicateGraph(graph: EntityGraph): EntityGraph {
  const nodes = new Map<string, EntityNode>();
  for (const node of graph.nodes) {
    nodes.set(node.id, cloneNode(node));
  }

  const edges = new Map<string, EntityEdge>();
  for (const edge of graph.edges) {
    edges.set(edgeKey(edge), cloneEdge(edge));
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort(compareEdges),
  };
}

function validateNode(value: unknown): asserts value is EntityNode {
  if (!isRecord(value)) {
    throw new EntityGraphError("invalid_node", "Entity graph node must be an object");
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new EntityGraphError("invalid_node", "Entity graph node id is required");
  }
  if (!ENTITY_NODE_TYPES.includes(value.type as EntityNode["type"])) {
    throw new EntityGraphError("invalid_node", "Entity graph node type is invalid");
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new EntityGraphError("invalid_node", "Entity graph node name is required");
  }
  if (!isRecord(value.metadata)) {
    throw new EntityGraphError("invalid_node", "Entity graph node metadata must be an object");
  }
}

function validateEdge(value: unknown): asserts value is EntityEdge {
  if (!isRecord(value)) {
    throw new EntityGraphError("invalid_edge", "Entity graph edge must be an object");
  }
  if (typeof value.from !== "string" || value.from.trim().length === 0) {
    throw new EntityGraphError("invalid_edge", "Entity graph edge from is required");
  }
  if (typeof value.to !== "string" || value.to.trim().length === 0) {
    throw new EntityGraphError("invalid_edge", "Entity graph edge to is required");
  }
  if (!ENTITY_EDGE_TYPES.includes(value.type as EntityEdge["type"])) {
    throw new EntityGraphError("invalid_edge", "Entity graph edge type is invalid");
  }
  if (value.weight !== undefined && typeof value.weight !== "number") {
    throw new EntityGraphError("invalid_edge", "Entity graph edge weight must be a number");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function edgeKey(edge: EntityEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.type}`;
}

function cloneGraph(graph: EntityGraph): EntityGraph {
  return {
    nodes: graph.nodes.map(cloneNode),
    edges: graph.edges.map(cloneEdge),
  };
}

function cloneNode(node: EntityNode): EntityNode {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      ...(node.metadata.exports ? { exports: [...node.metadata.exports] } : {}),
    },
  };
}

function cloneEdge(edge: EntityEdge): EntityEdge {
  return { ...edge };
}

function compareNeighbors(a: EntityNeighbor, b: EntityNeighbor): number {
  return a.direction.localeCompare(b.direction) || a.edge.type.localeCompare(b.edge.type) || a.node.id.localeCompare(b.node.id);
}

function compareEdges(a: EntityEdge, b: EntityEdge): number {
  return edgeKey(a).localeCompare(edgeKey(b));
}
