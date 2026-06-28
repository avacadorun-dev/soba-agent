import type { FunctionCallField } from "../../kernel/model/openresponses-types";
import type { ToolResult } from "../../kernel/tools/types";
import {
  type CompletionDecision,
  type CompletionState,
  diagnoseFinishArguments,
  evaluateCompletion,
  type FinishRequest,
  parseFinishRequest,
} from "./completion-gate";

const DEFAULT_MAX_FINISH_REJECTIONS = 3;

export type FinishEvaluation =
  | { kind: "accepted"; request: FinishRequest; decision: Extract<CompletionDecision, { accepted: true }> }
  | {
      kind: "rejected";
      request: FinishRequest;
      decision: Extract<CompletionDecision, { accepted: false }>;
      reasons: string[];
    }
  | { kind: "invalid"; diagnosis: string[] };

export interface FinishRejectionState {
  count: number;
  limitExceeded: boolean;
  message: string;
}

export interface CompletionControllerOptions {
  maxFinishRejections?: number;
}

export class CompletionController {
  private readonly maxFinishRejections: number;
  private finishRejections = 0;

  constructor(options: CompletionControllerOptions = {}) {
    this.maxFinishRejections = Math.max(
      1,
      Math.floor(options.maxFinishRejections ?? DEFAULT_MAX_FINISH_REJECTIONS),
    );
  }

  evaluateFinishCall(toolCall: FunctionCallField, state: CompletionState): FinishEvaluation {
    const request = parseFinishRequest(toolCall);
    if (!request) {
      return { kind: "invalid", diagnosis: diagnoseFinishArguments(toolCall) };
    }

    const decision = evaluateCompletion(request, state);
    if (decision.accepted) {
      return { kind: "accepted", request, decision };
    }

    return { kind: "rejected", request, decision, reasons: decision.reasons };
  }

  recordRejection(evaluation: Extract<FinishEvaluation, { kind: "rejected" | "invalid" }>): FinishRejectionState {
    this.finishRejections++;
    const message = evaluation.kind === "invalid"
      ? `Completion gate rejected invalid finish arguments ${this.finishRejections} times in this turn`
      : `Completion gate rejected ${this.finishRejections} finish attempts in this turn: ${evaluation.reasons.join(" ")}`;

    return {
      count: this.finishRejections,
      limitExceeded: this.finishRejections >= this.maxFinishRejections,
      message,
    };
  }

  createRejectionResult(evaluation: Extract<FinishEvaluation, { kind: "rejected" | "invalid" }>): ToolResult {
    if (evaluation.kind === "invalid") {
      return {
        content: [
          {
            type: "text",
            text: `Finish rejected: invalid arguments. Fix these issues:\n- ${evaluation.diagnosis.join("\n- ")}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text:
            `Finish rejected by completion gate:\n- ${evaluation.reasons.join("\n- ")}\n` +
            "Resolve the issues and continue with tools. Use criteria[].evidenceIds only when you have matching evidence. Verification evidence must be a real project check; --help/--version/which probes and verification piped through head/tail do not count. Use status blocked only for a concrete external blocker; do not use blocked to bypass missing verification or unfinished work.",
        },
      ],
      isError: true,
    };
  }
}
