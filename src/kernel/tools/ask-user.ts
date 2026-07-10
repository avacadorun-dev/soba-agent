import { createToolErrorResult } from "./errors";
import type { ToolDefinition, ToolResult } from "./types";

export interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

export interface AskUserArgs {
  question: string;
  options: AskUserOption[];
  allowOther?: boolean;
}

export type ClarificationOutcome =
  | { status: "answered"; choice: string; other?: string }
  | { status: "declined" | "cancelled" | "unavailable" };

export const askUserTool: ToolDefinition<AskUserArgs> = {
  name: "ask_user",
  label: "Ask user",
  description: "Ask one concise planning question with 2 to 5 choices. Use only when structured clarification is available.",
  toolType: "function",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The decision that needs user input." },
      options: {
        type: "array",
        description: "Two to five stable choices.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable machine-readable option id." },
            label: { type: "string", description: "Short button label." },
            description: { type: "string", description: "Optional consequence of this choice." },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
      allowOther: { type: "boolean", description: "Offer an optional free-text Other response." },
    },
    required: ["question", "options"],
    additionalProperties: false,
  },
  prepareArgs(raw): AskUserArgs {
    const question = typeof raw.question === "string" ? raw.question.trim() : "";
    if (!question || question.length > 500) throw new Error("question must be 1 to 500 characters");
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 5) {
      throw new Error("options must contain 2 to 5 choices");
    }
    const options = raw.options.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("each option must be an object");
      const option = value as Record<string, unknown>;
      const id = typeof option.id === "string" ? option.id.trim() : "";
      const label = typeof option.label === "string" ? option.label.trim() : "";
      const description = typeof option.description === "string" ? option.description.trim() : undefined;
      if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(id) || !label || label.length > 120 || (description?.length ?? 0) > 300) {
        throw new Error("each option needs a stable id, short label, and optional short description");
      }
      return { id, label, ...(description ? { description } : {}) };
    });
    if (new Set(options.map((option) => option.id)).size !== options.length) throw new Error("option ids must be unique");
    return { question, options, ...(raw.allowOther === true ? { allowOther: true } : {}) };
  },
  async execute(args, context): Promise<ToolResult> {
    if (!context.requestClarification) {
      return createToolErrorResult({
        code: "clarification_unavailable",
        category: "validation",
        message: "Structured clarification is unavailable in this client. Present the open question in the final response instead.",
        nextAction: "Finish with the unresolved question; do not retry ask_user.",
        fingerprint: "validation:clarification_unavailable",
      });
    }
    const outcome = await context.requestClarification(args);
    if (outcome.status !== "answered") {
      return createToolErrorResult({
        code: `clarification_${outcome.status}`,
        category: "aborted",
        message: `The user ${outcome.status} the clarification. Present it as an unresolved question in the final response.`,
        nextAction: "Finish with the unresolved question; do not retry ask_user.",
        fingerprint: `aborted:clarification_${outcome.status}`,
      });
    }
    const selected = args.options.find((option) => option.id === outcome.choice);
    const answer = selected ? `${selected.label} (${selected.id})` : outcome.choice;
    return {
      content: [{ type: "text", text: `User selected: ${answer}${outcome.other ? `\nOther details: ${outcome.other}` : ""}` }],
      isError: false,
      details: { choice: outcome.choice, ...(outcome.other ? { other: outcome.other } : {}) },
    };
  },
};
