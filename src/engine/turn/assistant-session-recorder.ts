import type {
  FunctionCallField,
  ItemParam,
  MessageField,
  ReasoningField,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import {
  isInvisibleAssistantMessage,
  outputItemToSessionItem,
} from "./turn-helpers";
import type { AgentEvent } from "./types";

export interface AssistantSessionRecorderInput {
  session: SessionPort;
  allItems: ItemParam[];
  assistantMessages: MessageField[];
  reasoningItems: ReasoningField[];
  emit: (event: AgentEvent) => void;
}

export interface AssistantSessionRecorder {
  appendAssistantMessagesToSession: () => void;
  appendToolCallGroupToSession: (toolCalls: FunctionCallField[]) => void;
  supersedeVisibleAssistantMessages: () => void;
}

export function createAssistantSessionRecorder(
  input: AssistantSessionRecorderInput,
): AssistantSessionRecorder {
  let assistantMessagesStored = false;
  let reasoningItemsStored = false;

  const appendReasoningItemsToSession = () => {
    if (reasoningItemsStored) return;
    reasoningItemsStored = true;
    for (const item of input.reasoningItems) {
      const sessionItem = outputItemToSessionItem(item);
      if (!sessionItem) continue;
      input.session.appendItem(sessionItem as unknown as SessionItemParam);
      input.allItems.push(sessionItem);
    }
  };

  const appendAssistantMessagesToSession = () => {
    if (assistantMessagesStored) return;
    assistantMessagesStored = true;
    appendReasoningItemsToSession();
    for (const msg of input.assistantMessages) {
      // Do not feed invisible reasoning-only output back into the next model call.
      if (isInvisibleAssistantMessage(msg)) continue;
      const sessionItem = outputItemToSessionItem(msg);
      if (!sessionItem) continue;
      input.session.appendItem(sessionItem as unknown as SessionItemParam);
      input.allItems.push(sessionItem);
    }
  };

  return {
    appendAssistantMessagesToSession,
    appendToolCallGroupToSession: (toolCalls) => {
      appendAssistantMessagesToSession();
      for (const toolCall of toolCalls) {
        const sessionItem = outputItemToSessionItem(toolCall);
        if (!sessionItem) continue;
        input.session.appendItem(sessionItem as unknown as SessionItemParam);
        input.allItems.push(sessionItem);
      }
    },
    supersedeVisibleAssistantMessages: () => {
      for (const msg of input.assistantMessages) {
        if (isInvisibleAssistantMessage(msg)) continue;
        input.emit({
          type: "assistant_message_superseded",
          timestamp: Date.now(),
          messageId: msg.id,
          reason: "autonomous_followup",
        });
      }
    },
  };
}
