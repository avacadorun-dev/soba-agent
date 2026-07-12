import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { redactSecrets } from "../../../src/kernel/tools/errors";

interface ProducerArgs {
  provider: string;
  model: string;
  prompt: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: ToolCall[];
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatResponse {
  choices?: Array<{ message?: AssistantMessage }>;
  usage?: { total_tokens?: number };
}

const MAX_MODEL_CALLS = 12;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const COMMAND_TIMEOUT_MS = 120_000;

export async function runOrdinaryAgentProducer(args: ProducerArgs, workspace = process.cwd()): Promise<number> {
  if (args.provider !== "openrouter") {
    throw new Error(`ordinary-agent producer supports openrouter, received ${args.provider}`);
  }
  const apiKey = readProviderApiKey(args.provider);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a conventional coding agent in a disposable Git workspace.",
        "Use the provided tools to inspect and modify the repository and run the relevant tests.",
        "When you believe the task is complete, return a final answer. There is no proof policy or completion gate.",
        "Keep changes minimal and do not access paths outside the workspace.",
      ].join(" "),
    },
    { role: "user", content: args.prompt },
  ];
  let totalTokens = 0;

  for (let modelCalls = 1; modelCalls <= MAX_MODEL_CALLS; modelCalls += 1) {
    const response = await requestCompletion(apiKey, args.model, messages);
    totalTokens += response.usage?.total_tokens ?? 0;
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter response contained no assistant message.");
    messages.push(message);
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      process.stdout.write(`${message.content?.trim() || "Completed."}\n`);
      process.stdout.write(`model calls: ${modelCalls}\n`);
      if (totalTokens > 0) process.stdout.write(`tokens used: ${totalTokens}\n`);
      process.stdout.write("interventions: 0\n");
      return 0;
    }

    for (const toolCall of toolCalls) {
      const content = await executeTool(toolCall, workspace);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content });
    }
  }

  process.stderr.write(`ordinary-agent producer reached ${MAX_MODEL_CALLS} model calls without a final answer.\n`);
  return 1;
}

export function resolveWorkspacePath(workspace: string, requestedPath: string): string {
  const root = resolve(workspace);
  const candidate = resolve(root, requestedPath);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) return candidate;
  throw new Error(`Path escapes eval workspace: ${requestedPath}`);
}

function readProviderApiKey(provider: string): string {
  const config = JSON.parse(readFileSync(join(homedir(), ".soba", "config.json"), "utf8")) as {
    registry?: { providers?: Record<string, { apiKey?: string }> };
  };
  const apiKey = config.registry?.providers?.[provider]?.apiKey;
  if (!apiKey) throw new Error(`No API credential configured for provider ${provider}.`);
  return apiKey;
}

async function requestCompletion(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-title": "SOBA ordinary-agent eval",
    },
    body: JSON.stringify({ model, messages, tools: TOOL_DEFINITIONS, tool_choice: "auto" }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${redactSecrets(body).slice(0, 2_000)}`);
  }
  return JSON.parse(body) as ChatResponse;
}

async function executeTool(toolCall: ToolCall, workspace: string): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    switch (toolCall.function.name) {
      case "read_file": {
        const path = requireString(args.path, "path");
        return bounded(readFileSync(resolveWorkspacePath(workspace, path), "utf8"));
      }
      case "write_file": {
        const path = requireString(args.path, "path");
        const content = requireString(args.content, "content", true);
        writeFileSync(resolveWorkspacePath(workspace, path), content, "utf8");
        return `Wrote ${path}`;
      }
      case "run_command": {
        const command = requireString(args.command, "command");
        return await runCommand(command, workspace);
      }
      default:
        return `Unknown tool: ${toolCall.function.name}`;
    }
  } catch (error) {
    return `Tool error: ${redactSecrets(error instanceof Error ? error.message : String(error))}`;
  }
}

async function runCommand(command: string, workspace: string): Promise<string> {
  const proc = Bun.spawn(["zsh", "-lc", command], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, COMMAND_TIMEOUT_MS);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return bounded([
    `exitCode=${exitCode}`,
    timedOut ? "timedOut=true" : "",
    stdout,
    stderr,
  ].filter(Boolean).join("\n"));
}

function requireString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`${name} must be a ${allowEmpty ? "string" : "non-empty string"}.`);
  }
  return value;
}

function bounded(value: string): string {
  const redacted = redactSecrets(value);
  if (redacted.length <= MAX_TOOL_OUTPUT_CHARS) return redacted;
  return `${redacted.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[Tool output truncated]`;
}

function parseArgs(argv: string[]): ProducerArgs {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const provider = value("--provider");
  const model = value("--model");
  const prompt = value("--prompt");
  if (!provider || !model || !prompt) {
    throw new Error("Usage: ordinary-agent-producer --provider <id> --model <id> --prompt <task>");
  }
  return { provider, model, prompt };
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 file inside the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Replace a UTF-8 file inside the workspace with the supplied content.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the disposable workspace and return its output and exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

if (import.meta.main) {
  try {
    process.exitCode = await runOrdinaryAgentProducer(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
