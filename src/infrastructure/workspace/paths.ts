import { isAbsolute, relative, resolve } from "node:path";

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

export function encodeWorkspaceRoot(canonicalRoot: string): string {
  const real = resolve(canonicalRoot);
  const leaf = real.split("/").filter(Boolean).at(-1) ?? "repo";
  const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  const hash = Bun.hash(real).toString(16).padStart(12, "0").slice(0, 12);
  return `${safe}-${hash}`;
}
