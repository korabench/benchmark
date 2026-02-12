import {ModelMessage} from "@korabench/core";

export function formatConversation(messages: readonly ModelMessage[]): string {
  return messages
    .map(m => `${m.role === "user" ? "CHILD" : "AI"}: ${m.content}`)
    .join("\n\n");
}
