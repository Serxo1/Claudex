import { useMemo } from "react";
import type { ChatMessage } from "@/lib/chat-types";

export function usePromptSuggestions(
  input: string,
  lastMessages: ChatMessage[],
  isSlashMenuOpen: boolean,
  isMentionMenuOpen: boolean
): string[] {
  const hideSuggestions =
    input.trim().length >= 80 ||
    input.trim().split(/\s+/).length > 16 ||
    isSlashMenuOpen ||
    isMentionMenuOpen;

  const lastAssistantMessage = useMemo(
    () => [...lastMessages].reverse().find((m) => m.role === "assistant"),
    [lastMessages]
  );
  const userMessageCount = useMemo(
    () => lastMessages.filter((m) => m.role === "user").length,
    [lastMessages]
  );

  return useMemo(() => {
    if (hideSuggestions) return [];
    if (userMessageCount === 0) {
      return [
        "Map this repository and summarize the architecture.",
        "Create a prioritized TODO list for the next milestone.",
        "Review this project and suggest immediate quick wins."
      ];
    }
    if (lastAssistantMessage?.content.trim().startsWith("Error:")) {
      return [
        "Retry with a smaller scope and fewer files.",
        "Run diagnostics for this error and propose a fix plan.",
        "Try the same task without tool calls."
      ];
    }
    if (lastAssistantMessage?.content.trim()) {
      return [
        "Apply these changes now.",
        "Write tests for the last changes.",
        "Summarize the remaining risks."
      ];
    }
    return [];
  }, [hideSuggestions, lastAssistantMessage?.content, userMessageCount]);
}
