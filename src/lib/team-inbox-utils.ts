import type { TeamInboxMessage } from "@/lib/chat-types";

export type ParsedInbox = { text: string; isSystem: boolean };

/** Parse an inbox message text. Returns null to skip SDK-internal messages. */
export function parseInboxMessage(msg: TeamInboxMessage): ParsedInbox | null {
  try {
    const parsed = JSON.parse(msg.text) as Record<string, unknown>;
    const type = parsed.type as string | undefined;
    if (type === "idle_notification") return null; // skip — SDK internal
    if (type === "permission_request") {
      return { text: `Aguarda aprovação: ${parsed.tool_name ?? "tool"}`, isSystem: true };
    }
    if (type === "message" && typeof parsed.content === "string") {
      return { text: parsed.content.slice(0, 200), isSystem: false };
    }
    if (type === "shutdown_request") {
      return { text: "Pedido de encerramento", isSystem: true };
    }
    // Unknown JSON — show summary if available, otherwise skip
    if (msg.summary) return { text: msg.summary, isSystem: false };
    return null;
  } catch {
    // Plain text message — show it
    return { text: msg.summary || msg.text.slice(0, 200), isSystem: false };
  }
}

/** Find the last non-skipped message to display in the card. */
export function getLatestDisplayMessage(
  messages: TeamInboxMessage[]
): (TeamInboxMessage & { parsed: ParsedInbox }) | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parseInboxMessage(messages[i]);
    if (parsed) return { ...messages[i], parsed };
  }
  return null;
}
