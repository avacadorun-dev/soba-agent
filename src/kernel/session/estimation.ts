import type { ItemParam } from "../transcript/types";

const CHARS_PER_TOKEN = 3.5;

export function estimateItemTokens(item: ItemParam): number {
  let text = "";
  if (item.type === "message") {
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if ("text" in block) text += block.text;
      }
    } else {
      text = String(item.content);
    }
    if ("reasoning_content" in item && typeof item.reasoning_content === "string") {
      text += item.reasoning_content;
    }
  } else if (item.type === "function_call") {
    text = `${item.name}: ${item.arguments}`;
    if (typeof item.reasoning_content === "string") {
      text += item.reasoning_content;
    }
  } else if (item.type === "function_call_output") {
    text = typeof item.output === "string" ? item.output : JSON.stringify(item.output);
  } else if (item.type === "local_shell_call") {
    text = `shell: ${item.command}`;
  } else if (item.type === "local_shell_call_output") {
    text = item.output;
  } else if (item.type === "compaction") {
    text = item.encrypted_content;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokens(items: ItemParam[]): number {
  return items.reduce((sum, item) => sum + estimateItemTokens(item), 0);
}
