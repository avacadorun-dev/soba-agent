/**
 * Markdown codec for .capsule.md files.
 *
 * Frontmatter intentionally carries scalar metadata only; the full machine
 * representation lives in a soba-capsule-json fenced block.
 */

import type { PortableCapsule, PortableCapsuleDecodeResult } from "./types";

const CAPSULE_JSON_FENCE = "soba-capsule-json";

export function encodePortableCapsuleMarkdown(capsule: PortableCapsule): string {
  const frontmatter = [
    "---",
    scalar("schema", capsule.schema),
    scalar("version", String(capsule.version)),
    scalar("id", capsule.id),
    scalar("title", capsule.title),
    scalar("createdAt", capsule.createdAt),
    scalar("tier", capsule.tier),
    scalar("category", capsule.category),
    scalar("archetype", capsule.archetype),
    scalar("intendedReceiver", capsule.intendedReceiver),
    "---",
  ].join("\n");
  const briefing = [
    `# ${capsule.title}`,
    "",
    `Receiver: ${capsule.intendedReceiver}`,
    "",
    `Objective: ${capsule.objective}`,
    "",
    "## Dispatch Summary",
    "",
    capsule.dispatchSummary,
    "",
    "## Core Content",
    "",
    ...capsule.coreContent.map((entry) => `- ${entry}`),
    "",
    "## Machine Payload",
    "",
    `\`\`\`${CAPSULE_JSON_FENCE}`,
    JSON.stringify(capsule, null, 2),
    "```",
    "",
  ].join("\n");

  return `${frontmatter}\n\n${briefing}`;
}

export function decodePortableCapsuleMarkdown(markdown: string): PortableCapsuleDecodeResult {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const block = extractJsonFence(body);
  const parsed = JSON.parse(block) as PortableCapsule;
  const briefing = body.slice(0, body.indexOf(`\`\`\`${CAPSULE_JSON_FENCE}`)).trim();

  return {
    capsule: parsed,
    briefing,
    frontmatter,
  };
}

function scalar(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value)}`;
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) {
    return { frontmatter: {}, body: markdown };
  }

  const raw = markdown.slice(4, end);
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    frontmatter[key] = parseScalarValue(rawValue);
  }

  return {
    frontmatter,
    body: markdown.slice(end + "\n---\n".length),
  };
}

function parseScalarValue(value: string): string {
  if (value.startsWith("\"")) {
    const parsed = JSON.parse(value) as string;
    return parsed;
  }
  return value;
}

function extractJsonFence(markdown: string): string {
  const startMarker = `\`\`\`${CAPSULE_JSON_FENCE}`;
  const start = markdown.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`Missing ${CAPSULE_JSON_FENCE} fenced block`);
  }
  const contentStart = markdown.indexOf("\n", start);
  if (contentStart < 0) {
    throw new Error(`Invalid ${CAPSULE_JSON_FENCE} fenced block`);
  }
  const end = markdown.indexOf("\n```", contentStart + 1);
  if (end < 0) {
    throw new Error(`Unclosed ${CAPSULE_JSON_FENCE} fenced block`);
  }
  return markdown.slice(contentStart + 1, end);
}
