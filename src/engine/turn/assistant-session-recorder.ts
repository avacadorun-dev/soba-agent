import type {
  FunctionCallField,
  ItemParam,
  MessageField,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import {
  isInvisibleAssistantMessage,
  outputItemToSessionItem,
} from "./turn-helpers";

export interface AssistantSessionRecorderInput {
  session: SessionPort;
  allItems: ItemParam[];
  assistantMessages: MessageField[];
}

export interface AssistantSessionRecorder {
  appendAssistantMessagesToSession: () => void;
  appendToolCallGroupToSession: (toolCalls: FunctionCallField[]) => void;
}

export function createAssistantSessionRecorder(
  input: AssistantSessionRecorderInput,
): AssistantSessionRecorder {
  let assistantMessagesStored = false;

  const appendAssistantMessagesToSession = () => {
    if (assistantMessagesStored) return;
    assistantMessagesStored = true;
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
  };
}
